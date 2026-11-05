//! Arayüzün çağırdığı Tauri komutları.

use std::path::PathBuf;

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::{AppState, db, keystore};

fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn with_conn<T>(state: &State<AppState>, f: impl FnOnce(&mut Connection) -> AppResult<T>) -> AppResult<T> {
    let mut guard = state.conn.lock().map_err(|_| AppError::Invalid("Kilit hatası".into()))?;
    match guard.as_mut() {
        Some(c) => f(c),
        None => Err(AppError::NotReady(state.init_error.lock().unwrap().clone().unwrap_or_default())),
    }
}

fn non_empty(s: &str, field: &str) -> AppResult<String> {
    let t = s.trim();
    if t.is_empty() {
        return Err(AppError::Invalid(format!("{field} boş olamaz.")));
    }
    Ok(t.to_string())
}

fn opt(s: &Option<String>) -> Option<String> {
    s.as_ref().map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

// ───────────────────────────── Uygulama durumu ─────────────────────────────

#[derive(Serialize)]
pub struct AppStatus {
    ready: bool,
    error: Option<String>,
    cipher_version: Option<String>,
    db_path: String,
}

#[tauri::command]
pub fn app_status(state: State<AppState>) -> AppStatus {
    let guard = state.conn.lock().unwrap();
    let cipher_version = guard
        .as_ref()
        .and_then(|c| c.query_row("PRAGMA cipher_version", [], |r| r.get::<_, String>(0)).ok());
    AppStatus {
        ready: guard.is_some(),
        error: state.init_error.lock().unwrap().clone(),
        cipher_version,
        db_path: state.db_path.display().to_string(),
    }
}

// ───────────────────────────── Danışanlar ─────────────────────────────

#[derive(Serialize)]
pub struct Patient {
    id: String,
    full_name: String,
    birth_date: Option<String>,
    phone: Option<String>,
    email: Option<String>,
    status: String,
    created_at: String,
    completed_sessions: i64,
    last_session_date: Option<String>,
    next_appointment: Option<String>,
}

const PATIENT_SELECT: &str = "
    SELECT p.id, p.full_name, p.birth_date, p.phone, p.email, p.status, p.created_at,
        (SELECT count(*) FROM sessions s WHERE s.patient_id = p.id AND s.status = 'completed'),
        (SELECT max(s.session_date) FROM sessions s WHERE s.patient_id = p.id AND s.status = 'completed'),
        (SELECT min(a.appointment_date) FROM appointments a
            WHERE a.patient_id = p.id AND a.status = 'scheduled'
              AND a.appointment_date >= strftime('%Y-%m-%dT%H:%M', 'now', 'localtime'))
    FROM patients p";

fn map_patient(r: &rusqlite::Row) -> rusqlite::Result<Patient> {
    Ok(Patient {
        id: r.get(0)?,
        full_name: r.get(1)?,
        birth_date: r.get(2)?,
        phone: r.get(3)?,
        email: r.get(4)?,
        status: r.get(5)?,
        created_at: r.get(6)?,
        completed_sessions: r.get(7)?,
        last_session_date: r.get(8)?,
        next_appointment: r.get(9)?,
    })
}

#[derive(Deserialize)]
pub struct PatientInput {
    full_name: String,
    birth_date: Option<String>,
    phone: Option<String>,
    email: Option<String>,
    status: Option<String>,
}

#[tauri::command]
pub fn list_patients(state: State<AppState>) -> AppResult<Vec<Patient>> {
    with_conn(&state, |c| {
        let mut st = c.prepare(&format!("{PATIENT_SELECT} ORDER BY p.full_name COLLATE NOCASE"))?;
        let rows = st.query_map([], map_patient)?.collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    })
}

#[tauri::command]
pub fn get_patient(state: State<AppState>, id: String) -> AppResult<Patient> {
    with_conn(&state, |c| {
        Ok(c.query_row(&format!("{PATIENT_SELECT} WHERE p.id = ?1"), [id], map_patient)?)
    })
}

#[tauri::command]
pub fn create_patient(state: State<AppState>, input: PatientInput) -> AppResult<String> {
    let name = non_empty(&input.full_name, "Ad soyad")?;
    with_conn(&state, |c| {
        let id = new_id();
        c.execute(
            "INSERT INTO patients (id, full_name, birth_date, phone, email, status)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, name, opt(&input.birth_date), opt(&input.phone), opt(&input.email),
                    input.status.unwrap_or_else(|| "active".into())],
        )?;
        Ok(id)
    })
}

#[tauri::command]
pub fn update_patient(state: State<AppState>, id: String, input: PatientInput) -> AppResult<()> {
    let name = non_empty(&input.full_name, "Ad soyad")?;
    with_conn(&state, |c| {
        c.execute(
            "UPDATE patients SET full_name = ?2, birth_date = ?3, phone = ?4, email = ?5,
                status = coalesce(?6, status), updated_at = CURRENT_TIMESTAMP WHERE id = ?1",
            params![id, name, opt(&input.birth_date), opt(&input.phone), opt(&input.email), input.status],
        )?;
        Ok(())
    })
}

#[tauri::command]
pub fn delete_patient(state: State<AppState>, id: String) -> AppResult<()> {
    with_conn(&state, |c| {
        c.execute("DELETE FROM patients WHERE id = ?1", [id])?;
        Ok(())
    })
}

// ───────────────────────────── Seanslar ─────────────────────────────

#[derive(Serialize)]
pub struct Session {
    id: String,
    patient_id: String,
    patient_name: String,
    session_number: i64,
    session_date: String,
    duration_seconds: i64,
    status: String,
}

fn map_session(r: &rusqlite::Row) -> rusqlite::Result<Session> {
    Ok(Session {
        id: r.get(0)?,
        patient_id: r.get(1)?,
        patient_name: r.get(2)?,
        session_number: r.get(3)?,
        session_date: r.get(4)?,
        duration_seconds: r.get(5)?,
        status: r.get(6)?,
    })
}

const SESSION_SELECT: &str = "
    SELECT s.id, s.patient_id, p.full_name, s.session_number, s.session_date,
           s.duration_seconds, s.status
    FROM sessions s JOIN patients p ON p.id = s.patient_id";

#[tauri::command]
pub fn list_sessions(state: State<AppState>, patient_id: Option<String>) -> AppResult<Vec<Session>> {
    with_conn(&state, |c| {
        let mut st = c.prepare(&format!(
            "{SESSION_SELECT} WHERE (?1 IS NULL OR s.patient_id = ?1)
             ORDER BY s.session_date DESC, s.session_number DESC"
        ))?;
        let rows = st.query_map([patient_id], map_session)?.collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    })
}

/// Yeni seans başlatır (durum: in_progress). Seans numarası danışana göre artar.
#[tauri::command]
pub fn start_session(state: State<AppState>, patient_id: String) -> AppResult<Session> {
    with_conn(&state, |c| {
        let tx = c.transaction()?;
        let next: i64 = tx.query_row(
            "SELECT coalesce(max(session_number), 0) + 1 FROM sessions WHERE patient_id = ?1",
            [&patient_id],
            |r| r.get(0),
        )?;
        let id = new_id();
        tx.execute(
            "INSERT INTO sessions (id, patient_id, session_number, session_date, status)
             VALUES (?1, ?2, ?3, strftime('%Y-%m-%dT%H:%M:%S', 'now', 'localtime'), 'in_progress')",
            params![id, patient_id, next],
        )?;
        let s = tx.query_row(&format!("{SESSION_SELECT} WHERE s.id = ?1"), [&id], map_session)?;
        tx.commit()?;
        Ok(s)
    })
}

#[tauri::command]
pub fn finish_session(state: State<AppState>, id: String, duration_seconds: i64) -> AppResult<()> {
    with_conn(&state, |c| {
        c.execute(
            "UPDATE sessions SET status = 'completed', duration_seconds = ?2 WHERE id = ?1",
            params![id, duration_seconds.max(0)],
        )?;
        Ok(())
    })
}

#[tauri::command]
pub fn update_session_duration(state: State<AppState>, id: String, duration_seconds: i64) -> AppResult<()> {
    with_conn(&state, |c| {
        c.execute(
            "UPDATE sessions SET duration_seconds = ?2 WHERE id = ?1",
            params![id, duration_seconds.max(0)],
        )?;
        Ok(())
    })
}

#[tauri::command]
pub fn cancel_session(state: State<AppState>, id: String) -> AppResult<()> {
    with_conn(&state, |c| {
        c.execute("UPDATE sessions SET status = 'cancelled' WHERE id = ?1", [id])?;
        Ok(())
    })
}

// ───────────────────────────── Klinik notlar ─────────────────────────────

#[derive(Serialize)]
pub struct Note {
    id: String,
    session_id: String,
    session_number: i64,
    session_date: String,
    note_content: String,
    created_at: String,
    updated_at: Option<String>,
}

#[tauri::command]
pub fn list_notes(state: State<AppState>, patient_id: String) -> AppResult<Vec<Note>> {
    with_conn(&state, |c| {
        let mut st = c.prepare(
            "SELECT n.id, n.session_id, s.session_number, s.session_date, n.note_content,
                    n.created_at, n.updated_at
             FROM private_notes n JOIN sessions s ON s.id = n.session_id
             WHERE s.patient_id = ?1
             ORDER BY s.session_date DESC, n.created_at DESC",
        )?;
        let rows = st
            .query_map([patient_id], |r| {
                Ok(Note {
                    id: r.get(0)?,
                    session_id: r.get(1)?,
                    session_number: r.get(2)?,
                    session_date: r.get(3)?,
                    note_content: r.get(4)?,
                    created_at: r.get(5)?,
                    updated_at: r.get(6)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    })
}

/// Seansın notunu oluşturur veya günceller (seans başına tek not). Not kimliğini döndürür.
#[tauri::command]
pub fn save_note(state: State<AppState>, session_id: String, content: String) -> AppResult<String> {
    with_conn(&state, |c| {
        let existing: Option<String> = c
            .query_row("SELECT id FROM private_notes WHERE session_id = ?1 LIMIT 1", [&session_id], |r| r.get(0))
            .optional()?;
        match existing {
            Some(id) => {
                c.execute(
                    "UPDATE private_notes SET note_content = ?2, updated_at = CURRENT_TIMESTAMP WHERE id = ?1",
                    params![id, content],
                )?;
                Ok(id)
            }
            None => {
                let id = new_id();
                c.execute(
                    "INSERT INTO private_notes (id, session_id, note_content) VALUES (?1, ?2, ?3)",
                    params![id, session_id, content],
                )?;
                Ok(id)
            }
        }
    })
}

#[tauri::command]
pub fn get_session_note(state: State<AppState>, session_id: String) -> AppResult<Option<String>> {
    with_conn(&state, |c| {
        Ok(c.query_row(
            "SELECT note_content FROM private_notes WHERE session_id = ?1 LIMIT 1",
            [session_id],
            |r| r.get(0),
        )
        .optional()?)
    })
}

// ───────────────────────────── Randevular ─────────────────────────────

#[derive(Serialize)]
pub struct Appointment {
    id: String,
    patient_id: String,
    patient_name: String,
    appointment_date: String,
    duration_minutes: i64,
    status: String,
}

#[derive(Deserialize)]
pub struct AppointmentInput {
    patient_id: String,
    appointment_date: String,
    duration_minutes: Option<i64>,
}

#[tauri::command]
pub fn list_appointments(state: State<AppState>, patient_id: Option<String>) -> AppResult<Vec<Appointment>> {
    with_conn(&state, |c| {
        let mut st = c.prepare(
            "SELECT a.id, a.patient_id, p.full_name, a.appointment_date, a.duration_minutes, a.status
             FROM appointments a JOIN patients p ON p.id = a.patient_id
             WHERE (?1 IS NULL OR a.patient_id = ?1)
             ORDER BY a.appointment_date",
        )?;
        let rows = st
            .query_map([patient_id], |r| {
                Ok(Appointment {
                    id: r.get(0)?,
                    patient_id: r.get(1)?,
                    patient_name: r.get(2)?,
                    appointment_date: r.get(3)?,
                    duration_minutes: r.get(4)?,
                    status: r.get(5)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    })
}

#[tauri::command]
pub fn create_appointment(state: State<AppState>, input: AppointmentInput) -> AppResult<String> {
    let date = non_empty(&input.appointment_date, "Randevu tarihi")?;
    let minutes = input.duration_minutes.unwrap_or(50);
    if !(5..=480).contains(&minutes) {
        return Err(AppError::Invalid("Süre 5–480 dakika arasında olmalıdır.".into()));
    }
    with_conn(&state, |c| {
        let id = new_id();
        c.execute(
            "INSERT INTO appointments (id, patient_id, appointment_date, duration_minutes)
             VALUES (?1, ?2, ?3, ?4)",
            params![id, input.patient_id, date, minutes],
        )?;
        Ok(id)
    })
}

#[tauri::command]
pub fn set_appointment_status(state: State<AppState>, id: String, status: String) -> AppResult<()> {
    with_conn(&state, |c| {
        c.execute("UPDATE appointments SET status = ?2 WHERE id = ?1", params![id, status])?;
        Ok(())
    })
}

#[tauri::command]
pub fn delete_appointment(state: State<AppState>, id: String) -> AppResult<()> {
    with_conn(&state, |c| {
        c.execute("DELETE FROM appointments WHERE id = ?1", [id])?;
        Ok(())
    })
}

// ───────────────────────────── Materyaller ─────────────────────────────

#[derive(Serialize)]
pub struct Material {
    id: String,
    title: String,
    category: String,
    file_path: String,
    description: Option<String>,
    created_at: String,
}

#[derive(Deserialize)]
pub struct MaterialInput {
    title: String,
    category: String,
    file_path: String,
    description: Option<String>,
}

#[tauri::command]
pub fn list_materials(state: State<AppState>) -> AppResult<Vec<Material>> {
    with_conn(&state, |c| {
        let mut st = c.prepare(
            "SELECT id, title, category, file_path, description, created_at
             FROM materials ORDER BY created_at DESC",
        )?;
        let rows = st
            .query_map([], |r| {
                Ok(Material {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    category: r.get(2)?,
                    file_path: r.get(3)?,
                    description: r.get(4)?,
                    created_at: r.get(5)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    })
}

#[tauri::command]
pub fn create_material(state: State<AppState>, input: MaterialInput) -> AppResult<String> {
    let title = non_empty(&input.title, "Başlık")?;
    let path = non_empty(&input.file_path, "Dosya")?;
    with_conn(&state, |c| {
        let id = new_id();
        c.execute(
            "INSERT INTO materials (id, title, category, file_path, description) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, title, input.category, path, opt(&input.description)],
        )?;
        Ok(id)
    })
}

#[tauri::command]
pub fn delete_material(state: State<AppState>, id: String) -> AppResult<()> {
    with_conn(&state, |c| {
        c.execute("DELETE FROM materials WHERE id = ?1", [id])?;
        Ok(())
    })
}

// ───────────────────────────── Ayarlar ─────────────────────────────

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> AppResult<std::collections::HashMap<String, String>> {
    with_conn(&state, |c| {
        let mut st = c.prepare("SELECT key, value FROM settings")?;
        let rows = st
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
            .collect::<Result<_, _>>()?;
        Ok(rows)
    })
}

#[tauri::command]
pub fn set_setting(state: State<AppState>, key: String, value: String) -> AppResult<()> {
    with_conn(&state, |c| {
        c.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    })
}

// ───────────────────────────── Yedekleme ─────────────────────────────

#[tauri::command]
pub fn backup_database(state: State<AppState>, dest: String) -> AppResult<()> {
    let dest = PathBuf::from(dest);
    if dest == state.db_path {
        return Err(AppError::Invalid("Yedek, ana veritabanının üzerine yazılamaz.".into()));
    }
    let key = keystore::load_key()?.ok_or_else(|| AppError::Key("Anahtar bulunamadı.".into()))?;
    with_conn(&state, |c| db::backup_to(c, &dest, &key))
}

#[tauri::command]
pub fn restore_database(state: State<AppState>, src: String) -> AppResult<()> {
    let src = PathBuf::from(src);
    if src == state.db_path {
        return Err(AppError::Invalid("Ana veritabanı kendisinden geri yüklenemez.".into()));
    }
    let key = keystore::load_key()?.ok_or_else(|| AppError::Key("Anahtar bulunamadı.".into()))?;
    with_conn(&state, |c| db::restore_from(c, &src, &key))
}
