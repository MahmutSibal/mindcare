//! Kurtarma anahtarı: veritabanı anahtarının elle yazılabilir biçimi.
//!
//! 32 baytlık anahtara SHA-256 özetinin ilk 2 baytı sağlama olarak eklenir (34 bayt),
//! Crockford Base32 ile kodlanır (55 karakter) ve 5'erli 11 gruba bölünür:
//! `7Q2KD-M9XAF-…`. Crockford alfabesi karışan harfleri (I, L, O, U) içermez;
//! girişte küçük harf, boşluk ve tire yok sayılır, O→0 ve I/L→1 kabul edilir.
//! Sağlama, yazım hatalarını anahtar denenmeden önce yakalar.

use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

use crate::error::{AppError, AppResult};

const ALPHABET: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const KEY_BYTES: usize = 32;
const CHECK_BYTES: usize = 2;
/// ceil((32 + 2) * 8 / 5)
const CHARS: usize = 55;
const GROUP: usize = 5;

fn checksum(key: &[u8]) -> [u8; CHECK_BYTES] {
    let d = Sha256::digest(key);
    [d[0], d[1]]
}

fn malformed() -> AppError {
    AppError::Invalid("Kurtarma anahtarında geçersiz karakter var. Lütfen kontrol edin.".into())
}

/// Veritabanı anahtarını (64 karakter hex) kurtarma anahtarına çevirir.
pub fn encode(key_hex: &str) -> AppResult<Zeroizing<String>> {
    let key = Zeroizing::new(hex::decode(key_hex).map_err(|_| AppError::Key("Anahtar biçimi geçersiz.".into()))?);
    if key.len() != KEY_BYTES {
        return Err(AppError::Key("Anahtar biçimi geçersiz.".into()));
    }
    let mut data = Zeroizing::new(Vec::with_capacity(KEY_BYTES + CHECK_BYTES));
    data.extend_from_slice(&key);
    data.extend_from_slice(&checksum(&key));

    let mut out = Zeroizing::new(String::with_capacity(CHARS + CHARS / GROUP));
    let mut count = 0;
    let mut push = |v: u32| {
        if count > 0 && count % GROUP == 0 {
            out.push('-');
        }
        out.push(ALPHABET[v as usize] as char);
        count += 1;
    };
    let (mut buf, mut bits) = (0u32, 0u32);
    for &b in data.iter() {
        buf = (buf << 8) | u32::from(b);
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            push((buf >> bits) & 31);
        }
        buf &= (1 << bits) - 1;
    }
    if bits > 0 {
        push((buf << (5 - bits)) & 31);
    }
    Ok(out)
}

/// Kurtarma anahtarını doğrular ve veritabanı anahtarına (64 karakter hex) çevirir.
pub fn decode(input: &str) -> AppResult<Zeroizing<String>> {
    let mut values = Zeroizing::new(Vec::with_capacity(CHARS));
    for ch in input.chars() {
        let v = match ch.to_ascii_uppercase() {
            '-' | ' ' | '\t' | '\r' | '\n' => continue,
            'O' => 0,
            'I' | 'L' => 1,
            c => ALPHABET.iter().position(|&a| char::from(a) == c).ok_or_else(malformed)? as u32,
        };
        values.push(v);
    }
    if values.len() != CHARS {
        return Err(AppError::Invalid(format!(
            "Kurtarma anahtarı {CHARS} karakter olmalı, {} karakter girildi.",
            values.len()
        )));
    }

    let mut data = Zeroizing::new(Vec::with_capacity(KEY_BYTES + CHECK_BYTES));
    let (mut buf, mut bits) = (0u32, 0u32);
    for &v in values.iter() {
        buf = (buf << 5) | v;
        bits += 5;
        if bits >= 8 {
            bits -= 8;
            data.push((buf >> bits) as u8);
            buf &= (1 << bits) - 1;
        }
    }
    // 275 bitin son 3'ü dolgudur ve sıfır olmalıdır.
    if buf != 0 || data.len() != KEY_BYTES + CHECK_BYTES {
        return Err(malformed());
    }
    let (key, check) = data.split_at(KEY_BYTES);
    if check != checksum(key) {
        return Err(AppError::Invalid(
            "Kurtarma anahtarı hatalı yazılmış. Lütfen karakterleri tek tek kontrol edin.".into(),
        ));
    }
    Ok(Zeroizing::new(hex::encode(key)))
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY: &str = "00ff10ee20dd30cc40bb50aa60997088807790668055a044b033c022d011e001";

    #[test]
    fn roundtrip_and_format() {
        let rk = encode(KEY).unwrap();
        let groups: Vec<&str> = rk.split('-').collect();
        assert_eq!(groups.len(), 11);
        assert!(groups.iter().all(|g| g.len() == GROUP));
        assert!(!rk.contains(['I', 'L', 'O', 'U']));
        assert_eq!(decode(&rk).unwrap().as_str(), KEY);
    }

    #[test]
    fn random_keys_roundtrip() {
        use rand::RngCore;
        for _ in 0..200 {
            let mut raw = [0u8; 32];
            rand::rngs::OsRng.fill_bytes(&mut raw);
            let k = hex::encode(raw);
            assert_eq!(decode(&encode(&k).unwrap()).unwrap().as_str(), k);
        }
    }

    #[test]
    fn lenient_input_is_accepted() {
        let rk = encode(KEY).unwrap();
        let sloppy = rk.replace('-', " ").to_lowercase().replace('0', "o").replace('1', "l");
        assert_eq!(decode(&sloppy).unwrap().as_str(), KEY);
    }

    #[test]
    fn every_single_character_typo_is_rejected() {
        let rk: Vec<char> = encode(KEY).unwrap().chars().collect();
        for i in (0..rk.len()).filter(|&i| rk[i] != '-') {
            let mut bad = rk.clone();
            bad[i] = if bad[i] == 'X' { 'Y' } else { 'X' };
            let bad: String = bad.into_iter().collect();
            assert!(decode(&bad).is_err(), "{i}. karakterdeki hata yakalanmadı");
        }
    }

    #[test]
    fn wrong_length_and_bad_characters_are_rejected() {
        let rk = encode(KEY).unwrap();
        assert!(decode(&rk[..rk.len() - 1]).is_err());
        assert!(decode(&format!("{}A", rk.as_str())).is_err());
        assert!(decode(&rk.replacen(|c: char| c.is_ascii_alphanumeric(), "U", 1)).is_err());
        assert!(decode("").is_err());
    }
}
