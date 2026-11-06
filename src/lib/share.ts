// Materyal gösterimi: terapist ve danışan istemcisinin ortak yardımcıları (Tauri'ye bağımlı değil).

/** Veri kanalından dosya olarak gönderilebilecek en büyük materyal. Daha büyükleri ekran paylaşımıyla gösterilir. */
export const MAX_FILE_SHARE_BYTES = 25 * 1024 * 1024;
/** Kanal mesajı başına ham veri; base64 ile ~22 KB olur ve tüm tarayıcıların sınırının altında kalır. */
export const CHUNK_BYTES = 16 * 1024;

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

export const isSafeImage = (mime: string) => /^image\/(png|jpeg|gif|webp)$/.test(mime);
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
