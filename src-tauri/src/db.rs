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
    // 2 — Terapistin oluşturduğu testler ve danışan sonuçları.
    // Sonuç, gönderildiği andaki test tanımını da saklar; test sonradan düzenlense
    // veya silinse bile geçmiş sonuçlar okunabilir kalır.
    r#"
    CREATE TABLE tests (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        instructions TEXT,
        definition_json TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME
    );

    CREATE TABLE test_results (
        id TEXT PRIMARY KEY,
        patient_id TEXT NOT NULL,
        session_id TEXT,
        test_id TEXT,
        test_title TEXT NOT NULL,
        definition_json TEXT NOT NULL,
        answers_json TEXT NOT NULL,
        total_score INTEGER,
        completed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL
    );
    CREATE INDEX idx_test_results_patient ON test_results(patient_id, completed_at DESC);
    "#,
    // 3 — Ödevler. `delivered_at`: danışanın ekranına ulaştığı an (görüşme dışında
    // verilen ödevde boş kalır). Sonraki seansta terapist durumu ve notu günceller.
    r#"
    CREATE TABLE homework (
        id TEXT PRIMARY KEY,
        patient_id TEXT NOT NULL,
        session_id TEXT,
        title TEXT NOT NULL,
        description TEXT,
        due_date TEXT,
        status TEXT NOT NULL DEFAULT 'assigned'
            CHECK (status IN ('assigned','done','partial','not_done')),
        review_note TEXT,
        delivered_at DATETIME,
        reviewed_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL
    );
    CREATE INDEX idx_homework_patient ON homework(patient_id, created_at DESC);
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

/// Başka bir anahtarla (kurtarma anahtarı) şifrelenmiş yedeği `prepared` geçici dosyasına hazırlar.
/// Yedek bu anahtarla açılabilmeli ve geçerli bir MindCare yedeği olmalıdır; kopya migration'dan
/// geçirilip yeniden açılarak doğrulanır. Ana veritabanına dokunulmaz.
pub fn prepare_restore(src: &Path, prepared: &Path, key: &Zeroizing<String>) -> AppResult<()> {
    let src_conn = open_encrypted(src, key)
        .map_err(|_| AppError::Key("Bu kurtarma anahtarı seçilen yedeğe ait değil.".into()))?;
    let v: i64 = src_conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if v == 0 || v > MIGRATIONS.len() as i64 {
        return Err(AppError::Invalid("Seçilen dosya geçerli bir MindCare yedeği değil.".into()));
    }
    remove_with_sidecars(prepared)?;
    backup_to(&src_conn, prepared, key)?;
    drop(src_conn);
    let mut c = open_encrypted(prepared, key)?;
    migrate(&mut c)?;
    Ok(())
}

/// Hazırlanan dosyayı ana veritabanının yerine koyar. Ana veritabanının bağlantısı önceden
/// kapatılmış olmalıdır. Yer değiştirme başarısız olursa eski dosya yerine geri konur.
pub fn swap_in(prepared: &Path, db_path: &Path) -> AppResult<()> {
    let old = with_suffix(db_path, ".old");
    remove_with_sidecars(&old)?;
    if db_path.exists() {
        std::fs::rename(db_path, &old)?;
    }
    for ext in ["-wal", "-shm"] {
        let _ = std::fs::remove_file(with_suffix(db_path, ext));
    }
    if let Err(e) = std::fs::rename(prepared, db_path) {
        if old.exists() {
            let _ = std::fs::rename(&old, db_path);
        }
        return Err(e.into());
    }
    remove_with_sidecars(prepared)?;
    remove_with_sidecars(&old)?;
    Ok(())
}

/// Bir veritabanı dosyasını WAL/SHM yan dosyalarıyla birlikte siler (yoksa sessizce geçer).
pub fn remove_with_sidecars(path: &Path) -> AppResult<()> {
    for ext in ["", "-wal", "-shm"] {
        let p = with_suffix(path, ext);
        if p.exists() {
            std::fs::remove_file(p)?;
        }
    }
    Ok(())
}

pub fn with_suffix(path: &Path, suffix: &str) -> std::path::PathBuf {
    let mut s = path.as_os_str().to_owned();
    s.push(suffix);
    s.into()
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

    /// Yeni bilgisayar senaryosu: yeni kurulum kendi anahtarıyla boş bir veritabanı açmıştır;
    /// eski bilgisayarın yedeği, eski anahtarın kurtarma biçimiyle geri yüklenir.
    #[test]
    fn restore_on_new_computer_with_recovery_key() {
        let (old_db, backup, new_db) = (tmp("old.db"), tmp("old-backup.mcbak"), tmp("new.db"));
        let prepared = with_suffix(&new_db, ".restore");
        let (old_key, new_key) = (key('1'), key('2'));
        {
            let mut c = open_encrypted(&old_db, &old_key).unwrap();
            migrate(&mut c).unwrap();
            c.execute("INSERT INTO patients (id, full_name) VALUES ('1', 'Eski Danışan')", []).unwrap();
            backup_to(&c, &backup, &old_key).unwrap();
        }
        {
            let mut c = open_encrypted(&new_db, &new_key).unwrap();
            migrate(&mut c).unwrap();
            c.execute("INSERT INTO patients (id, full_name) VALUES ('2', 'Yeni Kurulum')", []).unwrap();
        }

        // Kullanıcının elle yazdığı kurtarma anahtarı eski anahtara çözülür.
        let typed = crate::recovery::encode(&old_key).unwrap().to_lowercase();
        let recovered = crate::recovery::decode(&typed).unwrap();

        prepare_restore(&backup, &prepared, &recovered).unwrap();
        swap_in(&prepared, &new_db).unwrap();

        assert!(!prepared.exists(), "geçici dosya kaldı");
        assert!(!with_suffix(&new_db, ".old").exists(), "eski dosya kaldı");
        assert!(open_encrypted(&new_db, &new_key).is_err(), "eski yerel anahtar hâlâ açıyor");
        let c = open_encrypted(&new_db, &recovered).unwrap();
        let names: Vec<String> = c
            .prepare("SELECT full_name FROM patients").unwrap()
            .query_map([], |r| r.get(0)).unwrap()
            .collect::<Result<_, _>>().unwrap();
        assert_eq!(names, vec!["Eski Danışan".to_string()]);
    }

    #[test]
    fn wrong_recovery_key_leaves_database_untouched() {
        let (db_path, backup) = (tmp("keep.db"), tmp("keep-backup.mcbak"));
        let prepared = with_suffix(&db_path, ".restore");
        let k = key('3');
        {
            let mut c = open_encrypted(&db_path, &k).unwrap();
            migrate(&mut c).unwrap();
            c.execute("INSERT INTO patients (id, full_name) VALUES ('1', 'Korunan')", []).unwrap();
            backup_to(&c, &backup, &k).unwrap();
        }
        let before = std::fs::read(&db_path).unwrap();
        let err = prepare_restore(&backup, &prepared, &key('4')).unwrap_err();
        assert!(err.to_string().contains("ait değil"));
        assert!(!prepared.exists());
        assert_eq!(std::fs::read(&db_path).unwrap(), before, "ana veritabanı değişti");
    }

    #[test]
    fn homework_status_is_constrained_and_follows_patient() {
        let p = tmp("hw.db");
        let mut c = open_encrypted(&p, &key('f')).unwrap();
        migrate(&mut c).unwrap();
        c.execute_batch(
            "INSERT INTO patients (id, full_name) VALUES ('p', 'X');
             INSERT INTO homework (id, patient_id, title) VALUES ('h', 'p', 'Günlük tut');",
        ).unwrap();
        let status: String = c.query_row("SELECT status FROM homework", [], |r| r.get(0)).unwrap();
        assert_eq!(status, "assigned");
        assert!(c.execute("UPDATE homework SET status = 'bilinmeyen'", []).is_err());
        c.execute("DELETE FROM patients WHERE id = 'p'", []).unwrap();
        let n: i64 = c.query_row("SELECT count(*) FROM homework", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 0);
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
