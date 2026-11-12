// Terapist tarafı: "Hastaya Göster". Görsel, belge ve alıntı veri kanalından gönderilir;
// video ise bilgisayarda oynatılıp görüntü/ses olarak yayınlanır (useCall.showVideo).

import { api, type Material } from "../../lib/api";
import {
  CHUNK_BYTES, extensionOf, fmtBytes, httpsUrl, isSafeImage, isWebLink, MAX_FILE_SHARE_BYTES, mimeFor, toBase64,
} from "../../lib/share";
import type { MediaState } from "../../lib/rtc";
import type { CallApi } from "./useCall";

export interface SharedMaterial {
  material: Material;
  /** Bu gösterimin kimliği; danışan onayları buna göre eşleşir. Videoda yok. */
  shareId: string | null;
  status: "sending" | "sent" | "shown" | "failed" | "video";
  progress: number;
  /** Terapistin önizlemesi için (görsel). */
  previewUrl?: string;
  /** Alıntı metni. */
  text?: string;
  /** Gösterilen videonun danışandaki durumu (YouTube bağlantısı). */
  media?: { state: MediaState; time: number; duration: number };
  error?: string;
}

async function quoteText(m: Material): Promise<string> {
  if (m.description?.trim()) return m.description.trim();
  if (m.file_path && extensionOf(m.file_path) === "txt") {
    const bytes = await api.readMaterial(m.id);
    if (bytes.byteLength > 100 * 1024) throw new Error("Alıntı dosyası çok uzun (en fazla 100 KB).");
    return new TextDecoder().decode(bytes).trim();
  }
  throw new Error("Bu alıntının metni yok. Materyaller sayfasında açıklama alanına metni yazın.");
}

/**
 * Materyali danışana gösterir. Durum değişiklikleri `update` ile bildirilir.
 * Görüşme bağlı değilse veya aktarım yarıda kalırsa hata fırlatır.
 */
export async function showMaterial(call: CallApi, m: Material, update: (s: SharedMaterial) => void, bytesOverride?: Uint8Array<ArrayBuffer>): Promise<void> {
  if (call.state !== "connected") throw new Error("Materyal göstermek için görüşmenin bağlı olması gerekir.");

  if (isWebLink(m.file_path)) {
    const url = httpsUrl(m.file_path);
    if (!url) throw new Error("Bağlantı geçersiz. Yalnızca https:// ile başlayan bağlantılar gösterilebilir.");
    const shareId = crypto.randomUUID();
    const ok = call.sendMessage({ type: "material_show", id: shareId, title: m.title, kind: "link", mime: "text/uri-list", size: url.length, url });
    if (!ok) throw new Error("Danışan bağlantısı hazır değil.");
    update({ material: m, shareId, status: "sent", progress: 1 });
    return;
  }

  if (m.category === "video") {
    const bytes = await api.readMaterial(m.id);
    await call.showVideo(bytes, mimeFor(m.file_path), m.title);
    update({ material: m, shareId: null, status: "video", progress: 1 });
    return;
  }

  const shareId = crypto.randomUUID();
  if (m.category === "quote") {
    const text = await quoteText(m);
    const ok = call.sendMessage({ type: "material_show", id: shareId, title: m.title, kind: "quote", mime: "text/plain", size: text.length, text });
    if (!ok) throw new Error("Danışan bağlantısı hazır değil.");
    update({ material: m, shareId, status: "sent", progress: 1, text });
    return;
  }

  const mime = mimeFor(m.file_path);
  const kind = m.category === "image" && isSafeImage(mime) ? "image" : "document";
  const bytes = bytesOverride ?? new Uint8Array(await api.readMaterial(m.id));
  if (bytes.byteLength > MAX_FILE_SHARE_BYTES) {
    throw new Error(
      `Dosya ${fmtBytes(bytes.byteLength)}; en fazla ${fmtBytes(MAX_FILE_SHARE_BYTES)} gönderilebilir. Daha büyük dosyaları ekran paylaşımıyla gösterin.`,
    );
  }
  const previewUrl = kind === "image" ? URL.createObjectURL(new Blob([bytes], { type: mime })) : undefined;
  const base: SharedMaterial = { material: m, shareId, status: "sending", progress: 0, previewUrl };
  update(base);

  const fail = () => {
    throw new Error("Aktarım yarıda kaldı: danışan bağlantısı kesildi.");
  };
  if (!(await call.sendBuffered({ type: "material_show", id: shareId, title: m.title, kind, mime, size: bytes.byteLength }))) fail();
  let lastReport = 0;
  for (let off = 0; off < bytes.byteLength; off += CHUNK_BYTES) {
    const data = toBase64(bytes.subarray(off, off + CHUNK_BYTES));
    if (!(await call.sendBuffered({ type: "material_chunk", id: shareId, data }))) fail();
    const p = Math.min(1, (off + CHUNK_BYTES) / bytes.byteLength);
    if (p - lastReport >= 0.05 || p === 1) {
      lastReport = p;
      update({ ...base, progress: p });
    }
  }
  if (!(await call.sendBuffered({ type: "material_end", id: shareId }))) fail();
  update({ ...base, status: "sent", progress: 1 });
}

/** Danışanın ekranındaki materyali kaldırır (video yayınını durdurur). */
export function hideMaterial(call: CallApi, s: SharedMaterial) {
  if (s.status === "video") call.stopVideo();
  else if (s.shareId) call.sendMessage({ type: "material_hide", id: s.shareId });
  if (s.previewUrl) URL.revokeObjectURL(s.previewUrl);
}
