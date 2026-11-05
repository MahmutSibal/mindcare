// Tarihler veritabanında yerel saatle "YYYY-MM-DD" veya "YYYY-MM-DDTHH:MM[:SS]" olarak tutulur.
// CURRENT_TIMESTAMP ile yazılan alanlar ise UTC "YYYY-MM-DD HH:MM:SS" biçimindedir.

function parse(value: string, utc = false): Date {
  if (utc && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
    return new Date(value.replace(" ", "T") + "Z");
  }
  return new Date(value.length === 10 ? value + "T00:00:00" : value);
}

export function fmtDate(value: string | null | undefined, utc = false): string {
  if (!value) return "—";
  const d = parse(value, utc);
  if (isNaN(d.getTime())) return value;
  return d.toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function fmtTime(value: string | null | undefined, utc = false): string {
  if (!value) return "";
  const d = parse(value, utc);
  return d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
}

export function fmtDateTime(value: string | null | undefined, utc = false): string {
  if (!value) return "—";
  return `${fmtDate(value, utc)} • ${fmtTime(value, utc)}`;
}

export function age(birth: string | null): number | null {
  if (!birth) return null;
  const b = parse(birth);
  if (isNaN(b.getTime())) return null;
  const now = new Date();
  let a = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) a--;
  return a;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toLocaleUpperCase("tr-TR"))
    .join("");
}

export function clock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function minutes(totalSeconds: number): string {
  return `${Math.round(totalSeconds / 60)} dk`;
}

/** TipTap HTML'ini düz metne çevirir (önizleme için). */
export function plainText(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return (doc.body.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** <input type="datetime-local"> için yerel saat değeri. */
export function localInputValue(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
