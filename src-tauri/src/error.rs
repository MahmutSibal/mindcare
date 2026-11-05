use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Veritabanı hatası: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("Anahtar yönetimi hatası: {0}")]
    Key(String),
    #[error("Dosya hatası: {0}")]
    Io(#[from] std::io::Error),
    #[error("Veritabanı açık değil: {0}")]
    NotReady(String),
    #[error("{0}")]
    Invalid(String),
}

// Hatalar arayüze düz metin olarak iletilir. Hasta verisi hata metinlerine eklenmez.
impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
