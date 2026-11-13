// Danışanın görüşme sırasında gönderdiği dosyalar: terapist tarafında alma, listeleme,
// görüntüleme ve indirme. Dosyalar şifreli veritabanında, danışanın dosyasında saklanır.

import { useEffect, useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { Download, File as FileIcon, FileText, Image as ImageIcon, Music, Paperclip, Pencil, Trash2 } from "lucide-react";
import { api, errorText, type PatientFileMeta } from "../../lib/api";
import { fmtDate } from "../../lib/format";
import { notifyDataChanged } from "../../lib/session";
import { fmtBytes, fromBase64, isPdf, isSafeImage, isViewable, MAX_FILE_SHARE_BYTES, UPLOAD_MIMES } from "../../lib/share";
import { Button, Modal } from "../ui";
import type { ChannelMessage } from "../../lib/rtc";

export interface ReceivedFile {
  id: string;
  name: string;
  at: number;
}

interface Incoming {
  id: string;
  name: string;
  mime: string;
  size: number;
  chunks: Uint8Array[];
  received: number;
}

/**
 * Danışandan gelen dosyaları toplar ve kaydeder. `target` görüşmenin ait olduğu danışan ve
 * seansı verir; seans başlamamışsa dosya reddedilir (yanlış dosyaya düşmesin).
 */
export function useIncomingFiles(
  call: {
    onMessage: (fn: (m: ChannelMessage, from?: string) => void) => () => void;
    sendMessage: (m: ChannelMessage, to?: string) => boolean;
  },
  /** Gönderene göre hedef danışan ve seans (`from`: grup görüşmesinde gönderenin kimliği). */
  target: (from?: string) => { patientId: string; sessionId: string | null } | null,
) {
  const [received, setReceived] = useState<ReceivedFile[]>([]);
  // Gönderen başına ayrı aktarım: grupta iki kişi aynı anda dosya yollayabilir.
  const cur = useRef(new Map<string, Incoming>());
  const targetRef = useRef(target);
  targetRef.current = target;
  const { onMessage, sendMessage } = call;

  useEffect(
    () =>
      onMessage((m, from) => {
        const key = from ?? "";
        const reject = (id: string, error: string) => {
          sendMessage({ type: "upload_result", id, ok: false, error }, from);
        };
        switch (m.type) {
          case "upload_start": {
            cur.current.delete(key);
            if (typeof m.id !== "string" || typeof m.name !== "string" || typeof m.mime !== "string") return;
            if (!UPLOAD_MIMES.includes(m.mime)) return reject(m.id, "Bu dosya türü kabul edilmiyor.");
            if (!Number.isFinite(m.size) || m.size <= 0 || m.size > MAX_FILE_SHARE_BYTES) {
              return reject(m.id, "Dosya boş veya 25 MB'tan büyük.");
            }
            if (!targetRef.current(from)) return reject(m.id, "Terapist henüz seansı başlatmadı; biraz sonra tekrar deneyin.");
            cur.current.set(key, { id: m.id, name: m.name.slice(0, 200), mime: m.mime, size: m.size, chunks: [], received: 0 });
            return;
          }
          case "upload_chunk": {
            const c = cur.current.get(key);
            if (!c || c.id !== m.id || typeof m.data !== "string") return;
            let bytes: Uint8Array;
            try {
              bytes = fromBase64(m.data);
            } catch {
              cur.current.delete(key);
              return reject(m.id, "Aktarım bozuldu.");
            }
            c.received += bytes.byteLength;
            if (c.received > c.size) {
              cur.current.delete(key);
              return reject(m.id, "Dosya bildirilen boyutu aştı.");
            }
            c.chunks.push(bytes);
            return;
          }
          case "upload_end": {
            const c = cur.current.get(key);
            if (!c || c.id !== m.id) return;
            cur.current.delete(key);
            const t = targetRef.current(from);
            if (!t) return reject(c.id, "Seans sona erdi.");
            if (c.received !== c.size) return reject(c.id, "Dosya eksik ulaştı; tekrar gönderin.");
            const all = new Uint8Array(c.size);
            let off = 0;
            for (const part of c.chunks) {
              all.set(part, off);
              off += part.byteLength;
            }
            api
              .savePatientFile(t.patientId, t.sessionId, c.name, c.mime, all)
              .then((fileId) => {
                sendMessage({ type: "upload_result", id: c.id, ok: true }, from);
                setReceived((l) => [...l, { id: fileId, name: c.name, at: Date.now() }]);
                notifyDataChanged();
              })
              .catch((e) => reject(c.id, errorText(e)));
            return;
          }
        }
      }),
    [onMessage, sendMessage],
  );

  // Bildirim 15 sn sonra kendiliğinden kaybolur.
  useEffect(() => {
    if (received.length === 0) return;
    const t = setTimeout(() => setReceived((l) => l.filter((f) => Date.now() - f.at < 15000)), 15500);
    return () => clearTimeout(t);
  }, [received]);

  return { received, dismiss: () => setReceived([]) };
}

const iconFor = (mime: string) =>
  isSafeImage(mime) ? ImageIcon : mime.startsWith("audio/") ? Music : isPdf(mime) || mime === "text/plain" ? FileText : FileIcon;

/** Seans sırasında dosya geldiğinde terapistin görüşme ekranında beliren bildirim. */
export function ReceivedFilesToast({ files, onOpen, onDismiss }: { files: ReceivedFile[]; onOpen: () => void; onDismiss: () => void }) {
  if (files.length === 0) return null;
  return (
    <div className="mb-3 flex items-center gap-3 rounded-xl border border-accent/40 bg-accent-soft px-3 py-2 text-sm" role="status">
      <Paperclip size={16} className="shrink-0 text-accent" />
      <span className="min-w-0 flex-1 truncate">
        Danışan dosya gönderdi: <b>{files.map((f) => f.name).join(", ")}</b>
      </span>
      <Button variant="outline" className="h-8 text-xs" onClick={onOpen}>Dosyalara git</Button>
      <button onClick={onDismiss} className="text-xs text-muted hover:text-ink" aria-label="Bildirimi kapat">Kapat</button>
    </div>
  );
}

/** Danışan dosyasında: danışanın gönderdiği dosyalar. */
export function PatientFiles({ files, onDraw }: { files: PatientFileMeta[]; onDraw?: (f: PatientFileMeta) => void }) {
  const [open, setOpen] = useState<PatientFileMeta | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    setUrl(null);
    setText(null);
    setFailed(false);
    setConfirmDelete(false);
    if (!open || !isViewable(open.mime)) return;
    let made: string | null = null;
    let live = true;
    api
      .getPatientFile(open.id)
      .then(async (buf) => {
        if (!live) return;
        if (open.mime === "text/plain") setText(new TextDecoder().decode(buf).slice(0, 200_000));
        else {
          made = URL.createObjectURL(new Blob([buf], { type: open.mime }));
          setUrl(made);
        }
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [open]);

  const download = async (f: PatientFileMeta) => {
    try {
      const dest = await save({ defaultPath: f.name });
      if (!dest) return;
      await api.exportPatientFile(f.id, dest);
      setMessage({ ok: true, text: `Kaydedildi: ${dest}` });
    } catch (e) {
      setMessage({ ok: false, text: errorText(e) });
    }
  };

  if (files.length === 0) return null;
  return (
    <section className="mt-4">
      <h3 className="mb-1.5 flex items-center gap-1.5 text-[13px] font-medium">
        <Paperclip size={13} className="text-accent" /> Danışanın gönderdiği dosyalar
      </h3>
      {message && <p className={`mb-1 text-xs ${message.ok ? "text-ok" : "text-danger"}`}>{message.text}</p>}
      <ul className="space-y-1">
        {files.map((f) => {
          const Icon = iconFor(f.mime);
          return (
            <li key={f.id} className="flex items-center gap-1">
              <button onClick={() => setOpen(f)} className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1.5 text-left text-[13px] hover:bg-card">
                <Icon size={14} className="shrink-0 text-muted" />
                <span className="truncate">{f.name}</span>
                <span className="shrink-0 text-faint">
                  • {fmtBytes(f.size)} • {fmtDate(f.created_at, true)}
                  {f.session_number !== null ? ` • ${f.session_number}. seans` : ""}
                </span>
              </button>
              <button onClick={() => void download(f)} className="rounded-md p-1.5 text-muted hover:bg-card hover:text-ink" aria-label={`${f.name} dosyasını indir`} title="İndir">
                <Download size={15} />
              </button>
            </li>
          );
        })}
      </ul>
      {open && (
        <Modal title={open.name} onClose={() => setOpen(null)} width="max-w-3xl">
          <div className="mb-3 text-xs text-muted">
            {fmtBytes(open.size)} • {fmtDate(open.created_at, true)}
          </div>
          {!isViewable(open.mime) ? (
            <p className="rounded-lg border border-line bg-card p-4 text-sm text-muted">
              Bu dosya türü (Word belgesi) uygulama içinde açılmaz. İndirip bilgisayarınızdaki programla açabilirsiniz.
            </p>
          ) : failed ? (
            <p className="text-sm text-danger">Dosya açılamadı.</p>
          ) : isSafeImage(open.mime) && url ? (
            <img src={url} alt={open.name} className="max-h-[65vh] w-full rounded-lg border border-line object-contain" />
          ) : isPdf(open.mime) && url ? (
            <iframe src={url} title={open.name} className="h-[65vh] w-full rounded-lg border border-line bg-white" />
          ) : open.mime.startsWith("audio/") && url ? (
            <audio src={url} controls className="w-full" />
          ) : text !== null ? (
            <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-card p-3 text-sm">{text}</pre>
          ) : (
            <p className="text-sm text-muted">Yükleniyor…</p>
          )}
          <div className="mt-4 flex items-center justify-between">
            {confirmDelete ? (
              <Button
                variant="danger"
                className="text-xs"
                onClick={async () => {
                  await api.deletePatientFile(open.id);
                  setOpen(null);
                  notifyDataChanged();
                }}
              >
                Silmeyi onayla
              </Button>
            ) : (
              <Button variant="ghost" className="text-xs hover:text-danger" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={14} /> Sil
              </Button>
            )}
            <div className="flex gap-2">
              {onDraw && isSafeImage(open.mime) && (
                <Button
                  onClick={() => {
                    const f = open;
                    setOpen(null);
                    onDraw(f);
                  }}
                >
                  <Pencil size={15} /> Üzerine çiz
                </Button>
              )}
              <Button variant="outline" onClick={() => void download(open)}>
                <Download size={15} /> İndir
              </Button>
              <Button variant="ghost" onClick={() => setOpen(null)}>Kapat</Button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}
