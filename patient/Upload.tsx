// Danışan tarafı: terapiste dosya gönderme (fotoğraf, belge, ses). Dosya şifreli veri kanalından
// parça parça gider; danışan sayfası hiçbir yere kaydetmez. Terapist kaydedince onay döner.

import { useCallback, useRef, useState } from "react";
import { Check, Paperclip, X } from "lucide-react";
import type { ChannelMessage } from "../src/lib/rtc";
import { CHUNK_BYTES, fmtBytes, makePacer, MAX_FILE_SHARE_BYTES, toBase64, uploadMimeFor, UPLOAD_MIMES } from "../src/lib/share";

export interface UploadState {
  name: string;
  progress: number;
  status: "sending" | "waiting" | "done" | "failed";
  error?: string;
}

export function useUpload(getCall: () => { sendBuffered: (m: ChannelMessage) => Promise<boolean> } | null) {
  const [state, setState] = useState<UploadState | null>(null);
  const activeId = useRef<string | null>(null);

  const send = useCallback(
    async (file: File) => {
      const call = getCall();
      const mime = uploadMimeFor(file);
      const fail = (error: string) => setState({ name: file.name, progress: 0, status: "failed", error });
      if (!call) return fail("Görüşme bağlı değil.");
      if (!mime) return fail("Bu dosya türü gönderilemez. Fotoğraf, PDF, metin, Word belgesi veya ses dosyası seçin.");
      if (file.size === 0) return fail("Dosya boş.");
      if (file.size > MAX_FILE_SHARE_BYTES) {
        return fail(`Dosya ${fmtBytes(file.size)}; en fazla ${fmtBytes(MAX_FILE_SHARE_BYTES)} gönderilebilir.`);
      }
      const id = crypto.randomUUID();
      activeId.current = id;
      setState({ name: file.name, progress: 0, status: "sending" });
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const lost = () => {
          throw new Error("Bağlantı kesildi; dosya gönderilemedi.");
        };
        if (!(await call.sendBuffered({ type: "upload_start", id, name: file.name, mime, size: bytes.byteLength }))) lost();
        let last = 0;
        const pace = makePacer();
        for (let off = 0; off < bytes.byteLength; off += CHUNK_BYTES) {
          await pace(CHUNK_BYTES);
          if (activeId.current !== id) return; // iptal edildi
          const data = toBase64(bytes.subarray(off, off + CHUNK_BYTES));
          if (!(await call.sendBuffered({ type: "upload_chunk", id, data }))) lost();
          const p = Math.min(1, (off + CHUNK_BYTES) / bytes.byteLength);
          if (p - last >= 0.05 || p === 1) {
            last = p;
            setState({ name: file.name, progress: p, status: "sending" });
          }
        }
        if (!(await call.sendBuffered({ type: "upload_end", id }))) lost();
        setState({ name: file.name, progress: 1, status: "waiting" });
      } catch (e) {
        if (activeId.current === id) fail(e instanceof Error ? e.message : String(e));
      }
    },
    [getCall],
  );

  /** `upload_result` mesajını işler; mesaj bu özelliğe aitse `true` döner. */
  const handle = useCallback((m: ChannelMessage): boolean => {
    if (m.type !== "upload_result") return false;
    if (m.id !== activeId.current) return true;
    setState((s) =>
      s ? (m.ok ? { ...s, progress: 1, status: "done" } : { ...s, status: "failed", error: m.error || "Terapist dosyayı alamadı." }) : s,
    );
    return true;
  }, []);

  const dismiss = useCallback(() => {
    activeId.current = null;
    setState(null);
  }, []);

  return { state, send, handle, dismiss };
}

/** Ayarlar menüsündeki "Dosya gönder" bölümü. */
export function UploadSection({ upload }: { upload: ReturnType<typeof useUpload> }) {
  const input = useRef<HTMLInputElement>(null);
  const s = upload.state;
  const busy = s?.status === "sending" || s?.status === "waiting";
  return (
    <div className="mb-4 border-b border-line pb-4">
      <input
        ref={input}
        type="file"
        className="hidden"
        accept={UPLOAD_MIMES.join(",") + ",.docx,.doc,.m4a,.txt"}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void upload.send(f);
        }}
      />
      <button
        onClick={() => input.current?.click()}
        disabled={busy}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-line bg-card text-sm text-ink hover:bg-line disabled:opacity-50"
      >
        <Paperclip size={16} /> Terapiste dosya gönder
      </button>
      {s && (
        <div className="mt-2 text-xs" role="status">
          <div className="flex items-center gap-1.5">
            {s.status === "done" && <Check size={14} className="shrink-0 text-ok" />}
            {s.status === "failed" && <X size={14} className="shrink-0 text-danger" />}
            <span className="min-w-0 flex-1 truncate">{s.name}</span>
            {!busy && (
              <button onClick={upload.dismiss} className="text-muted underline">
                Tamam
              </button>
            )}
          </div>
          {s.status === "sending" && (
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line">
              <div className="h-full bg-accent transition-all" style={{ width: `${Math.round(s.progress * 100)}%` }} />
            </div>
          )}
          <p className={s.status === "failed" ? "mt-1 text-danger" : "mt-1 text-muted"}>
            {s.status === "sending" && `Gönderiliyor… %${Math.round(s.progress * 100)}`}
            {s.status === "waiting" && "Terapistin onayı bekleniyor…"}
            {s.status === "done" && "Terapiste ulaştı."}
            {s.status === "failed" && s.error}
          </p>
        </div>
      )}
    </div>
  );
}
