//! Veritabanı şifreleme anahtarının yönetimi.
//!
//! Anahtar kaynak kodda tutulmaz. İlk kurulumda kriptografik olarak güvenli
//! 32 baytlık rastgele bir anahtar üretilir ve işletim sisteminin güvenli
//! deposunda saklanır (Windows: Credential Manager / DPAPI, macOS: Keychain,
//! Linux: Secret Service). Bellekteki kopyalar `Zeroizing` ile temizlenir.

use rand::RngCore;
use zeroize::Zeroizing;

use crate::error::AppError;

/// Android'de anahtarın saklanacağı uygulamaya özel dizin (diğer uygulamalar erişemez).
#[cfg(target_os = "android")]
static KEY_DIR: std::sync::OnceLock<std::path::PathBuf> = std::sync::OnceLock::new();

/// Başlangıçta bir kez çağrılır. Masaüstünde yapacak bir şey yoktur.
pub fn init(_dir: &std::path::Path) {
    #[cfg(target_os = "android")]
    {
        let _ = KEY_DIR.set(_dir.to_path_buf());
    }
}

const SERVICE: &str = "com.mindcare.desktop";
const ACCOUNT: &str = "database-key-v1";

#[cfg(not(target_os = "android"))]
mod store {
    use super::*;

    fn entry() -> Result<keyring::Entry, AppError> {
        keyring::Entry::new(SERVICE, ACCOUNT).map_err(|e| AppError::Key(e.to_string()))
    }

    /// Depodaki anahtarı döndürür; yoksa `None`.
    pub fn load_key() -> Result<Option<Zeroizing<String>>, AppError> {
        match entry()?.get_password() {
            Ok(k) => {
                let k = Zeroizing::new(k);
                if k.len() != 64 || !k.chars().all(|c| c.is_ascii_hexdigit()) {
                    return Err(AppError::Key("Depodaki anahtar biçimi geçersiz.".into()));
                }
                Ok(Some(k))
            }
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(AppError::Key(e.to_string())),
        }
    }

    /// Yeni bir anahtar üretip güvenli depoya yazar.
    pub fn create_key() -> Result<Zeroizing<String>, AppError> {
        let mut raw = Zeroizing::new([0u8; 32]);
        rand::rngs::OsRng.fill_bytes(raw.as_mut());
        let key = Zeroizing::new(hex::encode(raw.as_ref()));
        store_key(&key)?;
        Ok(key)
    }

    /// Verilen anahtarı (64 karakter hex) güvenli depoya yazar; varsa eskisinin yerine geçer.
    /// Kurtarma anahtarıyla geri yüklemede kullanılır.
    pub fn store_key(key: &Zeroizing<String>) -> Result<(), AppError> {
        entry()?
            .set_password(key)
            .map_err(|e| AppError::Key(e.to_string()))?;
        // Yazılanın gerçekten okunabildiğini doğrula.
        match load_key()? {
            Some(k) if *k == **key => Ok(()),
            _ => Err(AppError::Key("Anahtar güvenli depoya yazılamadı.".into())),
        }
    }
}

#[cfg(target_os = "android")]
mod store {
    use super::*;

    fn path() -> Result<std::path::PathBuf, AppError> {
        KEY_DIR
            .get()
            .map(|d| d.join("db.key"))
            .ok_or_else(|| AppError::Key("Anahtar dizini hazır değil.".into()))
    }

    pub fn load_key() -> Result<Option<Zeroizing<String>>, AppError> {
        let p = path()?;
        match std::fs::read_to_string(&p) {
            Ok(k) => {
                let k = Zeroizing::new(k.trim().to_string());
                if k.len() != 64 || !k.chars().all(|c| c.is_ascii_hexdigit()) {
                    return Err(AppError::Key("Depodaki anahtar biçimi geçersiz.".into()));
                }
                Ok(Some(k))
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(AppError::Key(e.to_string())),
        }
    }

    pub fn create_key() -> Result<Zeroizing<String>, AppError> {
        let mut raw = Zeroizing::new([0u8; 32]);
        rand::rngs::OsRng.fill_bytes(raw.as_mut());
        let key = Zeroizing::new(hex::encode(raw.as_ref()));
        store_key(&key)?;
        Ok(key)
    }

    pub fn store_key(key: &Zeroizing<String>) -> Result<(), AppError> {
        let p = path()?;
        // Önce geçici dosyaya yazılıp yer değiştirilir: yarım kalan yazma anahtarı bozmaz.
        let tmp = p.with_extension("tmp");
        std::fs::write(&tmp, key.as_bytes()).map_err(|e| AppError::Key(e.to_string()))?;
        std::fs::rename(&tmp, &p).map_err(|e| AppError::Key(e.to_string()))?;
        match load_key()? {
            Some(k) if *k == **key => Ok(()),
            _ => Err(AppError::Key("Anahtar güvenli depoya yazılamadı.".into())),
        }
    }
}

pub use store::{create_key, load_key, store_key};
