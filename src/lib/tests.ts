// Terapistin oluşturduğu testlerin ortak tipleri. Hem masaüstü uygulaması hem danışan
// web istemcisi kullanır; bu yüzden Tauri'ye bağımlı değildir.
// Doğrulama ve puanlamanın asıl kaynağı Rust tarafıdır (src-tauri/src/clinical.rs).

export interface TestOption {
  label: string;
  score: number;
}

export type QuestionKind = "scale" | "text";

export interface TestQuestion {
  id: string;
  text: string;
  kind: QuestionKind;
}

export interface TestDefinition {
  options: TestOption[];
  questions: TestQuestion[];
}

export interface Answer {
  option?: number | null;
  text?: string | null;
}

export type Answers = Record<string, Answer>;

export const MAX_TEXT_ANSWER = 4000;

/** Sık kullanılan 0–3 sıklık ölçeği; testi oluştururken başlangıç seçenekleri olarak sunulur. */
export const FREQUENCY_SCALE: TestOption[] = [
  { label: "Hiç", score: 0 },
  { label: "Birkaç gün", score: 1 },
  { label: "Günlerin yarısından fazlası", score: 2 },
  { label: "Neredeyse her gün", score: 3 },
];

export function parseDefinition(json: string): TestDefinition {
  try {
    const d = JSON.parse(json) as TestDefinition;
    return { options: d.options ?? [], questions: d.questions ?? [] };
  } catch {
    return { options: [], questions: [] };
  }
}

export function parseAnswers(json: string): Answers {
  try {
    return JSON.parse(json) as Answers;
  } catch {
    return {};
  }
}

/** Gönderilmeden önce tüm ölçekli soruların cevaplandığını denetler. */
export function unansweredCount(def: TestDefinition, answers: Answers): number {
  return def.questions.filter((q) => q.kind === "scale" && answers[q.id]?.option == null).length;
}

/** Ölçekli sorulardan alınabilecek en yüksek puan (sonuç ekranında "12 / 27" gibi göstermek için). */
export function maxScore(def: TestDefinition): number | null {
  const scale = def.questions.filter((q) => q.kind === "scale").length;
  if (scale === 0 || def.options.length === 0) return null;
  return scale * Math.max(...def.options.map((o) => o.score));
}

export function newQuestionId(): string {
  return crypto.randomUUID().slice(0, 8);
}
