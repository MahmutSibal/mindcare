mod commands;
mod db;
mod error;
mod keystore;

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::Connection;
use tauri::Manager;

use crate::error::{AppError, AppResult};

pub struct AppState {
    pub conn: Mutex<Option<Connection>>,
    pub init_error: Mutex<Option<String>>,
    pub db_path: PathBuf,
}

/// Anahtarı yükler (ilk kurulumda üretir), veritabanını açar ve migration'ları uygular.
fn init_database(path: &Path) -> AppResult<Connection> {
    let key = match keystore::load_key()? {
        Some(k) => k,
        None if path.exists() => {
            // Veritabanı var ama anahtar yok: yeni anahtar üretmek veriyi kalıcı olarak
            // erişilemez kılar, bu yüzden burada duruyoruz.
            return Err(AppError::Key(
                "Şifreli veritabanı bulundu ancak anahtarı güvenli depoda yok. \
                 Veriler anahtar olmadan açılamaz. Yeni anahtar üretilmedi."
                    .into(),
            ));
        }
        None => keystore::create_key()?,
    };
    let mut conn = db::open_encrypted(path, &key)?;
    db::migrate(&mut conn)?;
    Ok(conn)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let db_path = dir.join("mindcare.db");
            let (conn, err) = match init_database(&db_path) {
                Ok(c) => (Some(c), None),
                Err(e) => (None, Some(e.to_string())),
            };
            app.manage(AppState {
                conn: Mutex::new(conn),
                init_error: Mutex::new(err),
                db_path,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_status,
            commands::list_patients,
            commands::get_patient,
            commands::create_patient,
            commands::update_patient,
            commands::delete_patient,
            commands::list_sessions,
            commands::start_session,
            commands::finish_session,
            commands::update_session_duration,
            commands::cancel_session,
            commands::list_notes,
            commands::save_note,
            commands::get_session_note,
            commands::list_appointments,
            commands::create_appointment,
            commands::set_appointment_status,
            commands::delete_appointment,
            commands::list_materials,
            commands::create_material,
            commands::delete_material,
            commands::get_settings,
            commands::set_setting,
            commands::backup_database,
            commands::restore_database,
        ])
        .run(tauri::generate_context!())
        .expect("MindCare başlatılamadı");
}
