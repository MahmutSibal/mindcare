//! Cloudflare TURN: her görüşme için kısa ömürlü TURN kimlik bilgisi üretir.
//!
//! Asıl API anahtarı yalnızca terapistin şifreli veritabanında durur ve danışana gönderilmez;
//! danışana yalnızca birkaç saat geçerli kullanıcı adı/parola gider. TURN sunucusu yalnızca
//! şifreli WebRTC paketlerini aktarır, görüntü ve sesin içeriğini göremez.
//! https://developers.cloudflare.com/realtime/turn/generate-credentials/

use std::time::Duration;

use serde_json::Value;

use crate::error::{AppError, AppResult};

/// Kimlik bilgisinin geçerlilik süresi: en uzun seansı rahatça kapsar.
pub const TTL_SECS: u64 = 4 * 60 * 60;

/// Cloudflare'den ICE sunucu listesi alır (STUN + TURN, 53. port adresleri ayıklanmış).
pub async fn generate(key_id: &str, api_token: &str) -> AppResult<Value> {
    let key_id = key_id.trim();
    if key_id.is_empty() || !key_id.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err(AppError::Invalid("Cloudflare TURN Key ID geçersiz.".into()));
    }
    let url = format!("https://rtc.live.cloudflare.com/v1/turn/keys/{key_id}/credentials/generate-ice-servers");
    let resp = reqwest::Client::new()
        .post(url)
        .bearer_auth(api_token.trim())
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(format!(r#"{{"ttl":{TTL_SECS}}}"#))
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|_| AppError::Invalid("Cloudflare TURN'e bağlanılamadı. İnternet bağlantısını kontrol edin.".into()))?;

    let status = resp.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN || status == reqwest::StatusCode::NOT_FOUND {
        return Err(AppError::Invalid("Cloudflare TURN anahtarı geçersiz (Key ID veya API token yanlış).".into()));
    }
    if !status.is_success() {
        return Err(AppError::Invalid(format!("Cloudflare TURN beklenmeyen yanıt verdi ({}).", status.as_u16())));
    }
    let body = resp
        .bytes()
        .await
        .map_err(|_| AppError::Invalid("Cloudflare TURN yanıtı okunamadı.".into()))?;
    let json: Value = serde_json::from_slice(&body).map_err(|_| AppError::Invalid("Cloudflare TURN yanıtı okunamadı.".into()))?;
    let servers = json.get("iceServers").cloned().ok_or_else(|| AppError::Invalid("Cloudflare TURN yanıtında sunucu yok.".into()))?;
    Ok(without_port_53(servers))
}

/// Tarayıcılar 53. portu engeller; bu adresler bağlantıyı yalnızca zaman aşımına kadar bekletir.
pub fn without_port_53(servers: Value) -> Value {
    let keep = |u: &Value| u.as_str().is_some_and(|s| !s.contains(":53?") && !s.ends_with(":53"));
    let Value::Array(list) = servers else { return Value::Array(vec![]) };
    Value::Array(
        list.into_iter()
            .filter_map(|mut entry| {
                match entry.get_mut("urls") {
                    Some(Value::Array(urls)) => {
                        urls.retain(keep);
                        if urls.is_empty() {
                            return None;
                        }
                    }
                    Some(u @ Value::String(_)) if !keep(u) => return None,
                    Some(Value::String(_)) => {}
                    _ => return None,
                }
                Some(entry)
            })
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn port_53_urls_are_removed_and_credentials_kept() {
        let input = json!([
            { "urls": ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:53"] },
            { "urls": [
                "turn:turn.cloudflare.com:3478?transport=udp",
                "turn:turn.cloudflare.com:53?transport=udp",
                "turn:turn.cloudflare.com:3478?transport=tcp",
                "turns:turn.cloudflare.com:5349?transport=tcp",
                "turn:turn.cloudflare.com:53?transport=tcp",
                "turns:turn.cloudflare.com:443?transport=tcp"
              ],
              "username": "u", "credential": "c" }
        ]);
        let out = without_port_53(input);
        assert_eq!(
            out,
            json!([
                { "urls": ["stun:stun.cloudflare.com:3478"] },
                { "urls": [
                    "turn:turn.cloudflare.com:3478?transport=udp",
                    "turn:turn.cloudflare.com:3478?transport=tcp",
                    "turns:turn.cloudflare.com:5349?transport=tcp",
                    "turns:turn.cloudflare.com:443?transport=tcp"
                  ],
                  "username": "u", "credential": "c" }
            ])
        );
    }

    #[test]
    fn port_5349_and_443_are_not_mistaken_for_53() {
        let out = without_port_53(json!([{ "urls": "turns:turn.cloudflare.com:5349" }, { "urls": "turn:x:53" }]));
        assert_eq!(out, json!([{ "urls": "turns:turn.cloudflare.com:5349" }]));
    }

    #[test]
    fn malformed_input_yields_empty_list() {
        assert_eq!(without_port_53(json!({"x": 1})), json!([]));
        assert_eq!(without_port_53(json!([{ "username": "u" }])), json!([]));
    }

    /// İnternet gerektirir: `cargo test -- --ignored`. TLS ve HTTP katmanının çalıştığını,
    /// sahte anahtarın "bağlanılamadı" değil "geçersiz" olarak raporlandığını doğrular.
    #[test]
    #[ignore]
    fn fake_key_reaches_cloudflare_and_is_reported_invalid() {
        let err = tauri::async_runtime::block_on(generate("0123456789abcdef0123456789abcdef", "sahte-token")).unwrap_err();
        assert!(err.to_string().contains("geçersiz"), "beklenmeyen hata: {err}");
    }

    #[test]
    fn invalid_key_id_is_rejected_before_any_request() {
        let rt = tauri::async_runtime::block_on(generate("../evil", "t"));
        assert!(rt.is_err());
    }
}
