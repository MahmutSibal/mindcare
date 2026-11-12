// Materyal gösterimi: terapist ve danışan istemcisinin ortak yardımcıları (Tauri'ye bağımlı değil).

/** Veri kanalından dosya olarak gönderilebilecek en büyük materyal. Daha büyükleri ekran paylaşımıyla gösterilir. */
export const MAX_FILE_SHARE_BYTES = 25 * 1024 * 1024;
/** Kanal mesajı başına ham veri; base64 ile ~22 KB olur ve tüm tarayıcıların sınırının altında kalır. */
export const CHUNK_BYTES = 16 * 1024;

/**
 * Dosya aktarımı görüşmeyle aynı bağlantıyı kullanır; sınırsız bırakılırsa bant genişliğini
 * kapıp ses ve görüntüyü geciktirir. Ortalama hız bu değerle sınırlanır (~3,2 Mbit/sn).
 */
export const TRANSFER_BYTES_PER_SEC = 400 * 1024;
/** Gönderilen bayt sayısına göre gerekirse bekleyen bir "hız sınırlayıcı" döndürür. */
export function makePacer(bytesPerSec = TRANSFER_BYTES_PER_SEC) {
  const start = performance.now();
  let sent = 0;
  return async (n: number) => {
    sent += n;
    const wait = (sent / bytesPerSec) * 1000 - (performance.now() - start);
    if (wait > 5) await new Promise((r) => setTimeout(r, wait));
  };
}

// Yalnızca bilinen, tarayıcıda güvenle gösterilebilen türler. Diğer her şey (html, svg vb.)
// danışan tarafında açılmaz, yalnızca indirilir.
const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
  txt: "text/plain;charset=utf-8",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
};

export function extensionOf(path: string): string {
  return path.split(/[\\/]/).pop()?.split(".").pop()?.toLowerCase() ?? "";
}

export function mimeFor(path: string): string {
  return MIME[extensionOf(path)] ?? "application/octet-stream";
}

// Danışanın terapiste gönderebileceği dosyalar. Liste Rust tarafındaki (commands.rs) ile aynıdır.
const UPLOAD_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  pdf: "application/pdf",
  txt: "text/plain",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  ogg: "audio/ogg",
  webm: "audio/webm",
};
export const UPLOAD_MIMES: string[] = [...new Set(Object.values(UPLOAD_EXT))];
/** Dosyanın gönderilebilir türü; izinli değilse `null`. Uzantı ile bildirilen tür birbirini doğrular. */
export function uploadMimeFor(file: { name: string; type: string }): string | null {
  const byExt = UPLOAD_EXT[extensionOf(file.name)] ?? null;
  if (!byExt) return null;
  // Tarayıcı bazen türü boş ya da genel verir; bildirilen tür varsa uzantıyla çelişmemeli.
  if (file.type && UPLOAD_MIMES.includes(file.type) && file.type !== byExt) return null;
  return byExt;
}
/** Tarayıcıda satır içi görüntülenebilir mi? (diğerleri yalnızca indirilir) */
export const isViewable = (mime: string) => isSafeImage(mime) || isPdf(mime) || mime === "text/plain" || mime.startsWith("audio/");

export const isSafeImage =(mime: string) => /^image\/(png|jpeg|gif|webp)$/.test(mime);
export const isPdf = (mime: string) => mime === "application/pdf";

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function fmtBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

// ───────────────────────────── Bağlantı materyalleri ─────────────────────────────

/** Materyalin dosya yolu yerine web bağlantısı olup olmadığı. */
export const isWebLink = (path: string) => /^https?:\/\//i.test(path.trim());

/** Yalnızca https bağlantıları kabul edilir (http ve diğer şemalar danışana gönderilmez). */
export function httpsUrl(input: string): string | null {
  try {
    const u = new URL(input.trim());
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * YouTube bağlantısından video kimliğini ve (varsa) başlangıç saniyesini çıkarır.
 * watch?v=, youtu.be/, shorts/, embed/ ve live/ biçimleri; t=90, t=1m30s, start=90.
 */
export function parseYouTube(input: string): { id: string; start: number } | null {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^(www|m|music)\./, "");
  let id: string | null = null;
  if (host === "youtu.be") id = u.pathname.slice(1).split("/")[0] ?? null;
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const m = u.pathname.match(/^\/(?:embed|shorts|live)\/([^/?]+)/);
    id = m ? m[1]! : u.pathname === "/watch" ? u.searchParams.get("v") : null;
  }
  if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
  const t = u.searchParams.get("t") ?? u.searchParams.get("start") ?? "";
  const hms = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/);
  const start = hms && t ? Number(hms[1] ?? 0) * 3600 + Number(hms[2] ?? 0) * 60 + Number(hms[3] ?? 0) : 0;
  return { id, start: Number.isFinite(start) ? start : 0 };
}
