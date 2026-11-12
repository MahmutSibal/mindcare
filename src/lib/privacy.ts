// Asistana gönderilmeden önce sorudaki danışan tanımlayıcılarını bulur. Ücretsiz Gemini kullanımında
// metin Google tarafından ürün geliştirmede kullanılabildiği için, tanımlayıcı içeren soru GÖNDERİLMEZ.
// Bu bir güvence değil, hatayı azaltan bir emniyettir: ad dışındaki dolaylı bilgiler yakalanamaz.

const tr = (s: string) => s.toLocaleLowerCase("tr-TR");

/** Kelimeleri harf dizilerine böler (Türkçe harfler dahil). */
function words(text: string): string[] {
  return tr(text).match(/[\p{L}]+/gu) ?? [];
}

// Ad olarak sayılmayacak çok yaygın kelimeler (ör. "can", "ay", "deniz" hem ad hem sözcük).
// Yalnızca tam ad ve soyad eşleşmesi her zaman engellenir; tek başına ad ise yalnızca bu listede değilse.
const COMMON = new Set(["can", "ay", "deniz", "umut", "ümit", "gül", "güneş", "yağmur", "bahar", "barış", "sevgi", "ada", "ince", "sema", "ela", "esra"]);

export interface PrivacyFinding {
  kind: "ad" | "kimlik" | "telefon" | "e-posta";
  text: string;
}

export function findIdentifiers(question: string, patientNames: string[]): PrivacyFinding[] {
  const found: PrivacyFinding[] = [];
  const qWords = new Set(words(question));

  for (const full of patientNames) {
    const parts = words(full).filter((p) => p.length >= 3);
    if (parts.length === 0) continue;
    const hit = parts.filter((p) => qWords.has(p));
    // Tam ad (ya da soyad) geçiyorsa kesin; tek başına ad ancak yaygın bir sözcük değilse.
    const strong = hit.length >= 2 || (parts.length > 1 && hit.includes(parts[parts.length - 1]!)) || (parts.length === 1 && hit.length === 1);
    const weak = hit.length === 1 && !COMMON.has(hit[0]!);
    if (hit.length > 0 && (strong || weak)) found.push({ kind: "ad", text: full });
  }

  if (/(?<!\d)\d{11}(?!\d)/.test(question)) found.push({ kind: "kimlik", text: "11 haneli numara (T.C. kimlik no olabilir)" });
  if (/(?:\+?\d[\s().-]?){10,}/.test(question.replace(/\d{11}/g, ""))) found.push({ kind: "telefon", text: "telefon numarası" });
  if (/[\w.+-]+@[\w-]+\.[\w.-]+/.test(question)) found.push({ kind: "e-posta", text: "e-posta adresi" });
  return found;
}
