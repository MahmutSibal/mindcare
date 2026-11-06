//! Terapistin oluşturduğu testler: tanım doğrulama ve puanlama.
//!
//! Bir test, ortak cevap seçenekleri (etiket + puan) ve soru listesinden oluşur.
//! "scale" soruları bu seçeneklerden biriyle, "text" soruları serbest metinle cevaplanır.
//! Danışandan gelen cevaplar güvenilmez kabul edilir: puan her zaman burada,
//! test tanımından yeniden hesaplanır.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

pub const MAX_QUESTIONS: usize = 100;
pub const MAX_OPTIONS: usize = 10;
pub const MAX_TEXT_ANSWER: usize = 4000;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestOption {
    pub label: String,
    pub score: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum QuestionKind {
    Scale,
    Text,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestQuestion {
    pub id: String,
    pub text: String,
    pub kind: QuestionKind,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestDefinition {
    pub options: Vec<TestOption>,
    pub questions: Vec<TestQuestion>,
}

/// Danışanın bir soruya cevabı: seçilen seçeneğin sırası veya serbest metin.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Answer {
    #[serde(default)]
    pub option: Option<usize>,
    #[serde(default)]
    pub text: Option<String>,
}

pub type Answers = HashMap<String, Answer>;

fn invalid(msg: &str) -> AppError {
    AppError::Invalid(msg.into())
}

/// Test tanımını JSON'dan okur ve tutarlılığını denetler.
pub fn parse_definition(json: &str) -> AppResult<TestDefinition> {
    let def: TestDefinition = serde_json::from_str(json).map_err(|_| invalid("Test tanımı okunamadı."))?;
    if def.questions.is_empty() {
        return Err(invalid("Testte en az bir soru olmalı."));
    }
    if def.questions.len() > MAX_QUESTIONS {
        return Err(AppError::Invalid(format!("Bir testte en fazla {MAX_QUESTIONS} soru olabilir.")));
    }
    let mut ids = HashSet::new();
    for q in &def.questions {
        if q.text.trim().is_empty() {
            return Err(invalid("Boş soru bırakılamaz."));
        }
        if q.id.is_empty() || !ids.insert(q.id.as_str()) {
            return Err(invalid("Soru kimlikleri benzersiz olmalı."));
        }
    }
    let has_scale = def.questions.iter().any(|q| q.kind == QuestionKind::Scale);
    if has_scale && def.options.len() < 2 {
        return Err(invalid("Ölçekli sorular için en az iki cevap seçeneği tanımlayın."));
    }
    if def.options.len() > MAX_OPTIONS {
        return Err(AppError::Invalid(format!("En fazla {MAX_OPTIONS} cevap seçeneği olabilir.")));
    }
    if def.options.iter().any(|o| o.label.trim().is_empty()) {
        return Err(invalid("Cevap seçeneklerinin adı boş olamaz."));
    }
    Ok(def)
}

/// Cevapları test tanımına göre denetler ve toplam puanı hesaplar.
/// Ölçekli soru yoksa puan `None` olur. Tüm ölçekli sorular cevaplanmış olmalıdır.
pub fn score(def: &TestDefinition, answers: &Answers) -> AppResult<Option<i64>> {
    let known: HashSet<&str> = def.questions.iter().map(|q| q.id.as_str()).collect();
    if answers.keys().any(|k| !known.contains(k.as_str())) {
        return Err(invalid("Cevaplarda testte olmayan bir soru var."));
    }
    let mut total = 0i64;
    let mut any_scale = false;
    for q in &def.questions {
        let a = answers.get(&q.id);
        match q.kind {
            QuestionKind::Scale => {
                any_scale = true;
                let idx = a
                    .and_then(|a| a.option)
                    .ok_or_else(|| invalid("Ölçekli soruların hepsi cevaplanmalı."))?;
                let opt = def.options.get(idx).ok_or_else(|| invalid("Geçersiz cevap seçeneği."))?;
                total += opt.score;
            }
            QuestionKind::Text => {
                if a.and_then(|a| a.text.as_ref()).is_some_and(|t| t.chars().count() > MAX_TEXT_ANSWER) {
                    return Err(AppError::Invalid(format!("Metin cevaplar en fazla {MAX_TEXT_ANSWER} karakter olabilir.")));
                }
            }
        }
    }
    Ok(any_scale.then_some(total))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn def() -> TestDefinition {
        parse_definition(
            r#"{"options":[{"label":"Hiç","score":0},{"label":"Bazen","score":1},{"label":"Sık","score":2},{"label":"Her gün","score":3}],
                "questions":[{"id":"q1","text":"Soru 1","kind":"scale"},
                             {"id":"q2","text":"Soru 2","kind":"scale"},
                             {"id":"q3","text":"Eklemek istedikleriniz","kind":"text"}]}"#,
        )
        .unwrap()
    }

    fn answers(pairs: &[(&str, Answer)]) -> Answers {
        pairs.iter().map(|(k, v)| (k.to_string(), v.clone())).collect()
    }
    fn opt(i: usize) -> Answer {
        Answer { option: Some(i), text: None }
    }
    fn text(t: &str) -> Answer {
        Answer { option: None, text: Some(t.into()) }
    }

    #[test]
    fn score_is_sum_of_chosen_options() {
        let a = answers(&[("q1", opt(3)), ("q2", opt(1)), ("q3", text("iyi"))]);
        assert_eq!(score(&def(), &a).unwrap(), Some(4));
    }

    #[test]
    fn text_questions_are_optional() {
        let a = answers(&[("q1", opt(0)), ("q2", opt(2))]);
        assert_eq!(score(&def(), &a).unwrap(), Some(2));
    }

    #[test]
    fn unanswered_scale_question_is_rejected() {
        let a = answers(&[("q1", opt(0))]);
        assert!(score(&def(), &a).is_err());
    }

    #[test]
    fn tampered_answers_are_rejected() {
        assert!(score(&def(), &answers(&[("q1", opt(9)), ("q2", opt(0))])).is_err(), "aralık dışı seçenek");
        assert!(score(&def(), &answers(&[("q1", opt(0)), ("q2", opt(0)), ("x", opt(0))])).is_err(), "bilinmeyen soru");
        let long = "a".repeat(MAX_TEXT_ANSWER + 1);
        assert!(score(&def(), &answers(&[("q1", opt(0)), ("q2", opt(0)), ("q3", text(&long))])).is_err(), "çok uzun metin");
    }

    #[test]
    fn text_only_test_has_no_score() {
        let d = parse_definition(r#"{"options":[],"questions":[{"id":"a","text":"Nasılsınız?","kind":"text"}]}"#).unwrap();
        assert_eq!(score(&d, &answers(&[("a", text("iyiyim"))])).unwrap(), None);
    }

    #[test]
    fn invalid_definitions_are_rejected() {
        assert!(parse_definition("{}").is_err());
        assert!(parse_definition(r#"{"options":[],"questions":[]}"#).is_err(), "soru yok");
        assert!(parse_definition(r#"{"options":[{"label":"Tek","score":0}],"questions":[{"id":"a","text":"S","kind":"scale"}]}"#).is_err(), "tek seçenek");
        assert!(parse_definition(r#"{"options":[],"questions":[{"id":"a","text":"S","kind":"text"},{"id":"a","text":"T","kind":"text"}]}"#).is_err(), "aynı kimlik");
        assert!(parse_definition(r#"{"options":[],"questions":[{"id":"a","text":"  ","kind":"text"}]}"#).is_err(), "boş soru");
    }
}
