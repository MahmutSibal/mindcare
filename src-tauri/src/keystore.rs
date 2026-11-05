//! Veritabanı şifreleme anahtarının yönetimi.
//!
//! Anahtar kaynak kodda tutulmaz. İlk kurulumda kriptografik olarak güvenli
//! 32 baytlık rastgele bir anahtar üretilir ve işletim sisteminin güvenli
//! deposunda saklanır (Windows: Credential Manager / DPAPI, macOS: Keychain,
//! Linux: Secret Service). Bellekteki kopyalar `Zeroizing` ile temizlenir.

use rand::RngCore;
use zeroize::Zeroizing;

use crate::error::AppError;

const SERVICE: &str = "com.mindcare.desktop";
const ACCOUNT: &str = "database-key-v1";

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
    entry()?
        .set_password(&key)
        .map_err(|e| AppError::Key(e.to_string()))?;
    // Yazılanın gerçekten okunabildiğini doğrula.
    match load_key()? {
        Some(k) if *k == *key => Ok(key),
        _ => Err(AppError::Key("Anahtar güvenli depoya yazılamadı.".into())),
    }
}
