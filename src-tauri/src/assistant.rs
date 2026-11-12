//! Terapist asistanı: Google Gemini API (Google Search ile kaynaklı yanıt).
//!
//! API anahtarı yalnızca terapistin şifreli veritabanında durur; arayüze geri gönderilmez ve
//! istekler bu modülden (Rust) yapılır. Danışana ait hiçbir veri gönderilmez: arayüz, sorudaki
//! kayıtlı danışan adı ve kimlik bilgisi kalıplarını gönderimden önce engeller.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::error::{AppError, AppResult};

pub const DEFAULT_MODEL: &str = "gemini-3.6-flash";

const SYSTEM_PROMPT: &str = "\
Sen, psikoloji ve ruh sağlığı alanında çalışan bir klinisyenin (psikolog / terapist) meslek içi yardımcı asistanısın. \
Terapistin unuttuğu ya da hızlıca doğrulamak istediği bilgileri (kuramlar, teknikler, ölçekler, tanı ölçütleri, \
müdahale protokolleri, araştırma bulguları, etik ve mevzuat) kısa ve doğru şekilde hatırlatırsın.\n\
Kurallar:\n\
- Yanıtı Türkçe, kısa ve öz, mümkünse maddeler halinde ver.\n\
- Güvenilir ve güncel kaynaklara dayan (APA, WHO, NICE, DSM-5-TR, ICD-11, hakemli dergiler, Türk Psikologlar Derneği, \
Türkiye Psikiyatri Derneği). Önemli her iddia için arama sonuçlarındaki kaynağı kullan.\n\
- Güvenilir kaynak bulamazsan bunu açıkça söyle. Kaynak, makale adı, yazar, yıl veya DOI UYDURMA.\n\
- Belirli bir kişiye tanı koyma, ilaç ve doz önerme; ilaçla ilgili sorularda psikiyatriste yönlendir.\n\
- Soruda intihar, kendine zarar verme, istismar ya da başkasına zarar riski varsa, risk değerlendirmesini ve \
yasal bildirim/koruma yükümlülüklerini hatırlat.\n\
- Klinik karar her zaman terapistindir; sen hatırlatır ve seçenek sunarsın. Emin olmadığında bunu söyle.\n\
- Kişisel veri isteme. Soruda danışanı tanımlayan bilgi varsa kullanıcıyı anonimleştirmesi için uyar.";

#[derive(Deserialize)]
pub struct Turn {
    /// "user" veya "model"
    pub role: String,
    pub text: String,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct Source {
    pub title: String,
    pub uri: String,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct Answer {
    /// Yanıt metni; kaynaklı cümlelerin sonunda [1], [2] gibi işaretler bulunur.
    pub text: String,
    pub sources: Vec<Source>,
    /// Modelin yaptığı aramalar (Google, arama önerilerinin gösterilmesini şart koşar).
    pub queries: Vec<String>,
    /// Google Search ile doğrulanmış mı? Değilse yanıt kaynaksızdır.
    pub grounded: bool,
}

fn endpoint(model: &str) -> AppResult<String> {
    let ok = !model.is_empty() && model.len() <= 60 && model.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '.' | '_'));
    if !ok {
        return Err(AppError::Invalid("Model adı geçersiz.".into()));
    }
    Ok(format!("https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"))
}

fn request_body(history: &[Turn], question: &str, search: bool) -> Value {
    let mut contents: Vec<Value> = history
        .iter()
        .filter(|t| (t.role == "user" || t.role == "model") && !t.text.trim().is_empty())
        .map(|t| json!({ "role": t.role, "parts": [{ "text": t.text }] }))
        .collect();
    contents.push(json!({ "role": "user", "parts": [{ "text": question }] }));
    let mut body = json!({
        "systemInstruction": { "parts": [{ "text": SYSTEM_PROMPT }] },
        "contents": contents,
        "generationConfig": { "temperature": 0.3, "maxOutputTokens": 2048 },
    });
    if search {
        body["tools"] = json!([{ "google_search": {} }]);
    }
    body
}

/// Yanıt metnini ve kaynakları ayrıştırır; kaynaklı aralıkların sonuna [n] işareti koyar.
pub fn parse_answer(resp: &Value) -> AppResult<Answer> {
    let cand = resp.pointer("/candidates/0").ok_or_else(|| {
        let reason = resp.pointer("/promptFeedback/blockReason").and_then(Value::as_str);
        AppError::Invalid(match reason {
            Some(_) => "Bu soru güvenlik filtresine takıldı; farklı ifade etmeyi deneyin.".into(),
            None => "Asistan yanıt üretemedi.".to_string(),
        })
    })?;
    let mut text = String::new();
    if let Some(parts) = cand.pointer("/content/parts").and_then(Value::as_array) {
        for p in parts {
            if let Some(t) = p.get("text").and_then(Value::as_str) {
                text.push_str(t);
            }
        }
    }
    if text.trim().is_empty() {
        return Err(AppError::Invalid("Asistan boş yanıt verdi; soruyu yeniden deneyin.".into()));
    }

    let meta = cand.get("groundingMetadata");
    let mut sources: Vec<Source> = Vec::new();
    // Aynı adresi iki kez listelememek için chunk dizini → kaynak numarası.
    let mut chunk_to_source: Vec<Option<usize>> = Vec::new();
    if let Some(chunks) = meta.and_then(|m| m.get("groundingChunks")).and_then(Value::as_array) {
        for ch in chunks {
            let web = ch.get("web");
            let uri = web.and_then(|w| w.get("uri")).and_then(Value::as_str).unwrap_or("");
            if !uri.starts_with("https://") {
                chunk_to_source.push(None);
                continue;
            }
            let title = web.and_then(|w| w.get("title")).and_then(Value::as_str).unwrap_or(uri);
            match sources.iter().position(|s| s.uri == uri) {
                Some(i) => chunk_to_source.push(Some(i)),
                None => {
                    sources.push(Source { title: title.chars().take(160).collect(), uri: uri.to_string() });
                    chunk_to_source.push(Some(sources.len() - 1));
                }
            }
        }
    }

    // Alıntı işaretleri: her aralığın bitiş konumuna (UTF-8 bayt) eklenir; sondan başa uygulanır.
    let mut inserts: Vec<(usize, String)> = Vec::new();
    if let Some(sup) = meta.and_then(|m| m.get("groundingSupports")).and_then(Value::as_array) {
        for s in sup {
            let end = s.pointer("/segment/endIndex").and_then(Value::as_u64).unwrap_or(0) as usize;
            if end == 0 || end > text.len() {
                continue;
            }
            let mut nums: Vec<usize> = s
                .get("groundingChunkIndices")
                .and_then(Value::as_array)
                .map(|a| a.iter().filter_map(Value::as_u64).filter_map(|i| chunk_to_source.get(i as usize).copied().flatten()).collect())
                .unwrap_or_default();
            nums.sort_unstable();
            nums.dedup();
            if nums.is_empty() {
                continue;
            }
            let mut end = end;
            while !text.is_char_boundary(end) {
                end -= 1;
            }
            let marks: String = nums.iter().map(|n| format!("[{}]", n + 1)).collect();
            inserts.push((end, marks));
        }
    }
    inserts.sort_by(|a, b| b.0.cmp(&a.0));
    for (at, marks) in inserts {
        text.insert_str(at, &marks);
    }

    let queries = meta
        .and_then(|m| m.get("webSearchQueries"))
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_str).map(|s| s.chars().take(200).collect()).collect())
        .unwrap_or_default();

    Ok(Answer { grounded: !sources.is_empty(), text, sources, queries })
}

fn http_error(status: u16, body: &str) -> AppError {
    let lower = body.to_lowercase();
    AppError::Invalid(match status {
        400 if lower.contains("api key") || lower.contains("api_key") => "Gemini API anahtarı geçersiz. Ayarlar'dan kontrol edin.".into(),
        400 => "İstek reddedildi (400). Soruyu kısaltıp yeniden deneyin.".into(),
        401 | 403 => "Gemini API anahtarı geçersiz ya da bu işlem için yetkisiz. Ayarlar'dan kontrol edin.".into(),
        404 => "Model bulunamadı. Ayarlar'da model adını güncelleyin.".into(),
        429 => "Ücretsiz kullanım sınırına ulaşıldı. Birkaç dakika bekleyip yeniden deneyin.".into(),
        500..=599 => "Gemini servisi şu an yanıt vermiyor. Biraz sonra yeniden deneyin.".into(),
        _ => format!("Gemini beklenmeyen yanıt verdi ({status})."),
    })
}

async fn call(api_key: &str, model: &str, body: &Value) -> AppResult<Result<Value, (u16, String)>> {
    let resp = reqwest::Client::new()
        .post(endpoint(model)?)
        .header("x-goog-api-key", api_key.trim())
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(body.to_string())
        .timeout(Duration::from_secs(60))
        .send()
        .await
        .map_err(|_| AppError::Invalid("Gemini'ye bağlanılamadı. İnternet bağlantısını kontrol edin.".into()))?;
    let status = resp.status();
    let bytes = resp.bytes().await.map_err(|_| AppError::Invalid("Gemini yanıtı okunamadı.".into()))?;
    if !status.is_success() {
        return Ok(Err((status.as_u16(), String::from_utf8_lossy(&bytes).chars().take(2000).collect())));
    }
    let json: Value = serde_json::from_slice(&bytes).map_err(|_| AppError::Invalid("Gemini yanıtı okunamadı.".into()))?;
    Ok(Ok(json))
}

/// Soruyu Google Search destekli olarak sorar. Arama aracı reddedilirse kaynaksız yanıt verir.
pub async fn ask(api_key: &str, model: &str, history: &[Turn], question: &str) -> AppResult<Answer> {
    if api_key.trim().is_empty() {
        return Err(AppError::Invalid("Gemini API anahtarı girilmemiş. Ayarlar'dan ekleyin.".into()));
    }
    let q = question.trim();
    if q.is_empty() || q.chars().count() > 4000 {
        return Err(AppError::Invalid("Soru boş ya da çok uzun (en fazla 4000 karakter).".into()));
    }
    let history = &history[history.len().saturating_sub(10)..];
    match call(api_key, model, &request_body(history, q, true)).await? {
        Ok(v) => parse_answer(&v),
        // Arama aracı bu model/anahtar için kullanılamıyorsa kaynaksız dene (arayüz bunu belirtir).
        Err((400, body)) if body.to_lowercase().contains("search") || body.to_lowercase().contains("tool") => {
            match call(api_key, model, &request_body(history, q, false)).await? {
                Ok(v) => parse_answer(&v),
                Err((s, b)) => Err(http_error(s, &b)),
            }
        }
        Err((s, b)) => Err(http_error(s, &b)),
    }
}

/// Anahtarı ve modeli küçük bir istekle sınar (arama kotası harcamaz).
pub async fn check(api_key: &str, model: &str) -> AppResult<()> {
    if api_key.trim().is_empty() {
        return Err(AppError::Invalid("Gemini API anahtarı girilmemiş.".into()));
    }
    let body = json!({ "contents": [{ "role": "user", "parts": [{ "text": "Sadece 'tamam' yaz." }] }], "generationConfig": { "maxOutputTokens": 16 } });
    match call(api_key, model, &body).await? {
        Ok(_) => Ok(()),
        Err((s, b)) => Err(http_error(s, &b)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn citations_are_inserted_after_supported_segments_and_sources_deduplicated() {
        let resp = json!({
          "candidates": [{
            "content": { "parts": [{ "text": "Çocuklarda BDT etkilidir. Ayrıca EMDR de önerilir." }] },
            "groundingMetadata": {
              "webSearchQueries": ["çocuklarda BDT etkinliği"],
              "groundingChunks": [
                { "web": { "uri": "https://example.org/a", "title": "A" } },
                { "web": { "uri": "https://example.org/b", "title": "B" } },
                { "web": { "uri": "https://example.org/a", "title": "A" } },
                { "web": { "uri": "http://insecure.example/c", "title": "C" } }
              ],
              "groundingSupports": [
                { "segment": { "endIndex": 26 }, "groundingChunkIndices": [0, 2] },
                { "segment": { "endIndex": 53 }, "groundingChunkIndices": [1, 3] }
              ]
            }
          }]
        });
        let a = parse_answer(&resp).unwrap();
        assert_eq!(a.sources.len(), 2, "aynı adres tek kaynak, http kaynak atılır");
        assert_eq!(a.text, "Çocuklarda BDT etkilidir.[1] Ayrıca EMDR de önerilir.[2]");
        assert!(a.grounded);
        assert_eq!(a.queries, vec!["çocuklarda BDT etkinliği".to_string()]);
    }

    #[test]
    fn multibyte_boundaries_do_not_panic_and_missing_metadata_is_ungrounded() {
        let resp = json!({ "candidates": [{ "content": { "parts": [{ "text": "Şüphe çok." }] },
            "groundingMetadata": { "groundingChunks": [{ "web": { "uri": "https://x.org/1", "title": "X" } }],
            "groundingSupports": [{ "segment": { "endIndex": 2 }, "groundingChunkIndices": [0] }] } }] });
        let a = parse_answer(&resp).unwrap();
        assert!(a.text.contains("[1]"));
        let plain = parse_answer(&json!({ "candidates": [{ "content": { "parts": [{ "text": "Merhaba" }] } }] })).unwrap();
        assert!(!plain.grounded && plain.sources.is_empty());
    }

    #[test]
    fn empty_or_blocked_responses_are_errors() {
        assert!(parse_answer(&json!({ "promptFeedback": { "blockReason": "SAFETY" } })).is_err());
        assert!(parse_answer(&json!({ "candidates": [{ "content": { "parts": [] } }] })).is_err());
    }

    #[test]
    fn model_names_are_validated() {
        assert!(endpoint("gemini-3.6-flash").is_ok());
        assert!(endpoint("../x").is_err());
        assert!(endpoint("a b").is_err());
        assert!(endpoint("").is_err());
    }
}
