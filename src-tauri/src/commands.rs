//! Arayüzün çağırdığı Tauri komutları.

use std::path::PathBuf;

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::{AppState, clinical, db, keystore, recovery, turn};

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
    emergency_contact: Option<String>,
    emergency_phone: Option<String>,
    risk_note: Option<String>,
    consent_at: Option<String>,
}

const PATIENT_SELECT: &str = "
    SELECT p.id, p.full_name, p.birth_date, p.phone, p.email, p.status, p.created_at,
        (SELECT count(*) FROM sessions s WHERE s.patient_id = p.id AND s.status = 'completed'),
        (SELECT max(s.session_date) FROM sessions s WHERE s.patient_id = p.id AND s.status = 'completed'),
        (SELECT min(a.appointment_date) FROM appointments a
            WHERE a.patient_id = p.id AND a.status = 'scheduled'
              AND a.appointment_date >= strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')),
        p.emergency_contact, p.emergency_phone, p.risk_note, p.consent_at
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
        emergency_contact: r.get(10)?,
        emergency_phone: r.get(11)?,
        risk_note: r.get(12)?,
        consent_at: r.get(13)?,
    })
}

#[derive(Deserialize)]
pub struct PatientInput {
    full_name: String,
    birth_date: Option<String>,
    phone: Option<String>,
    email: Option<String>,
    status: Option<String>,
    emergency_contact: Option<String>,
    emergency_phone: Option<String>,
    risk_note: Option<String>,
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
            "INSERT INTO patients (id, full_name, birth_date, phone, email, status,
                emergency_contact, emergency_phone, risk_note)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![id, name, opt(&input.birth_date), opt(&input.phone), opt(&input.email),
                    input.status.unwrap_or_else(|| "active".into()),
                    opt(&input.emergency_contact), opt(&input.emergency_phone), opt(&input.risk_note)],
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
                status = coalesce(?6, status), emergency_contact = ?7, emergency_phone = ?8, risk_note = ?9,
                updated_at = CURRENT_TIMESTAMP WHERE id = ?1",
            params![id, name, opt(&input.birth_date), opt(&input.phone), opt(&input.email), input.status,
                    opt(&input.emergency_contact), opt(&input.emergency_phone), opt(&input.risk_note)],
        )?;
        Ok(())
    })
}

/// Danışan görüşmeye katılırken çevrim içi görüşme onamını verdiğinde çağrılır.
#[tauri::command]
pub fn record_patient_consent(state: State<AppState>, id: String) -> AppResult<()> {
    with_conn(&state, |c| {
        c.execute("UPDATE patients SET consent_at = CURRENT_TIMESTAMP WHERE id = ?1", [id])?;
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
    // Alıntı dosyasız da olabilir; metni açıklama alanındadır.
    let path = if input.category == "quote" && input.file_path.trim().is_empty() {
        if opt(&input.description).is_none() {
            return Err(AppError::Invalid("Alıntı metni boş olamaz.".into()));
        }
        String::new()
    } else {
        non_empty(&input.file_path, "Dosya")?
    };
    with_conn(&state, |c| {
        let id = new_id();
        c.execute(
            "INSERT INTO materials (id, title, category, file_path, description) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, title, input.category, path, opt(&input.description)],
        )?;
        Ok(id)
    })
}

/// Danışana gösterilecek materyal dosyasının içeriği (ham bayt). Yol arayüzden alınmaz;
/// yalnızca materyal kütüphanesinde kayıtlı dosya okunabilir.
pub const MAX_MATERIAL_BYTES: u64 = 1024 * 1024 * 1024;

#[tauri::command]
pub fn read_material(state: State<AppState>, id: String) -> AppResult<tauri::ipc::Response> {
    let path: String = with_conn(&state, |c| {
        c.query_row("SELECT file_path FROM materials WHERE id = ?1", [&id], |r| r.get(0))
            .optional()?
            .ok_or_else(|| AppError::Invalid("Materyal bulunamadı.".into()))
    })?;
    if path.is_empty() {
        return Err(AppError::Invalid("Bu materyalin dosyası yok.".into()));
    }
    let meta = std::fs::metadata(&path)
        .map_err(|_| AppError::Invalid("Materyal dosyası bulunamadı. Taşınmış veya silinmiş olabilir.".into()))?;
    if meta.len() > MAX_MATERIAL_BYTES {
        return Err(AppError::Invalid("Materyal dosyası 1 GB'tan büyük.".into()));
    }
    Ok(tauri::ipc::Response::new(std::fs::read(&path)?))
}

#[tauri::command]
pub fn delete_material(state: State<AppState>, id: String) -> AppResult<()> {
    with_conn(&state, |c| {
        c.execute("DELETE FROM materials WHERE id = ?1", [id])?;
        Ok(())
    })
}

// ───────────────────────────── Testler ─────────────────────────────

#[derive(Serialize)]
pub struct Test {
    id: String,
    title: String,
    instructions: Option<String>,
    definition_json: String,
    created_at: String,
    updated_at: Option<String>,
}

#[derive(Deserialize)]
pub struct TestInput {
    title: String,
    instructions: Option<String>,
    definition_json: String,
}

#[tauri::command]
pub fn list_tests(state: State<AppState>) -> AppResult<Vec<Test>> {
    with_conn(&state, |c| {
        let mut st = c.prepare(
            "SELECT id, title, instructions, definition_json, created_at, updated_at
             FROM tests ORDER BY title COLLATE NOCASE",
        )?;
        let rows = st
            .query_map([], |r| {
                Ok(Test {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    instructions: r.get(2)?,
                    definition_json: r.get(3)?,
                    created_at: r.get(4)?,
                    updated_at: r.get(5)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    })
}

/// Yeni test oluşturur (`id` yoksa) veya mevcut testi günceller.
#[tauri::command]
pub fn save_test(state: State<AppState>, id: Option<String>, input: TestInput) -> AppResult<String> {
    let title = non_empty(&input.title, "Test adı")?;
    clinical::parse_definition(&input.definition_json)?;
    with_conn(&state, |c| match id {
        Some(id) => {
            let n = c.execute(
                "UPDATE tests SET title = ?2, instructions = ?3, definition_json = ?4,
                    updated_at = CURRENT_TIMESTAMP WHERE id = ?1",
                params![id, title, opt(&input.instructions), input.definition_json],
            )?;
            if n == 0 {
                return Err(AppError::Invalid("Test bulunamadı.".into()));
            }
            Ok(id)
        }
        None => {
            let id = new_id();
            c.execute(
                "INSERT INTO tests (id, title, instructions, definition_json) VALUES (?1, ?2, ?3, ?4)",
                params![id, title, opt(&input.instructions), input.definition_json],
            )?;
            Ok(id)
        }
    })
}

#[tauri::command]
pub fn delete_test(state: State<AppState>, id: String) -> AppResult<()> {
    // Geçmiş sonuçlar test tanımının kopyasını taşıdığı için silinmez.
    with_conn(&state, |c| {
        c.execute("DELETE FROM tests WHERE id = ?1", [id])?;
        Ok(())
    })
}

#[derive(Serialize)]
pub struct TestResult {
    id: String,
    patient_id: String,
    session_id: Option<String>,
    session_number: Option<i64>,
    test_id: Option<String>,
    test_title: String,
    definition_json: String,
    answers_json: String,
    total_score: Option<i64>,
    completed_at: String,
}

#[derive(Deserialize)]
pub struct TestResultInput {
    patient_id: String,
    session_id: Option<String>,
    test_id: Option<String>,
    test_title: String,
    definition_json: String,
    answers_json: String,
}

/// Danışanın gönderdiği cevapları kaydeder. Cevaplar test tanımına göre denetlenir ve
/// puan burada yeniden hesaplanır; danışan tarafından gelen puana güvenilmez.
#[tauri::command]
pub fn save_test_result(state: State<AppState>, input: TestResultInput) -> AppResult<TestResult> {
    let def = clinical::parse_definition(&input.definition_json)?;
    let answers: clinical::Answers =
        serde_json::from_str(&input.answers_json).map_err(|_| AppError::Invalid("Cevaplar okunamadı.".into()))?;
    let total = clinical::score(&def, &answers)?;
    // Yalnızca tanımlı alanlar saklanır; danışandan gelen fazlalık yok sayılır.
    let answers_json = serde_json::to_string(&answers).map_err(|_| AppError::Invalid("Cevaplar yazılamadı.".into()))?;
    let title = non_empty(&input.test_title, "Test adı")?;
    with_conn(&state, |c| {
        let id = new_id();
        c.execute(
            "INSERT INTO test_results (id, patient_id, session_id, test_id, test_title, definition_json, answers_json, total_score)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![id, input.patient_id, input.session_id, input.test_id, title, input.definition_json, answers_json, total],
        )?;
        c.query_row(&format!("{TEST_RESULT_SELECT} WHERE r.id = ?1"), [&id], map_test_result)
            .map_err(Into::into)
    })
}

const TEST_RESULT_SELECT: &str = "
    SELECT r.id, r.patient_id, r.session_id, s.session_number, r.test_id, r.test_title,
           r.definition_json, r.answers_json, r.total_score, r.completed_at
    FROM test_results r LEFT JOIN sessions s ON s.id = r.session_id";

fn map_test_result(r: &rusqlite::Row) -> rusqlite::Result<TestResult> {
    Ok(TestResult {
        id: r.get(0)?,
        patient_id: r.get(1)?,
        session_id: r.get(2)?,
        session_number: r.get(3)?,
        test_id: r.get(4)?,
        test_title: r.get(5)?,
        definition_json: r.get(6)?,
        answers_json: r.get(7)?,
        total_score: r.get(8)?,
        completed_at: r.get(9)?,
    })
}

#[tauri::command]
pub fn list_test_results(state: State<AppState>, patient_id: String) -> AppResult<Vec<TestResult>> {
    with_conn(&state, |c| {
        let mut st = c.prepare(&format!("{TEST_RESULT_SELECT} WHERE r.patient_id = ?1 ORDER BY r.completed_at DESC"))?;
        let rows = st.query_map([patient_id], map_test_result)?.collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    })
}

// ───────────────────────────── Ödevler ─────────────────────────────

const HOMEWORK_STATUSES: &[&str] = &["assigned", "done", "partial", "not_done"];

#[derive(Serialize)]
pub struct Homework {
    id: String,
    patient_id: String,
    session_id: Option<String>,
    session_number: Option<i64>,
    title: String,
    description: Option<String>,
    due_date: Option<String>,
    status: String,
    review_note: Option<String>,
    delivered_at: Option<String>,
    reviewed_at: Option<String>,
    created_at: String,
}

#[derive(Deserialize)]
pub struct HomeworkInput {
    patient_id: String,
    session_id: Option<String>,
    title: String,
    description: Option<String>,
    due_date: Option<String>,
}

const HOMEWORK_SELECT: &str = "
    SELECT h.id, h.patient_id, h.session_id, s.session_number, h.title, h.description, h.due_date,
           h.status, h.review_note, h.delivered_at, h.reviewed_at, h.created_at
    FROM homework h LEFT JOIN sessions s ON s.id = h.session_id";

fn map_homework(r: &rusqlite::Row) -> rusqlite::Result<Homework> {
    Ok(Homework {
        id: r.get(0)?,
        patient_id: r.get(1)?,
        session_id: r.get(2)?,
        session_number: r.get(3)?,
        title: r.get(4)?,
        description: r.get(5)?,
        due_date: r.get(6)?,
        status: r.get(7)?,
        review_note: r.get(8)?,
        delivered_at: r.get(9)?,
        reviewed_at: r.get(10)?,
        created_at: r.get(11)?,
    })
}

#[tauri::command]
pub fn list_homework(state: State<AppState>, patient_id: String) -> AppResult<Vec<Homework>> {
    with_conn(&state, |c| {
        let mut st = c.prepare(&format!("{HOMEWORK_SELECT} WHERE h.patient_id = ?1 ORDER BY h.created_at DESC"))?;
        let rows = st.query_map([patient_id], map_homework)?.collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    })
}

#[tauri::command]
pub fn create_homework(state: State<AppState>, input: HomeworkInput) -> AppResult<Homework> {
    let title = non_empty(&input.title, "Ödev başlığı")?;
    with_conn(&state, |c| {
        let id = new_id();
        c.execute(
            "INSERT INTO homework (id, patient_id, session_id, title, description, due_date)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, input.patient_id, input.session_id, title, opt(&input.description), opt(&input.due_date)],
        )?;
        c.query_row(&format!("{HOMEWORK_SELECT} WHERE h.id = ?1"), [&id], map_homework)
            .map_err(Into::into)
    })
}

/// Sonraki seansta ödevin durumu ve terapistin notu.
#[tauri::command]
pub fn review_homework(state: State<AppState>, id: String, status: String, review_note: Option<String>) -> AppResult<()> {
    if !HOMEWORK_STATUSES.contains(&status.as_str()) {
        return Err(AppError::Invalid("Geçersiz ödev durumu.".into()));
    }
    with_conn(&state, |c| {
        c.execute(
            "UPDATE homework SET status = ?2, review_note = ?3,
                reviewed_at = CASE WHEN ?2 = 'assigned' THEN NULL ELSE CURRENT_TIMESTAMP END
             WHERE id = ?1",
            params![id, status, opt(&review_note)],
        )?;
        Ok(())
    })
}

/// Danışan sayfası ödevi aldığını bildirdiğinde çağrılır.
#[tauri::command]
pub fn mark_homework_delivered(state: State<AppState>, id: String) -> AppResult<()> {
    with_conn(&state, |c| {
        c.execute("UPDATE homework SET delivered_at = CURRENT_TIMESTAMP WHERE id = ?1", [id])?;
        Ok(())
    })
}

#[tauri::command]
pub fn delete_homework(state: State<AppState>, id: String) -> AppResult<()> {
    with_conn(&state, |c| {
        c.execute("DELETE FROM homework WHERE id = ?1", [id])?;
        Ok(())
    })
}

// ───────────────────────────── TURN ─────────────────────────────

/// Cloudflare TURN ayarlıysa bu görüşme için kısa ömürlü ICE sunucuları üretir; ayarlı değilse `None`.
#[tauri::command]
pub async fn generate_turn_servers(state: State<'_, AppState>) -> AppResult<Option<serde_json::Value>> {
    let (key_id, token) = with_conn(&state, |c| {
        let get = |k: &str| -> AppResult<String> {
            Ok(c.query_row("SELECT value FROM settings WHERE key = ?1", [k], |r| r.get::<_, String>(0))
                .optional()?
                .unwrap_or_default())
        };
        Ok((get("cf_turn_key_id")?, get("cf_turn_api_token")?))
    })?;
    if key_id.trim().is_empty() || token.trim().is_empty() {
        return Ok(None);
    }
    turn::generate(&key_id, &token).await.map(Some)
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

// ───────────────────────────── Kurtarma anahtarı ─────────────────────────────

const RECOVERY_CONFIRMED: &str = "recovery_key_confirmed_at";

/// Bu bilgisayarın veritabanı anahtarını kurtarma anahtarı biçiminde döndürür.
#[tauri::command]
pub fn get_recovery_key(state: State<AppState>) -> AppResult<String> {
    with_conn(&state, |_| Ok(()))?;
    let key = keystore::load_key()?.ok_or_else(|| AppError::Key("Anahtar bulunamadı.".into()))?;
    Ok(recovery::encode(&key)?.to_string())
}

/// Terapistin kurtarma anahtarını doğru kaydettiğini, anahtarı yeniden yazdırarak doğrular.
#[tauri::command]
pub fn confirm_recovery_key(state: State<AppState>, input: String) -> AppResult<()> {
    let typed = recovery::decode(&input)?;
    let key = keystore::load_key()?.ok_or_else(|| AppError::Key("Anahtar bulunamadı.".into()))?;
    if *typed != *key {
        return Err(AppError::Invalid("Girdiğiniz anahtar bu bilgisayarın kurtarma anahtarıyla eşleşmiyor.".into()));
    }
    with_conn(&state, |c| {
        c.execute(
            "INSERT INTO settings (key, value) VALUES (?1, datetime('now'))
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [RECOVERY_CONFIRMED],
        )?;
        Ok(())
    })
}

/// Veritabanı duruyor ama anahtarı güvenli depoda yoksa (ör. Windows yeniden kuruldu):
/// kurtarma anahtarıyla veritabanını açar ve anahtarı güvenli depoya geri yazar.
#[tauri::command]
pub fn unlock_with_recovery_key(state: State<AppState>, recovery_key: String) -> AppResult<()> {
    let key = recovery::decode(&recovery_key)?;
    let mut guard = state.conn.lock().map_err(|_| AppError::Invalid("Kilit hatası".into()))?;
    if guard.is_some() {
        return Err(AppError::Invalid("Veritabanı zaten açık.".into()));
    }
    let mut conn = db::open_encrypted(&state.db_path, &key)
        .map_err(|_| AppError::Key("Bu kurtarma anahtarı bu bilgisayardaki veritabanına ait değil.".into()))?;
    db::migrate(&mut conn)?;
    keystore::store_key(&key)?;
    *guard = Some(conn);
    *state.init_error.lock().unwrap() = None;
    Ok(())
}

/// Başka bir bilgisayarda alınmış yedeği, o bilgisayarın kurtarma anahtarıyla geri yükler.
/// Yedek önce geçici dosyada doğrulanır; ancak ondan sonra mevcut veritabanı ve anahtar değiştirilir.
#[tauri::command]
pub fn restore_with_recovery_key(state: State<AppState>, src: String, recovery_key: String) -> AppResult<()> {
    let key = recovery::decode(&recovery_key)?;
    let src = PathBuf::from(src);
    if src == state.db_path {
        return Err(AppError::Invalid("Ana veritabanı kendisinden geri yüklenemez.".into()));
    }
    let prepared = db::with_suffix(&state.db_path, ".restore");
    if let Err(e) = db::prepare_restore(&src, &prepared, &key) {
        let _ = db::remove_with_sidecars(&prepared);
        return Err(e);
    }

    let mut guard = state.conn.lock().map_err(|_| AppError::Invalid("Kilit hatası".into()))?;
    let previous_key = keystore::load_key().ok().flatten();
    // Bir şey ters giderse eski anahtar ve veritabanı yerinde kalır.
    let roll_back = |guard: &mut Option<Connection>| {
        let _ = db::remove_with_sidecars(&prepared);
        if let Some(k) = &previous_key {
            let _ = keystore::store_key(k);
            *guard = db::open_encrypted(&state.db_path, k).ok();
        }
    };

    guard.take(); // Ana veritabanı bağlantısını kapat.
    if let Err(e) = keystore::store_key(&key) {
        roll_back(&mut guard);
        return Err(e);
    }
    if let Err(e) = db::swap_in(&prepared, &state.db_path) {
        roll_back(&mut guard);
        return Err(e);
    }
    *guard = Some(db::open_encrypted(&state.db_path, &key)?);
    *state.init_error.lock().unwrap() = None;
    Ok(())
}
