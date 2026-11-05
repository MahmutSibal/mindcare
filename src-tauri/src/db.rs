//! SQLCipher ile şifrelenmiş yerel veritabanı: açma, migration ve yedekleme.

use std::path::Path;
use std::time::Duration;

use rusqlite::{Connection, backup::Backup};
use zeroize::Zeroizing;

use crate::error::{AppError, AppResult};

/// Sıralı şema değişiklikleri. Yeni değişiklik daima listenin sonuna eklenir;
/// mevcut adımlar asla düzenlenmez. Uygulanan son adım `PRAGMA user_version`
/// içinde tutulur.
const MIGRATIONS: &[&str] = &[
    // 1 — Temel şema
    r#"
    CREATE TABLE patients (
        id TEXT PRIMARY KEY,
        full_name TEXT NOT NULL,
        birth_date TEXT,
        phone TEXT,
        email TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','passive')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME
    );

    CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        patient_id TEXT NOT NULL,
        session_number INTEGER NOT NULL,
        session_date DATETIME NOT NULL,
        duration_seconds INTEGER DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'planned'
            CHECK (status IN ('planned','in_progress','completed','cancelled')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
        UNIQUE (patient_id, session_number)
    );
    CREATE INDEX idx_sessions_patient_date ON sessions(patient_id, session_date DESC);

    CREATE TABLE private_notes (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        note_content TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
    CREATE INDEX idx_notes_session ON private_notes(session_id);

    CREATE TABLE materials (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        category TEXT NOT NULL CHECK (category IN ('video','image','quote','test','document')),
        file_path TEXT NOT NULL,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE appointments (
        id TEXT PRIMARY KEY,
        patient_id TEXT NOT NULL,
        appointment_date DATETIME NOT NULL,
        duration_minutes INTEGER DEFAULT 50,
        status TEXT NOT NULL DEFAULT 'scheduled'
            CHECK (status IN ('scheduled','completed','cancelled','no_show')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
    );
    CREATE INDEX idx_appointments_date ON appointments(appointment_date);
    CREATE INDEX idx_appointments_patient ON appointments(patient_id, appointment_date);

    CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
    "#,
];

fn apply_key(conn: &Connection, key: &Zeroizing<String>) -> AppResult<()> {
    // Ham 256 bit anahtar (KDF atlanır; anahtar zaten rastgele üretildi).
    let pragma = Zeroizing::new(format!("PRAGMA key = \"x'{}'\";", key.as_str()));
    conn.execute_batch(&pragma)?;
    Ok(())
}

/// Anahtarla bağlantı açar ve anahtarın doğru olduğunu doğrular.
pub fn open_encrypted(path: &Path, key: &Zeroizing<String>) -> AppResult<Connection> {
    let conn = Connection::open(path)?;
    apply_key(&conn, key)?;
    // SQLCipher yanlış anahtarda ilk okumada "file is not a database" hatası verir.
    conn.query_row("SELECT count(*) FROM sqlite_master", [], |r| r.get::<_, i64>(0))
        .map_err(|_| {
            AppError::Key("Veritabanı bu anahtarla açılamadı (yanlış anahtar veya bozuk dosya).".into())
        })?;
    let version: String = conn.query_row("PRAGMA cipher_version", [], |r| r.get(0))
        .map_err(|_| AppError::Key("SQLCipher etkin değil.".into()))?;
    if version.is_empty() {
        return Err(AppError::Key("SQLCipher etkin değil.".into()));
    }
    conn.execute_batch(
        "PRAGMA foreign_keys = ON;
         PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA secure_delete = ON;",
    )?;
    conn.busy_timeout(Duration::from_secs(5))?;
    Ok(conn)
}

pub fn migrate(conn: &mut Connection) -> AppResult<()> {
    let current: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    let target = MIGRATIONS.len() as i64;
    if current > target {
        return Err(AppError::Invalid(
            "Veritabanı bu uygulama sürümünden daha yeni. Lütfen uygulamayı güncelleyin.".into(),
        ));
    }
    for (i, sql) in MIGRATIONS.iter().enumerate().skip(current as usize) {
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", (i + 1) as i64)?;
        tx.commit()?;
    }
    Ok(())
}

/// Şifreli yedek: hedef dosya aynı anahtarla açılır, sayfalar SQLite yedekleme
/// API'siyle kopyalanır. Yedek hiçbir zaman şifresiz yazılmaz.
pub fn backup_to(conn: &Connection, dest: &Path, key: &Zeroizing<String>) -> AppResult<()> {
    if dest.exists() {
        std::fs::remove_file(dest)?;
    }
    let mut dst = Connection::open(dest)?;
    apply_key(&dst, key)?;
    {
        let b = Backup::new(conn, &mut dst)?;
        b.run_to_completion(256, Duration::from_millis(0), None)?;
    }
    // Yedeğin okunabildiğini doğrula.
    drop(dst);
    open_encrypted(dest, key)?;
    Ok(())
}

/// Yedekten geri yükleme. Önce yedek doğrulanır, ardından ana veritabanının
/// üzerine yazılır ve migration'lar çalıştırılır.
pub fn restore_from(conn: &mut Connection, src: &Path, key: &Zeroizing<String>) -> AppResult<()> {
    let src_conn = open_encrypted(src, key)?;
    let v: i64 = src_conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if v == 0 || v > MIGRATIONS.len() as i64 {
        return Err(AppError::Invalid("Seçilen dosya geçerli bir MindCare yedeği değil.".into()));
    }
    {
        let b = Backup::new(&src_conn, conn)?;
        b.run_to_completion(256, Duration::from_millis(0), None)?;
    }
    migrate(conn)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(c: char) -> Zeroizing<String> {
        Zeroizing::new(std::iter::repeat_n(c, 64).collect())
    }

    fn tmp(name: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("mindcare-test-{}-{name}", std::process::id()));
        let _ = std::fs::remove_file(&d);
        d
    }

    #[test]
    fn file_is_encrypted_and_wrong_key_fails() {
        let p = tmp("enc.db");
        {
            let mut c = open_encrypted(&p, &key('a')).unwrap();
            migrate(&mut c).unwrap();
            c.execute("INSERT INTO patients (id, full_name) VALUES ('1', 'Gizli Danışan')", []).unwrap();
        }
        let bytes = std::fs::read(&p).unwrap();
        assert!(!bytes.starts_with(b"SQLite format 3"), "dosya başlığı şifresiz");
        assert!(!bytes.windows(6).any(|w| w == b"Gizli "), "düz metin dosyada görünüyor");
        assert!(open_encrypted(&p, &key('b')).is_err(), "yanlış anahtar kabul edildi");
        let c = open_encrypted(&p, &key('a')).unwrap();
        let n: String = c.query_row("SELECT full_name FROM patients", [], |r| r.get(0)).unwrap();
        assert_eq!(n, "Gizli Danışan");
    }

    #[test]
    fn backup_is_encrypted_and_restores() {
        let (p, b) = (tmp("main.db"), tmp("backup.db"));
        let k = key('c');
        let mut c = open_encrypted(&p, &k).unwrap();
        migrate(&mut c).unwrap();
        c.execute("INSERT INTO patients (id, full_name) VALUES ('1', 'A')", []).unwrap();
        backup_to(&c, &b, &k).unwrap();
        assert!(!std::fs::read(&b).unwrap().starts_with(b"SQLite format 3"));
        assert!(open_encrypted(&b, &key('d')).is_err());
        c.execute("DELETE FROM patients", []).unwrap();
        restore_from(&mut c, &b, &k).unwrap();
        let n: i64 = c.query_row("SELECT count(*) FROM patients", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1);
    }

    #[test]
    fn foreign_keys_cascade() {
        let p = tmp("fk.db");
        let mut c = open_encrypted(&p, &key('e')).unwrap();
        migrate(&mut c).unwrap();
        c.execute_batch(
            "INSERT INTO patients (id, full_name) VALUES ('p', 'X');
             INSERT INTO sessions (id, patient_id, session_number, session_date) VALUES ('s', 'p', 1, '2026-01-01');
             INSERT INTO private_notes (id, session_id, note_content) VALUES ('n', 's', 'x');
             DELETE FROM patients WHERE id = 'p';",
        ).unwrap();
        let n: i64 = c.query_row("SELECT count(*) FROM private_notes", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 0);
    }
}
