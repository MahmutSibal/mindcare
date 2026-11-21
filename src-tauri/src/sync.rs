//! Cihazlar arası eşitleme: değişiklik izleme (1. aşama).
//!
//! Eşitlenen her tabloya tetikleyiciler konur; satır eklenince/değişince/silinince `sync_log`'a
//! (tablo, anahtar, işlem, an) yazılır. Böylece veri hangi yoldan yazılırsa yazılsın (komutlar, silme
//! zincirleri) izlenir; komutların tek tek değiştirilmesi gerekmez. Uzaktan gelen değişiklikler
//! uygulanırken `applying` bayrağı 1 olur ve tetikleyiciler susar (döngü oluşmaz).
//!
//! Eşitlenmeyenler: ayarlar (cihaza özgü), materyaller (dosya yolu cihaza özgü), seans kayıtları
//! ve parçaları (çok büyük).

use base64::{Engine as _, engine::general_purpose::STANDARD as B64};
use chacha20poly1305::{
    KeyInit, XChaCha20Poly1305,
    aead::{Aead, Payload},
};
use hkdf::Hkdf;
use hmac::{Hmac, Mac};
use rand::RngCore;
use rusqlite::{Connection, params, params_from_iter, types::{Value as SqlValue, ValueRef}};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use sha2::Sha256;
use tauri::State;
use zeroize::Zeroizing;

use crate::commands::with_conn;
use crate::error::{AppError, AppResult};
use crate::{AppState, recovery};

/// Eşitlenen tablolar ve birincil anahtar sütunları.
pub const SYNC_TABLES: &[(&str, &[&str])] = &[
    ("patients", &["id"]),
    ("sessions", &["id"]),
    ("private_notes", &["id"]),
    ("appointments", &["id"]),
    ("tests", &["id"]),
    ("test_results", &["id"]),
    ("homework", &["id"]),
    ("patient_substances", &["id"]),
    ("drawings", &["id"]),
    ("patient_files", &["id"]),
    ("therapy_groups", &["id"]),
    ("group_members", &["group_id", "patient_id"]),
    ("group_sessions", &["id"]),
    ("group_member_notes", &["group_session_id", "patient_id"]),
    ("ledger", &["id"]),
];

/// Milisaniye cinsinden şimdiki an (SQLite içinde).
const NOW_MS: &str = "CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)";

fn pk_expr(prefix: &str, cols: &[&str]) -> String {
    cols.iter().map(|c| format!("{prefix}.{c}")).collect::<Vec<_>>().join(" || '|' || ")
}

/// Tetikleyicileri (yeniden) kurar. Her açılışta çalışır; tablo listesi değişirse kendiliğinden güncellenir.
/// Ayrıca henüz izlenmemiş mevcut kayıtları bir kez günlüğe yazar (ilk eşitleme için).
pub fn install(conn: &Connection) -> AppResult<()> {
    let mut sql = String::new();
    for (t, pk) in SYNC_TABLES {
        let new_pk = pk_expr("NEW", pk);
        let old_pk = pk_expr("OLD", pk);
        let guard = "WHEN (SELECT value FROM sync_meta WHERE key = 'applying') = '0'";
        sql.push_str(&format!(
            "DROP TRIGGER IF EXISTS sync_{t}_i;
             DROP TRIGGER IF EXISTS sync_{t}_u;
             DROP TRIGGER IF EXISTS sync_{t}_d;
             CREATE TRIGGER sync_{t}_i AFTER INSERT ON {t} {guard}
               BEGIN INSERT INTO sync_log (tbl, pk, op, ts) VALUES ('{t}', {new_pk}, 'u', {NOW_MS}); END;
             CREATE TRIGGER sync_{t}_u AFTER UPDATE ON {t} {guard}
               BEGIN INSERT INTO sync_log (tbl, pk, op, ts) VALUES ('{t}', {new_pk}, 'u', {NOW_MS}); END;
             CREATE TRIGGER sync_{t}_d AFTER DELETE ON {t} {guard}
               BEGIN INSERT INTO sync_log (tbl, pk, op, ts) VALUES ('{t}', {old_pk}, 'd', {NOW_MS}); END;\n"
        ));
    }
    conn.execute_batch(&sql)?;

    let seeded: Option<String> = conn
        .query_row("SELECT value FROM sync_meta WHERE key = 'seeded'", [], |r| r.get(0))
        .ok();
    if seeded.is_none() {
        let mut seed = String::new();
        for (t, pk) in SYNC_TABLES {
            let pk = pk_expr(t, pk);
            seed.push_str(&format!("INSERT INTO sync_log (tbl, pk, op, ts) SELECT '{t}', {pk}, 'u', {NOW_MS} FROM {t};\n"));
        }
        seed.push_str("INSERT INTO sync_meta (key, value) VALUES ('seeded', '1');");
        conn.execute_batch(&seed)?;
    }
    Ok(())
}

// ───────────────────────────── Şifreleme ─────────────────────────────

/// Tek bir kaydın (şifreli) en büyük boyutu. Daha büyük olanlar (ör. çok büyük dosyalar) eşitlenmez.
const MAX_ROW_BYTES: usize = 15_000_000;

/// Eşitleme anahtarından türetilen değerler. Sunucuya yalnızca `vault` ve `token` gider;
/// `enc` ve `rec` cihazdan çıkmaz.
pub struct SyncKeys {
    pub vault: String,
    pub token: String,
    enc: Zeroizing<[u8; 32]>,
    rec: Zeroizing<[u8; 32]>,
}

impl SyncKeys {
    pub fn derive(key_hex: &str) -> AppResult<Self> {
        let raw = Zeroizing::new(hex::decode(key_hex).map_err(|_| AppError::Key("Eşitleme anahtarı geçersiz.".into()))?);
        if raw.len() != 32 {
            return Err(AppError::Key("Eşitleme anahtarı geçersiz.".into()));
        }
        let hk = Hkdf::<Sha256>::new(Some(b"mavi-ruh-sync-v1"), &raw);
        let expand = |info: &str| -> AppResult<[u8; 32]> {
            let mut out = [0u8; 32];
            hk.expand(info.as_bytes(), &mut out).map_err(|_| AppError::Key("Anahtar türetilemedi.".into()))?;
            Ok(out)
        };
        Ok(Self {
            vault: hex::encode(expand("vault-id")?),
            token: hex::encode(expand("vault-token")?),
            enc: Zeroizing::new(expand("encrypt")?),
            rec: Zeroizing::new(expand("record-id")?),
        })
    }

    /// Kayıt kimliği: tablo ve anahtardan üretilmiş anlamsız bir özet (sunucu tablo adını öğrenmez).
    pub fn rec_id(&self, tbl: &str, pk: &str) -> String {
        let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(&*self.rec).expect("HMAC her uzunlukta anahtar alır");
        mac.update(tbl.as_bytes());
        mac.update(b"|");
        mac.update(pk.as_bytes());
        hex::encode(mac.finalize().into_bytes())
    }

    fn seal(&self, rec: &str, plain: &[u8]) -> AppResult<String> {
        let cipher = XChaCha20Poly1305::new((&*self.enc).into());
        let mut nonce = [0u8; 24];
        rand::rngs::OsRng.fill_bytes(&mut nonce);
        let ct = cipher
            .encrypt((&nonce).into(), Payload { msg: plain, aad: rec.as_bytes() })
            .map_err(|_| AppError::Invalid("Şifreleme başarısız.".into()))?;
        let mut out = nonce.to_vec();
        out.extend_from_slice(&ct);
        Ok(B64.encode(out))
    }

    fn open(&self, rec: &str, data: &str) -> AppResult<Vec<u8>> {
        let raw = B64.decode(data).map_err(|_| AppError::Invalid("Eşitleme verisi bozuk.".into()))?;
        if raw.len() < 24 + 16 {
            return Err(AppError::Invalid("Eşitleme verisi bozuk.".into()));
        }
        let (nonce, ct) = raw.split_at(24);
        let cipher = XChaCha20Poly1305::new((&*self.enc).into());
        cipher
            .decrypt(nonce.into(), Payload { msg: ct, aad: rec.as_bytes() })
            .map_err(|_| AppError::Invalid("Eşitleme verisi bu anahtarla açılamadı.".into()))
    }
}

// ───────────────────────────── Yardımcılar ─────────────────────────────

fn meta_get(c: &Connection, key: &str) -> Option<String> {
    c.query_row("SELECT value FROM sync_meta WHERE key = ?1", [key], |r| r.get(0)).ok()
}

fn meta_set(c: &Connection, key: &str, value: &str) -> AppResult<()> {
    c.execute(
        "INSERT INTO sync_meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

/// Bu cihazın kimliği (ilk kullanımda üretilir).
pub fn device_id(c: &Connection) -> AppResult<String> {
    if let Some(d) = meta_get(c, "device_id") {
        return Ok(d);
    }
    let d = uuid::Uuid::new_v4().to_string();
    meta_set(c, "device_id", &d)?;
    Ok(d)
}

fn spec(tbl: &str) -> Option<&'static [&'static str]> {
    SYNC_TABLES.iter().find(|(t, _)| *t == tbl).map(|(_, pk)| *pk)
}

fn split_pk(cols: &[&str], pk: &str) -> AppResult<Vec<String>> {
    let parts: Vec<String> = if cols.len() == 1 { vec![pk.to_string()] } else { pk.split('|').map(str::to_string).collect() };
    if parts.len() != cols.len() || parts.iter().any(String::is_empty) {
        return Err(AppError::Invalid("Eşitleme kaydının anahtarı geçersiz.".into()));
    }
    Ok(parts)
}

fn where_clause(cols: &[&str]) -> String {
    cols.iter().enumerate().map(|(i, c)| format!("{c} = ?{}", i + 1)).collect::<Vec<_>>().join(" AND ")
}

fn load_row(c: &Connection, tbl: &str, cols: &[&str], pk: &str) -> AppResult<Option<Map<String, Value>>> {
    let parts = split_pk(cols, pk)?;
    let mut st = c.prepare(&format!("SELECT * FROM {tbl} WHERE {}", where_clause(cols)))?;
    let names: Vec<String> = st.column_names().map(|s| s.to_string()).collect();
    let mut rows = st.query(params_from_iter(parts.iter()))?;
    let Some(r) = rows.next()? else { return Ok(None) };
    let mut m = Map::new();
    for (i, n) in names.iter().enumerate() {
        let v = match r.get_ref(i)? {
            ValueRef::Null => Value::Null,
            ValueRef::Integer(v) => json!(v),
            ValueRef::Real(v) => json!(v),
            ValueRef::Text(b) => Value::String(String::from_utf8_lossy(b).into_owned()),
            ValueRef::Blob(b) => json!({ "$b": B64.encode(b) }),
        };
        m.insert(n.clone(), v);
    }
    Ok(Some(m))
}

fn json_to_sql(v: &Value) -> AppResult<SqlValue> {
    Ok(match v {
        Value::Null => SqlValue::Null,
        Value::Bool(b) => SqlValue::Integer(i64::from(*b)),
        Value::Number(n) => match n.as_i64() {
            Some(i) => SqlValue::Integer(i),
            None => SqlValue::Real(n.as_f64().unwrap_or(0.0)),
        },
        Value::String(s) => SqlValue::Text(s.clone()),
        Value::Object(o) => match o.get("$b").and_then(Value::as_str) {
            Some(b) => SqlValue::Blob(B64.decode(b).map_err(|_| AppError::Invalid("Eşitleme verisi bozuk.".into()))?),
            None => return Err(AppError::Invalid("Eşitleme verisi bozuk.".into())),
        },
        Value::Array(_) => return Err(AppError::Invalid("Eşitleme verisi bozuk.".into())),
    })
}

fn table_columns(c: &Connection, tbl: &str) -> AppResult<Vec<String>> {
    let mut st = c.prepare(&format!("PRAGMA table_info({tbl})"))?;
    let v = st.query_map([], |r| r.get::<_, String>(1))?.collect::<Result<Vec<_>, _>>()?;
    Ok(v)
}

// ───────────────────────────── Gönderme ─────────────────────────────

/// Sunucuya giden (veya sunucudan gelen) tek kayıt. `data` şifrelidir.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncItem {
    pub rec: String,
    pub ts: i64,
    pub device: String,
    pub deleted: bool,
    pub data: Option<String>,
    /// Yalnızca sunucudan gelenlerde dolu.
    #[serde(default, skip_serializing)]
    pub seq: i64,
}

#[derive(Debug, Serialize)]
pub struct PushBatch {
    pub items: Vec<SyncItem>,
    /// Gönderim başarılı olunca `commit_push` buna kadar olan günlük satırlarını işaretler.
    pub upto_seq: i64,
    /// Çok büyük olduğu için eşitlenmeyen kayıt sayısı.
    pub skipped: i64,
}

/// Henüz gönderilmemiş değişikliklerden bir parti hazırlar. Aynı kayıt için yalnızca en son durum gider.
pub fn prepare_push(c: &Connection, keys: &SyncKeys, max_items: usize, max_bytes: usize) -> AppResult<PushBatch> {
    let device = device_id(c)?;
    let mut st = c.prepare(
        "SELECT tbl, pk, op, ts, seq FROM sync_log
         WHERE seq IN (SELECT max(seq) FROM sync_log WHERE pushed = 0 GROUP BY tbl, pk)
         ORDER BY seq LIMIT ?1",
    )?;
    let pending: Vec<(String, String, String, i64, i64)> = st
        .query_map([max_items as i64], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)))?
        .collect::<Result<_, _>>()?;

    let mut items = Vec::new();
    let (mut bytes, mut upto, mut skipped) = (0usize, 0i64, 0i64);
    for (tbl, pk, op, ts, seq) in pending {
        let Some(cols) = spec(&tbl) else {
            upto = seq;
            continue;
        };
        let rec = keys.rec_id(&tbl, &pk);
        let (deleted, payload) = if op == "d" {
            (true, json!({ "t": tbl, "pk": pk }))
        } else {
            match load_row(c, &tbl, cols, &pk)? {
                Some(row) => (false, json!({ "t": tbl, "pk": pk, "row": row })),
                None => {
                    upto = seq; // satır sonradan silinmiş; silme izi ayrı bir günlük satırında
                    continue;
                }
            }
        };
        let plain = serde_json::to_vec(&payload).map_err(|e| AppError::Invalid(e.to_string()))?;
        if plain.len() > MAX_ROW_BYTES {
            skipped += 1;
            upto = seq;
            continue;
        }
        let data = keys.seal(&rec, &plain)?;
        if !items.is_empty() && bytes + data.len() > max_bytes {
            break;
        }
        bytes += data.len();
        items.push(SyncItem { rec, ts, device: device.clone(), deleted, data: Some(data), seq: 0 });
        upto = seq;
    }
    Ok(PushBatch { items, upto_seq: upto, skipped })
}

/// Parti sunucuya yazıldıktan sonra çağrılır.
pub fn commit_push(c: &Connection, upto_seq: i64) -> AppResult<()> {
    c.execute("UPDATE sync_log SET pushed = 1 WHERE seq <= ?1 AND pushed = 0", [upto_seq])?;
    // Günlük büyümesin: her kayıt için yalnızca en son satır (yerel zaman damgası için) kalır.
    c.execute(
        "DELETE FROM sync_log WHERE pushed = 1 AND seq NOT IN (SELECT max(seq) FROM sync_log GROUP BY tbl, pk)",
        [],
    )?;
    meta_set(c, "last_sync_at", &now_ms().to_string())?;
    Ok(())
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

// ───────────────────────────── Uygulama (çekme) ─────────────────────────────

#[derive(Debug, Default, Serialize, PartialEq)]
pub struct ApplyReport {
    pub applied: i64,
    /// Yerelde daha yeni (ya da aynı) olduğu için yok sayılan.
    pub stale: i64,
    /// Uygulanamayanlar (ör. başka cihazda aynı numaralı seans oluşmuş).
    pub failed: i64,
    pub last_seq: i64,
}

/// Bu kaydın yereldeki son durumu: (zaman, cihaz). Yerel değişiklik günlüğü ve uzaktan uygulananlar birlikte bakılır.
fn local_stamp(c: &Connection, tbl: &str, pk: &str, my_device: &str) -> Option<(i64, String)> {
    let from_log: Option<i64> =
        c.query_row("SELECT max(ts) FROM sync_log WHERE tbl = ?1 AND pk = ?2", params![tbl, pk], |r| r.get(0)).ok().flatten();
    let from_state: Option<(i64, String)> = c
        .query_row("SELECT ts, device FROM sync_state WHERE tbl = ?1 AND pk = ?2", params![tbl, pk], |r| Ok((r.get(0)?, r.get(1)?)))
        .ok();
    let a = from_log.map(|t| (t, my_device.to_string()));
    match (a, from_state) {
        (Some(x), Some(y)) => Some(x.max(y)),
        (x, y) => x.or(y),
    }
}

fn apply_one(tx: &Connection, keys: &SyncKeys, my_device: &str, it: &SyncItem) -> AppResult<bool> {
    let data = it.data.as_deref().ok_or_else(|| AppError::Invalid("Eşitleme kaydında veri yok.".into()))?;
    let plain = keys.open(&it.rec, data)?;
    let payload: Value = serde_json::from_slice(&plain).map_err(|_| AppError::Invalid("Eşitleme verisi bozuk.".into()))?;
    let tbl = payload.get("t").and_then(Value::as_str).ok_or_else(|| AppError::Invalid("Eşitleme verisi bozuk.".into()))?;
    let pk = payload.get("pk").and_then(Value::as_str).ok_or_else(|| AppError::Invalid("Eşitleme verisi bozuk.".into()))?;
    // Tablo adı yalnızca bilinen listeden gelebilir; kayıt kimliği de eşleşmeli.
    let cols = spec(tbl).ok_or_else(|| AppError::Invalid("Bilinmeyen eşitleme tablosu.".into()))?;
    if keys.rec_id(tbl, pk) != it.rec {
        return Err(AppError::Invalid("Eşitleme kaydı tutarsız.".into()));
    }
    if let Some(local) = local_stamp(tx, tbl, pk, my_device)
        && (it.ts, it.device.clone()) <= local
    {
        return Ok(false);
    }
    let parts = split_pk(cols, pk)?;
    if it.deleted {
        tx.execute(&format!("DELETE FROM {tbl} WHERE {}", where_clause(cols)), params_from_iter(parts.iter()))?;
    } else {
        let row = payload.get("row").and_then(Value::as_object).ok_or_else(|| AppError::Invalid("Eşitleme verisi bozuk.".into()))?;
        // Yalnızca bu cihazda var olan sütunlar yazılır (cihazlar farklı sürümde olabilir).
        let known = table_columns(tx, tbl)?;
        let names: Vec<&String> = known.iter().filter(|k| row.contains_key(k.as_str())).collect();
        if !cols.iter().all(|k| names.iter().any(|n| n.as_str() == *k)) {
            return Err(AppError::Invalid("Eşitleme kaydında anahtar sütunları eksik.".into()));
        }
        let values = names.iter().map(|n| json_to_sql(&row[n.as_str()])).collect::<AppResult<Vec<_>>>()?;
        let placeholders = (1..=names.len()).map(|i| format!("?{i}")).collect::<Vec<_>>().join(", ");
        let col_list = names.iter().map(|n| n.as_str()).collect::<Vec<_>>().join(", ");
        let updates = names
            .iter()
            .filter(|n| !cols.contains(&n.as_str()))
            .map(|n| format!("{n} = excluded.{n}"))
            .collect::<Vec<_>>();
        let conflict = if updates.is_empty() {
            format!("ON CONFLICT({}) DO NOTHING", cols.join(", "))
        } else {
            format!("ON CONFLICT({}) DO UPDATE SET {}", cols.join(", "), updates.join(", "))
        };
        tx.execute(
            &format!("INSERT INTO {tbl} ({col_list}) VALUES ({placeholders}) {conflict}"),
            params_from_iter(values.iter()),
        )?;
    }
    tx.execute(
        "INSERT INTO sync_state (tbl, pk, ts, device) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(tbl, pk) DO UPDATE SET ts = excluded.ts, device = excluded.device",
        params![tbl, pk, it.ts, it.device],
    )?;
    Ok(true)
}

/// Sunucudan gelen değişiklikleri uygular. Sıra dışı gelen kayıtlar (örn. üst kayıt sonra gelir) için
/// yabancı anahtar denetimi uygulama süresince kapalıdır; bütün kayıtlar geldiğinde veri tutarlı olur.
pub fn apply_remote(c: &mut Connection, keys: &SyncKeys, items: &[SyncItem]) -> AppResult<ApplyReport> {
    let my_device = device_id(c)?;
    let mut report = ApplyReport::default();
    c.execute_batch("PRAGMA foreign_keys = OFF;")?;
    let result = (|| -> AppResult<()> {
        let tx = c.transaction()?;
        tx.execute("UPDATE sync_meta SET value = '1' WHERE key = 'applying'", [])?;
        for it in items {
            report.last_seq = report.last_seq.max(it.seq);
            if it.device == my_device {
                report.stale += 1;
                continue;
            }
            // Kayıt başına SAVEPOINT: biri uygulanamazsa yalnızca o geri alınır.
            tx.execute_batch("SAVEPOINT item")?;
            match apply_one(&tx, keys, &my_device, it) {
                Ok(true) => {
                    tx.execute_batch("RELEASE item")?;
                    report.applied += 1;
                }
                Ok(false) => {
                    tx.execute_batch("RELEASE item")?;
                    report.stale += 1;
                }
                Err(_) => {
                    tx.execute_batch("ROLLBACK TO item; RELEASE item")?;
                    report.failed += 1;
                }
            }
        }
        tx.execute("UPDATE sync_meta SET value = '0' WHERE key = 'applying'", [])?;
        if report.last_seq > 0 {
            let cur: i64 = meta_get(&tx, "pull_seq").and_then(|v| v.parse().ok()).unwrap_or(0);
            meta_set(&tx, "pull_seq", &cur.max(report.last_seq).to_string())?;
        }
        meta_set(&tx, "last_sync_at", &now_ms().to_string())?;
        tx.commit()?;
        Ok(())
    })();
    c.execute_batch("PRAGMA foreign_keys = ON;")?;
    result?;
    Ok(report)
}

// ───────────────────────────── Açma / kapama ─────────────────────────────

fn read_key(c: &Connection) -> AppResult<Option<Zeroizing<String>>> {
    Ok(meta_get(c, "sync_key").map(Zeroizing::new))
}

/// Eşleştirme kodu: eşitleme anahtarının insanın yazabileceği biçimi (55 karakter, sağlamalı).
pub fn pairing_code(c: &Connection) -> AppResult<String> {
    let key = read_key(c)?.ok_or_else(|| AppError::Invalid("Eşitleme açık değil.".into()))?;
    Ok(recovery::encode(&key)?.to_string())
}

/// Her kaydın yeniden gönderilmesi için günlüğü baştan kurar (eşitleme açılırken/değişirken).
fn reseed(c: &Connection) -> AppResult<()> {
    c.execute_batch(
        "DELETE FROM sync_log; DELETE FROM sync_state;
         DELETE FROM sync_meta WHERE key IN ('seeded', 'pull_seq', 'last_sync_at');",
    )?;
    install(c)
}

/// Bu cihazda eşitlemeyi ilk kez açar: yeni bir anahtar üretir ve eşleştirme kodunu döndürür.
pub fn enable(c: &Connection) -> AppResult<String> {
    if read_key(c)?.is_some() {
        return pairing_code(c);
    }
    let mut raw = Zeroizing::new([0u8; 32]);
    rand::rngs::OsRng.fill_bytes(raw.as_mut());
    let key = Zeroizing::new(hex::encode(raw.as_ref()));
    meta_set(c, "sync_key", &key)?;
    reseed(c)?;
    pairing_code(c)
}

/// Başka cihazdaki eşleştirme koduyla bağlanır.
pub fn join(c: &Connection, code: &str) -> AppResult<()> {
    let key = recovery::decode(code).map_err(|_| {
        AppError::Invalid("Eşleştirme kodu hatalı. 55 karakterlik kodu, tire ve boşluklar önemsiz, eksiksiz girin.".into())
    })?;
    meta_set(c, "sync_key", &key)?;
    reseed(c)
}

/// Eşitlemeyi kapatır (yerel veri olduğu gibi kalır).
pub fn disable(c: &Connection) -> AppResult<()> {
    c.execute("DELETE FROM sync_meta WHERE key = 'sync_key'", [])?;
    reseed(c)
}

fn keys_of(c: &Connection) -> AppResult<SyncKeys> {
    let key = read_key(c)?.ok_or_else(|| AppError::Invalid("Eşitleme açık değil.".into()))?;
    SyncKeys::derive(&key)
}

// ───────────────────────────── Tauri komutları ─────────────────────────────

#[derive(Serialize)]
pub struct SyncStatus {
    pub enabled: bool,
    pub device: String,
    /// Gönderilmeyi bekleyen kayıt sayısı.
    pub pending: i64,
    pub cursor: i64,
    pub last_sync_at: Option<i64>,
}

#[derive(Serialize)]
pub struct SyncCredentials {
    pub vault: String,
    pub token: String,
    pub cursor: i64,
    pub device: String,
}

#[tauri::command]
pub fn sync_status(state: State<AppState>) -> AppResult<SyncStatus> {
    with_conn(&state, |c| {
        let pending: i64 = c
            .query_row("SELECT count(DISTINCT tbl || '|' || pk) FROM sync_log WHERE pushed = 0", [], |r| r.get(0))
            .unwrap_or(0);
        Ok(SyncStatus {
            enabled: read_key(c)?.is_some(),
            device: device_id(c)?,
            pending,
            cursor: meta_get(c, "pull_seq").and_then(|v| v.parse().ok()).unwrap_or(0),
            last_sync_at: meta_get(c, "last_sync_at").and_then(|v| v.parse().ok()),
        })
    })
}

#[tauri::command]
pub fn sync_enable(state: State<AppState>) -> AppResult<String> {
    with_conn(&state, |c| enable(c))
}

#[tauri::command]
pub fn sync_pairing_code(state: State<AppState>) -> AppResult<String> {
    with_conn(&state, |c| pairing_code(c))
}

#[tauri::command]
pub fn sync_join(state: State<AppState>, code: String) -> AppResult<()> {
    with_conn(&state, |c| join(c, &code))
}

#[tauri::command]
pub fn sync_disable(state: State<AppState>) -> AppResult<()> {
    with_conn(&state, |c| disable(c))
}

/// Sunucuya bağlanmak için kasa kimliği ve erişim belirteci (şifreleme anahtarı döndürülmez).
#[tauri::command]
pub fn sync_credentials(state: State<AppState>) -> AppResult<Option<SyncCredentials>> {
    with_conn(&state, |c| {
        if read_key(c)?.is_none() {
            return Ok(None);
        }
        let k = keys_of(c)?;
        Ok(Some(SyncCredentials {
            vault: k.vault.clone(),
            token: k.token.clone(),
            cursor: meta_get(c, "pull_seq").and_then(|v| v.parse().ok()).unwrap_or(0),
            device: device_id(c)?,
        }))
    })
}

#[tauri::command]
pub fn sync_prepare_push(state: State<AppState>, max_items: usize, max_bytes: usize) -> AppResult<PushBatch> {
    with_conn(&state, |c| {
        let k = keys_of(c)?;
        prepare_push(c, &k, max_items.clamp(1, 100), max_bytes.clamp(100_000, 20_000_000))
    })
}

#[tauri::command]
pub fn sync_commit_push(state: State<AppState>, upto_seq: i64) -> AppResult<()> {
    with_conn(&state, |c| commit_push(c, upto_seq))
}

#[tauri::command]
pub fn sync_apply(state: State<AppState>, items: Vec<SyncItem>) -> AppResult<ApplyReport> {
    with_conn(&state, |c| {
        let k = keys_of(c)?;
        apply_remote(c, &k, &items)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use zeroize::Zeroizing;

    fn open(name: &str) -> Connection {
        let p = std::env::temp_dir().join(format!("mindcare-sync-{}-{name}", std::process::id()));
        db::remove_with_sidecars(&p).unwrap();
        let key = Zeroizing::new(std::iter::repeat_n('s', 64).collect::<String>());
        let mut c = db::open_encrypted(&p, &key).unwrap();
        db::migrate(&mut c).unwrap();
        c
    }

    fn log(c: &Connection) -> Vec<(String, String, String)> {
        let mut st = c.prepare("SELECT tbl, pk, op FROM sync_log ORDER BY seq").unwrap();
        st.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap().map(|x| x.unwrap()).collect()
    }

    #[test]
    fn insert_update_delete_are_logged() {
        let c = open("iud.db");
        c.execute_batch(
            "INSERT INTO patients (id, full_name) VALUES ('p', 'X');
             UPDATE patients SET full_name = 'Y' WHERE id = 'p';
             DELETE FROM patients WHERE id = 'p';",
        )
        .unwrap();
        let l = log(&c);
        assert_eq!(l.iter().map(|x| x.2.as_str()).collect::<Vec<_>>(), ["u", "u", "d"]);
        assert!(l.iter().all(|x| x.0 == "patients" && x.1 == "p"));
    }

    #[test]
    fn cascade_deletes_are_logged_for_children() {
        let c = open("cascade.db");
        c.execute_batch(
            "INSERT INTO patients (id, full_name) VALUES ('p', 'X');
             INSERT INTO sessions (id, patient_id, session_number, session_date) VALUES ('s', 'p', 1, '2026-01-01');
             INSERT INTO private_notes (id, session_id, note_content) VALUES ('n', 's', 'x');
             DELETE FROM sync_log;
             DELETE FROM patients WHERE id = 'p';",
        )
        .unwrap();
        let l = log(&c);
        for (t, id) in [("patients", "p"), ("sessions", "s"), ("private_notes", "n")] {
            assert!(l.iter().any(|x| x.0 == t && x.1 == id && x.2 == "d"), "{t} silme izi yok: {l:?}");
        }
    }

    #[test]
    fn composite_keys_and_applying_flag() {
        let c = open("applying.db");
        c.execute_batch(
            "INSERT INTO patients (id, full_name) VALUES ('p', 'X');
             INSERT INTO therapy_groups (id, name) VALUES ('g', 'G');
             DELETE FROM sync_log;
             INSERT INTO group_members (group_id, patient_id) VALUES ('g', 'p');",
        )
        .unwrap();
        assert_eq!(log(&c), [("group_members".to_string(), "g|p".to_string(), "u".to_string())]);
        // Uzaktan uygulama sırasında iz yazılmaz.
        c.execute_batch(
            "DELETE FROM sync_log;
             UPDATE sync_meta SET value = '1' WHERE key = 'applying';
             UPDATE patients SET full_name = 'Z' WHERE id = 'p';
             UPDATE sync_meta SET value = '0' WHERE key = 'applying';",
        )
        .unwrap();
        assert!(log(&c).is_empty());
    }

    #[test]
    fn existing_rows_are_seeded_once_and_unsynced_tables_ignored() {
        let c = open("seed.db");
        c.execute_batch("INSERT INTO patients (id, full_name) VALUES ('p', 'X'); INSERT INTO settings (key, value) VALUES ('k', 'v');")
            .unwrap();
        c.execute_batch("DELETE FROM sync_meta WHERE key = 'seeded'; DELETE FROM sync_log;").unwrap();
        install(&c).unwrap();
        install(&c).unwrap(); // ikinci çağrı yeniden tohumlamaz
        assert_eq!(log(&c), [("patients".to_string(), "p".to_string(), "u".to_string())]);
    }

    // ───────── İki cihaz + sahte sunucu ─────────

    use std::collections::HashMap;

    /// Sunucunun `sync_push` / `sync_pull` davranışını taklit eder (aynı kazanma kuralı).
    #[derive(Default)]
    struct FakeServer {
        recs: HashMap<String, SyncItem>,
        seq: i64,
    }

    impl FakeServer {
        fn push(&mut self, items: Vec<SyncItem>) {
            for it in items {
                let wins = match self.recs.get(&it.rec) {
                    None => true,
                    Some(old) => it.ts > old.ts || (it.ts == old.ts && it.device > old.device),
                };
                if wins {
                    self.seq += 1;
                    let mut it = it;
                    it.seq = self.seq;
                    self.recs.insert(it.rec.clone(), it);
                }
            }
        }
        fn pull(&self, after: i64) -> Vec<SyncItem> {
            let mut v: Vec<SyncItem> = self.recs.values().filter(|i| i.seq > after).cloned().collect();
            v.sort_by_key(|i| i.seq);
            v
        }
    }

    fn cursor(c: &Connection) -> i64 {
        meta_get(c, "pull_seq").and_then(|v| v.parse().ok()).unwrap_or(0)
    }

    /// Bir cihazın bir eşitleme turu: önce gönder, sonra çek.
    fn round(c: &mut Connection, k: &SyncKeys, srv: &mut FakeServer) -> ApplyReport {
        loop {
            let b = prepare_push(c, k, 50, 1_000_000).unwrap();
            if b.items.is_empty() {
                commit_push(c, b.upto_seq).unwrap();
                break;
            }
            srv.push(b.items);
            commit_push(c, b.upto_seq).unwrap();
        }
        let items = srv.pull(cursor(c));
        apply_remote(c, k, &items).unwrap()
    }

    fn pair(name: &str) -> (Connection, Connection, SyncKeys, SyncKeys) {
        let a = open(&format!("{name}-a.db"));
        let b = open(&format!("{name}-b.db"));
        let code = enable(&a).unwrap();
        join(&b, &code).unwrap();
        let ka = keys_of(&a).unwrap();
        let kb = keys_of(&b).unwrap();
        (a, b, ka, kb)
    }

    fn tick() {
        std::thread::sleep(std::time::Duration::from_millis(5));
    }

    fn count(c: &Connection, sql: &str) -> i64 {
        c.query_row(sql, [], |r| r.get(0)).unwrap()
    }

    fn name_of(c: &Connection, id: &str) -> String {
        c.query_row("SELECT full_name FROM patients WHERE id = ?1", [id], |r| r.get(0)).unwrap()
    }

    #[test]
    fn pairing_code_gives_both_devices_the_same_vault() {
        let (_, _, ka, kb) = pair("pair");
        assert_eq!(ka.vault, kb.vault);
        assert_eq!(ka.token, kb.token);
        assert_eq!(ka.rec_id("patients", "p"), kb.rec_id("patients", "p"));
        assert_ne!(ka.rec_id("patients", "p"), ka.rec_id("sessions", "p"));
    }

    #[test]
    fn data_flows_between_devices_including_blobs_and_deletes() {
        let (mut a, mut b, ka, kb) = pair("flow");
        let mut srv = FakeServer::default();
        a.execute_batch(
            "INSERT INTO patients (id, full_name, phone) VALUES ('p', 'Ayşe Yılmaz', '555');
             INSERT INTO sessions (id, patient_id, session_number, session_date) VALUES ('s', 'p', 1, '2026-01-01');
             INSERT INTO private_notes (id, session_id, note_content) VALUES ('n', 's', 'gizli not');",
        )
        .unwrap();
        let blob: Vec<u8> = (0..=255u8).cycle().take(5000).collect();
        a.execute(
            "INSERT INTO patient_files (id, patient_id, name, mime, size, data) VALUES ('f', 'p', 'x.bin', 'application/octet-stream', 5000, ?1)",
            [&blob],
        )
        .unwrap();

        round(&mut a, &ka, &mut srv);
        let r = round(&mut b, &kb, &mut srv);
        assert!(r.applied >= 4, "{r:?}");
        assert_eq!(name_of(&b, "p"), "Ayşe Yılmaz");
        assert_eq!(count(&b, "SELECT count(*) FROM private_notes"), 1);
        let got: Vec<u8> = b.query_row("SELECT data FROM patient_files WHERE id = 'f'", [], |r| r.get(0)).unwrap();
        assert_eq!(got, blob);
        // Uzaktan uygulanan değişiklikler B'nin gönderim sırasına girmemeli (yankı yok).
        assert_eq!(prepare_push(&b, &kb, 50, 1_000_000).unwrap().items.len(), 0);

        // B günceller → A görür.
        tick();
        b.execute("UPDATE patients SET full_name = 'Ayşe K.' WHERE id = 'p'", []).unwrap();
        round(&mut b, &kb, &mut srv);
        round(&mut a, &ka, &mut srv);
        assert_eq!(name_of(&a, "p"), "Ayşe K.");

        // A danışanı siler (zincirleme) → B'de de her şey gider.
        tick();
        a.execute("DELETE FROM patients WHERE id = 'p'", []).unwrap();
        round(&mut a, &ka, &mut srv);
        round(&mut b, &kb, &mut srv);
        for t in ["patients", "sessions", "private_notes", "patient_files"] {
            assert_eq!(count(&b, &format!("SELECT count(*) FROM {t}")), 0, "{t} silinmedi");
        }
    }

    #[test]
    fn newer_change_wins_on_conflict() {
        let (mut a, mut b, ka, kb) = pair("conflict");
        let mut srv = FakeServer::default();
        a.execute("INSERT INTO patients (id, full_name) VALUES ('p', 'İlk')", []).unwrap();
        round(&mut a, &ka, &mut srv);
        round(&mut b, &kb, &mut srv);
        // İki cihaz çevrimdışıyken aynı kaydı değiştirir; B daha geç.
        tick();
        a.execute("UPDATE patients SET full_name = 'A değiştirdi' WHERE id = 'p'", []).unwrap();
        tick();
        b.execute("UPDATE patients SET full_name = 'B değiştirdi' WHERE id = 'p'", []).unwrap();
        round(&mut a, &ka, &mut srv);
        round(&mut b, &kb, &mut srv);
        round(&mut a, &ka, &mut srv);
        assert_eq!(name_of(&a, "p"), "B değiştirdi");
        assert_eq!(name_of(&b, "p"), "B değiştirdi");
    }

    #[test]
    fn old_remote_change_does_not_overwrite_newer_local_one() {
        let (mut a, mut b, ka, kb) = pair("stale");
        let mut srv = FakeServer::default();
        a.execute("INSERT INTO patients (id, full_name) VALUES ('p', 'Eski')", []).unwrap();
        round(&mut a, &ka, &mut srv);
        tick();
        // B daha yeni bir değişiklik yapmıştır; A'nın eski kaydı gelince ezmemeli.
        b.execute("INSERT INTO patients (id, full_name) VALUES ('p', 'Yeni')", []).unwrap();
        let r = round(&mut b, &kb, &mut srv);
        assert_eq!(r.applied, 0, "{r:?}");
        assert_eq!(name_of(&b, "p"), "Yeni");
    }

    fn evil_item(k: &SyncKeys, tbl: &str, pk: &str, payload_pk: &str, row: Value, seq: i64) -> SyncItem {
        let rec = k.rec_id(tbl, pk);
        let plain = serde_json::to_vec(&json!({ "t": tbl, "pk": payload_pk, "row": row })).unwrap();
        SyncItem { rec: rec.clone(), ts: 9_999_999_999_999, device: "z".into(), deleted: false, data: Some(k.seal(&rec, &plain).unwrap()), seq }
    }

    #[test]
    fn unknown_tables_wrong_keys_and_tampering_are_rejected() {
        let (_a, mut b, ka, kb) = pair("evil");
        // Doğru anahtarla şifrelenmiş ama izin verilmeyen tabloya yazmaya çalışan kayıt.
        let evil = evil_item(&ka, "settings", "gemini_api_key", "gemini_api_key", json!({ "key": "gemini_api_key", "value": "x" }), 1);
        // Başka bir kasanın anahtarıyla şifrelenmiş kayıt.
        let other = SyncKeys::derive(&"11".repeat(32)).unwrap();
        let foreign = evil_item(&other, "patients", "q", "q", json!({ "id": "q", "full_name": "X" }), 2);
        // Bozulmuş şifreli veri.
        let mut tampered = evil_item(&ka, "patients", "r", "r", json!({ "id": "r", "full_name": "Y" }), 3);
        if let Some(d) = tampered.data.as_mut() {
            d.replace_range(30..34, "AAAA");
        }
        // Kayıt kimliği içeriğiyle uyuşmayan kayıt.
        let mismatch = evil_item(&ka, "patients", "baska", "s", json!({ "id": "s", "full_name": "Z" }), 4);

        let r = apply_remote(&mut b, &kb, &[evil, foreign, tampered, mismatch]).unwrap();
        assert_eq!((r.applied, r.failed), (0, 4), "{r:?}");
        assert_eq!(count(&b, "SELECT count(*) FROM patients"), 0);
        assert_eq!(count(&b, "SELECT count(*) FROM settings WHERE key = 'gemini_api_key'"), 0);
    }

    #[test]
    fn conflicting_session_numbers_do_not_destroy_local_data() {
        let (mut a, mut b, ka, kb) = pair("unique");
        let mut srv = FakeServer::default();
        a.execute("INSERT INTO patients (id, full_name) VALUES ('p', 'X')", []).unwrap();
        round(&mut a, &ka, &mut srv);
        round(&mut b, &kb, &mut srv);
        // İki cihaz çevrimdışıyken aynı danışan için aynı numaralı seans açar.
        a.execute("INSERT INTO sessions (id, patient_id, session_number, session_date) VALUES ('sa', 'p', 1, '2026-02-01')", []).unwrap();
        tick();
        b.execute("INSERT INTO sessions (id, patient_id, session_number, session_date) VALUES ('sb', 'p', 1, '2026-02-02')", []).unwrap();
        round(&mut a, &ka, &mut srv);
        let r = round(&mut b, &kb, &mut srv);
        assert_eq!(r.failed, 1, "{r:?}");
        // B'nin kendi seansı yerinde; kayıp yok.
        assert_eq!(count(&b, "SELECT count(*) FROM sessions WHERE id = 'sb'"), 1);
    }

    #[test]
    fn disabling_and_reenabling_resends_everything() {
        let a = open("reenable.db");
        a.execute("INSERT INTO patients (id, full_name) VALUES ('p', 'X')", []).unwrap();
        enable(&a).unwrap();
        let k = keys_of(&a).unwrap();
        let b = prepare_push(&a, &k, 50, 1_000_000).unwrap();
        assert_eq!(b.items.len(), 1);
        commit_push(&a, b.upto_seq).unwrap();
        assert_eq!(prepare_push(&a, &k, 50, 1_000_000).unwrap().items.len(), 0);
        disable(&a).unwrap();
        assert!(keys_of(&a).is_err());
        enable(&a).unwrap();
        let k2 = keys_of(&a).unwrap();
        assert_eq!(prepare_push(&a, &k2, 50, 1_000_000).unwrap().items.len(), 1);
    }
}
