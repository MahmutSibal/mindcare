//! Uygulama kilidi (PIN), ücret defteri, metin dosyası yazma ve danışan verisi dışa aktarma.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};

use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::State;

use crate::commands::{check_dest, new_id, with_conn};
use crate::error::{AppError, AppResult};
use crate::AppState;

// ───────────────────────────── Uygulama kilidi ─────────────────────────────

const LOCK_KEY: &str = "app_lock";
const PIN_ROUNDS: u32 = 100_000;
static FAILS: AtomicU32 = AtomicU32::new(0);

fn hash_pin(salt: &str, pin: &str) -> String {
    let mut h = Sha256::digest(format!("{salt}:{pin}").as_bytes());
    for _ in 0..PIN_ROUNDS {
        h = Sha256::digest(h);
    }
    hex::encode(h)
}

fn valid_pin(pin: &str) -> bool {
    (4..=8).contains(&pin.len()) && pin.chars().all(|c| c.is_ascii_digit())
}

fn stored_lock(state: &State<AppState>) -> AppResult<Option<String>> {
    with_conn(state, |c| {
        Ok(c.query_row("SELECT value FROM settings WHERE key = ?1", [LOCK_KEY], |r| r.get::<_, String>(0))
            .optional()?
            .filter(|v| !v.is_empty()))
    })
}

fn check_pin(stored: &str, pin: &str) -> bool {
    let Some((salt, hash)) = stored.split_once(':') else { return false };
    hash_pin(salt, pin) == hash
}

/// Yanlış denemelerde giderek artan bekleme (kaba kuvveti yavaşlatır).
fn verify_throttled(state: &State<AppState>, pin: &str) -> AppResult<bool> {
    let Some(stored) = stored_lock(state)? else { return Ok(true) };
    let ok = check_pin(&stored, pin);
    if ok {
        FAILS.store(0, Ordering::Relaxed);
    } else {
        let n = FAILS.fetch_add(1, Ordering::Relaxed) + 1;
        std::thread::sleep(std::time::Duration::from_millis((u64::from(n.min(10))) * 400));
    }
    Ok(ok)
}

#[tauri::command]
pub fn verify_app_pin(state: State<AppState>, pin: String) -> AppResult<bool> {
    verify_throttled(&state, &pin)
}

/// PIN koyar ya da değiştirir. Daha önce PIN varsa mevcut PIN doğru girilmelidir.
#[tauri::command]
pub fn set_app_pin(state: State<AppState>, pin: String, current: Option<String>) -> AppResult<()> {
    if !valid_pin(&pin) {
        return Err(AppError::Invalid("PIN 4-8 haneli rakamlardan oluşmalı.".into()));
    }
    if stored_lock(&state)?.is_some() && !verify_throttled(&state, current.as_deref().unwrap_or(""))? {
        return Err(AppError::Invalid("Mevcut PIN yanlış.".into()));
    }
    let mut salt = [0u8; 16];
    rand::RngCore::fill_bytes(&mut rand::rngs::OsRng, &mut salt);
    let salt = hex::encode(salt);
    let value = format!("{salt}:{}", hash_pin(&salt, &pin));
    with_conn(&state, |c| {
        c.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![LOCK_KEY, value],
        )?;
        Ok(())
    })
}

#[tauri::command]
pub fn clear_app_pin(state: State<AppState>, pin: String) -> AppResult<()> {
    if !verify_throttled(&state, &pin)? {
        return Err(AppError::Invalid("PIN yanlış.".into()));
    }
    with_conn(&state, |c| {
        c.execute("DELETE FROM settings WHERE key = ?1", [LOCK_KEY])?;
        Ok(())
    })
}

// ───────────────────────────── Ücret defteri ─────────────────────────────

#[derive(Serialize)]
pub struct LedgerEntry {
    id: String,
    kind: String,
    amount_cents: i64,
    entry_date: String,
    note: Option<String>,
}

#[derive(Serialize)]
pub struct BillingRow {
    patient_id: String,
    patient_name: String,
    session_fee_cents: Option<i64>,
    charged_cents: i64,
    paid_cents: i64,
}

#[derive(Deserialize)]
pub struct LedgerInput {
    patient_id: String,
    kind: String,
    amount_cents: i64,
    entry_date: String,
    note: Option<String>,
}

#[tauri::command]
pub fn billing_summary(state: State<AppState>) -> AppResult<Vec<BillingRow>> {
    with_conn(&state, |c| {
        let mut st = c.prepare(
            "SELECT p.id, p.full_name, p.session_fee_cents,
                    COALESCE((SELECT SUM(amount_cents) FROM ledger l WHERE l.patient_id = p.id AND l.kind = 'charge'), 0),
                    COALESCE((SELECT SUM(amount_cents) FROM ledger l WHERE l.patient_id = p.id AND l.kind = 'payment'), 0)
             FROM patients p ORDER BY p.full_name COLLATE NOCASE",
        )?;
        let rows = st
            .query_map([], |r| {
                Ok(BillingRow { patient_id: r.get(0)?, patient_name: r.get(1)?, session_fee_cents: r.get(2)?, charged_cents: r.get(3)?, paid_cents: r.get(4)? })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    })
}

#[tauri::command]
pub fn list_ledger(state: State<AppState>, patient_id: String) -> AppResult<Vec<LedgerEntry>> {
    with_conn(&state, |c| {
        let mut st = c.prepare(
            "SELECT id, kind, amount_cents, entry_date, note FROM ledger WHERE patient_id = ?1
             ORDER BY entry_date DESC, created_at DESC",
        )?;
        let rows = st
            .query_map([patient_id], |r| {
                Ok(LedgerEntry { id: r.get(0)?, kind: r.get(1)?, amount_cents: r.get(2)?, entry_date: r.get(3)?, note: r.get(4)? })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    })
}

#[tauri::command]
pub fn add_ledger_entry(state: State<AppState>, input: LedgerInput) -> AppResult<String> {
    if input.kind != "charge" && input.kind != "payment" {
        return Err(AppError::Invalid("Geçersiz kayıt türü.".into()));
    }
    if input.amount_cents <= 0 || input.amount_cents > 100_000_000_00 {
        return Err(AppError::Invalid("Tutar geçersiz.".into()));
    }
    if input.entry_date.len() < 8 || input.entry_date.len() > 32 {
        return Err(AppError::Invalid("Tarih geçersiz.".into()));
    }
    let note = input.note.map(|n| n.trim().chars().take(300).collect::<String>()).filter(|n| !n.is_empty());
    with_conn(&state, |c| {
        let id = new_id();
        c.execute(
            "INSERT INTO ledger (id, patient_id, kind, amount_cents, entry_date, note) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, input.patient_id, input.kind, input.amount_cents, input.entry_date, note],
        )?;
        Ok(id)
    })
}

#[tauri::command]
pub fn delete_ledger_entry(state: State<AppState>, id: String) -> AppResult<()> {
    with_conn(&state, |c| {
        c.execute("DELETE FROM ledger WHERE id = ?1", [id])?;
        Ok(())
    })
}

#[tauri::command]
pub fn set_patient_fee(state: State<AppState>, patient_id: String, fee_cents: Option<i64>) -> AppResult<()> {
    if fee_cents.is_some_and(|f| f <= 0 || f > 100_000_000_00) {
        return Err(AppError::Invalid("Ücret geçersiz.".into()));
    }
    with_conn(&state, |c| {
        c.execute("UPDATE patients SET session_fee_cents = ?2 WHERE id = ?1", params![patient_id, fee_cents])?;
        Ok(())
    })
}

// ───────────────────────────── Dosya yazma ve dışa aktarma ─────────────────────────────

/// Metin dosyasını terapistin seçtiği konuma yazar (takvim .ics, makbuz vb.). En çok 5 MB.
#[tauri::command]
pub fn save_text_file(state: State<AppState>, dest: String, content: String) -> AppResult<()> {
    if content.len() > 5 * 1024 * 1024 {
        return Err(AppError::Invalid("Dosya çok büyük.".into()));
    }
    let dest = PathBuf::from(dest);
    check_dest(&dest, &state.db_path)?;
    std::fs::write(&dest, content)?;
    Ok(())
}

fn esc(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// Terapist notunun düz metni: etiketler atılır, güvenli biçimde kaçışlanır.
fn note_text(html: &str) -> String {
    let mut s = html.to_string();
    for t in ["<br>", "<br/>", "<br />", "</p>", "</li>", "</h2>", "</blockquote>"] {
        s = s.replace(t, "\n");
    }
    let mut out = String::new();
    let mut in_tag = false;
    for ch in s.chars() {
        match ch {
            '<' => in_tag = true,
            '>' if in_tag => in_tag = false,
            c if !in_tag => out.push(c),
            _ => {}
        }
    }
    let out = out
        .replace("&nbsp;", " ").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&#39;", "'").replace("&amp;", "&");
    esc(out.trim())
}

fn money(c: i64) -> String {
    format!("{},{:02} TL", c / 100, c % 100)
}

/// Danışanın tüm kaydını tek bir okunabilir HTML dosyasına yazar (tarayıcıda "Yazdır → PDF olarak kaydet").
#[tauri::command]
pub fn export_patient_data(state: State<AppState>, patient_id: String, dest: String) -> AppResult<()> {
    let dest = PathBuf::from(dest);
    check_dest(&dest, &state.db_path)?;
    let html = with_conn(&state, |c| {
        let opt_s = |v: Option<String>| esc(&v.unwrap_or_default());
        let (name, birth, phone, email, status, em, emp, risk, reason, consent): (String, Option<String>, Option<String>, Option<String>, String, Option<String>, Option<String>, Option<String>, Option<String>, Option<String>) = c
            .query_row(
                "SELECT full_name, birth_date, phone, email, status, emergency_contact, emergency_phone, risk_note, intake_reason, consent_at FROM patients WHERE id = ?1",
                [&patient_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?, r.get(8)?, r.get(9)?)),
            )
            .optional()?
            .ok_or_else(|| AppError::Invalid("Danışan bulunamadı.".into()))?;

        let mut h = String::new();
        h.push_str(&format!(
            "<!doctype html><html lang=\"tr\"><head><meta charset=\"utf-8\"><title>{n} – Danışan kaydı</title>\
             <style>body{{font:14px/1.5 system-ui,sans-serif;max-width:800px;margin:2rem auto;padding:0 1rem;color:#111}}\
             h1{{font-size:1.5rem}}h2{{font-size:1.1rem;margin-top:2rem;border-bottom:1px solid #ccc}}\
             table{{border-collapse:collapse;width:100%}}td,th{{border:1px solid #ddd;padding:4px 8px;text-align:left}}\
             pre{{white-space:pre-wrap;font:inherit;background:#f6f6f6;padding:8px;border-radius:6px}}</style></head><body>\
             <h1>{n}</h1><p>Gizli klinik kayıt.</p>",
            n = esc(&name)
        ));
        h.push_str(&format!(
            "<h2>Kişisel bilgiler</h2><table>\
             <tr><th>Doğum tarihi</th><td>{}</td></tr><tr><th>Telefon</th><td>{}</td></tr><tr><th>E-posta</th><td>{}</td></tr>\
             <tr><th>Durum</th><td>{}</td></tr><tr><th>Acil durum kişisi</th><td>{} {}</td></tr>\
             <tr><th>Başvuru nedeni</th><td>{}</td></tr><tr><th>Risk notu</th><td>{}</td></tr><tr><th>Çevrim içi görüşme onamı</th><td>{}</td></tr></table>",
            opt_s(birth), opt_s(phone), opt_s(email), if status == "active" { "Aktif" } else { "Pasif" },
            opt_s(em), opt_s(emp), opt_s(reason), opt_s(risk), opt_s(consent)
        ));

        // Seanslar ve notlar
        h.push_str("<h2>Seanslar ve notlar</h2>");
        let mut st = c.prepare(
            "SELECT s.session_number, s.session_date, s.duration_seconds, s.status,
                    (SELECT group_concat(n.note_content, char(10)) FROM private_notes n WHERE n.session_id = s.id)
             FROM sessions s WHERE s.patient_id = ?1 ORDER BY s.session_number",
        )?;
        let rows = st.query_map([&patient_id], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, Option<i64>>(2)?, r.get::<_, String>(3)?, r.get::<_, Option<String>>(4)?))
        })?;
        for row in rows {
            let (no, date, dur, stt, note) = row?;
            h.push_str(&format!(
                "<h3>{no}. seans – {} ({} dk, {})</h3><pre>{}</pre>",
                esc(&date), dur.unwrap_or(0) / 60, esc(&stt), note_text(&note.unwrap_or_default())
            ));
        }

        let table = |h: &mut String, title: &str, head: &[&str], rows: Vec<Vec<String>>| {
            h.push_str(&format!("<h2>{}</h2>", esc(title)));
            if rows.is_empty() {
                h.push_str("<p>Kayıt yok.</p>");
                return;
            }
            h.push_str("<table><tr>");
            for t in head {
                h.push_str(&format!("<th>{}</th>", esc(t)));
            }
            h.push_str("</tr>");
            for r in rows {
                h.push_str("<tr>");
                for cell in r {
                    h.push_str(&format!("<td>{}</td>", esc(&cell)));
                }
                h.push_str("</tr>");
            }
            h.push_str("</table>");
        };

        let collect = |sql: &str, n: usize| -> AppResult<Vec<Vec<String>>> {
            let mut st = c.prepare(sql)?;
            let rows = st
                .query_map([&patient_id], |r| {
                    (0..n).map(|i| Ok(r.get::<_, rusqlite::types::Value>(i).map(|v| match v {
                        rusqlite::types::Value::Null => String::new(),
                        rusqlite::types::Value::Integer(i) => i.to_string(),
                        rusqlite::types::Value::Real(f) => f.to_string(),
                        rusqlite::types::Value::Text(t) => t,
                        rusqlite::types::Value::Blob(_) => String::new(),
                    })?)).collect::<rusqlite::Result<Vec<String>>>()
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(rows)
        };

        table(&mut h, "Test sonuçları", &["Test", "Puan", "Tarih"],
            collect("SELECT test_title, total_score, completed_at FROM test_results WHERE patient_id = ?1 ORDER BY completed_at", 3)?);
        table(&mut h, "Ödevler", &["Başlık", "Açıklama", "Son tarih", "Durum", "Değerlendirme"],
            collect("SELECT title, description, due_date, status, review_note FROM homework WHERE patient_id = ?1 ORDER BY created_at", 5)?);
        table(&mut h, "Randevular", &["Tarih", "Süre (dk)", "Durum"],
            collect("SELECT appointment_date, duration_minutes, status FROM appointments WHERE patient_id = ?1 ORDER BY appointment_date", 3)?);
        let ledger = collect("SELECT entry_date, kind, amount_cents, note FROM ledger WHERE patient_id = ?1 ORDER BY entry_date", 4)?;
        let ledger = ledger
            .into_iter()
            .map(|r| {
                let cents: i64 = r[2].parse().unwrap_or(0);
                vec![r[0].clone(), if r[1] == "charge" { "Borç".into() } else { "Ödeme".into() }, money(cents), r[3].clone()]
            })
            .collect();
        table(&mut h, "Ücret ve ödemeler", &["Tarih", "Tür", "Tutar", "Not"], ledger);
        h.push_str("</body></html>");
        Ok(h)
    })?;
    std::fs::write(&dest, html)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pin_hash_roundtrip() {
        let h = hash_pin("ab", "1234");
        assert!(check_pin(&format!("ab:{h}"), "1234"));
        assert!(!check_pin(&format!("ab:{h}"), "1235"));
        assert!(!check_pin("bozuk", "1234"));
    }

    #[test]
    fn pin_format() {
        assert!(valid_pin("1234") && valid_pin("12345678"));
        assert!(!valid_pin("123") && !valid_pin("123456789") && !valid_pin("12a4") && !valid_pin(""));
    }

    #[test]
    fn notes_are_flattened_and_escaped() {
        let t = note_text("<p>Merhaba <b>dünya</b></p><script>alert(1)</script>&lt;x&gt;");
        assert!(!t.contains("<script") && !t.contains("<b>"));
        assert!(t.contains("Merhaba dünya"));
        assert!(t.contains("&lt;x&gt;"));
    }

    #[test]
    fn money_format() {
        assert_eq!(money(150050), "1500,50 TL");
        assert_eq!(money(5), "0,05 TL");
    }
}
