import { useEffect, useState } from "react";
import { Circle, Film, Square, Trash2 } from "lucide-react";
import { api, errorText, type RecordingMeta } from "../../lib/api";
import { clock, fmtDate } from "../../lib/format";
import { notifyDataChanged } from "../../lib/session";
import { fmtBytes } from "../../lib/share";
import { Button, Empty, Modal } from "../ui";
import type { CallApi } from "./useCall";
import { useRecorder } from "./useRecorder";
import type { BoardApi } from "../../lib/useBoard";

/** Görüşme ekranında kayıt düğmesi ve durum göstergesi. Kayıt, danışan kabul edince başlar. */
export function RecordingControl({ call, boardApi, backdropUrl, patientId, sessionId }: {
  call: CallApi;
  boardApi: BoardApi;
  backdropUrl: string | null;
  patientId: string | null;
  sessionId: string | null;
}) {
  const rec = useRecorder({ call, boardApi, backdropUrl, patientId, sessionId });
  const connected = call.state === "connected";
  if (!rec.supported) return null;

  return (
    <div className="rounded-xl border border-line bg-panel px-3 py-2 text-[13px]">
      <div className="flex flex-wrap items-center gap-2">
        {rec.status === "recording" ? (
          <>
            <span className="flex items-center gap-1.5 font-medium text-danger" role="status">
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-danger" /> Kayıt • {clock(rec.elapsed)}
            </span>
            <Button variant="danger" className="ml-auto px-3 py-1.5 text-xs" onClick={() => void rec.stop()}>
              <Square size={13} /> Kaydı durdur
            </Button>
          </>
        ) : rec.status === "asking" ? (
          <>
            <span className="text-muted">Danışanın onayı bekleniyor…</span>
            <Button variant="ghost" className="ml-auto px-3 py-1.5 text-xs" onClick={rec.cancelAsk}>Vazgeç</Button>
          </>
        ) : rec.status === "saving" ? (
          <span className="text-muted">Kayıt kaydediliyor…</span>
        ) : (
          <>
            <span className="text-muted" title="Danışan açıkça kabul etmeden kayıt başlamaz; danışan istediği an durdurabilir. Kayıt yalnızca bu bilgisayarın şifreli veritabanında saklanır (yaklaşık 400 MB/saat). Pencere küçültülürse kalite düşebilir.">Seans kaydı</span>
            <Button
              variant="outline"
              className="ml-auto px-3 py-1.5 text-xs"
              disabled={!connected || !patientId}
              onClick={rec.request}
              title={connected ? "Danışandan izin isteyip kaydı başlatır" : "Görüşme bağlanınca kullanılabilir"}
            >
              <Circle size={12} className="fill-danger text-danger" /> Kaydı başlat
            </Button>
          </>
        )}
      </div>
      {rec.notice && (
        <p className="mt-1.5 flex items-start justify-between gap-2 text-xs text-muted">
          <span>{rec.notice}</span>
          <button className="shrink-0 text-faint hover:text-ink" onClick={rec.clearNotice}>Tamam</button>
        </p>
      )}
    </div>
  );
}

/** Danışan dosyasında kayıtlı seans kayıtları (Çalışmalar sekmesi). */
export function RecordingsList({ recordings }: { recordings: RecordingMeta[] }) {
  const [open, setOpen] = useState<RecordingMeta | null>(null);
  if (recordings.length === 0) return null;
  return (
    <section className="mt-4">
      <h3 className="mb-1.5 flex items-center gap-1.5 text-[13px] font-medium">
        <Film size={13} className="text-accent" /> Seans kayıtları
      </h3>
      <ul className="space-y-1">
        {recordings.map((r) => (
          <li key={r.id}>
            <button onClick={() => setOpen(r)} className="flex w-full flex-wrap items-center gap-x-2 rounded-md px-1 py-1.5 text-left text-[13px] hover:bg-card">
              <span className="truncate">{fmtDate(r.created_at, true)}{r.session_number !== null ? ` • ${r.session_number}. seans` : ""}</span>
              <span className="shrink-0 text-faint">
                • {clock(r.duration_seconds)} • {fmtBytes(r.size)}{r.finished ? "" : " • yarım kaldı"}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {open && <PlayerDialog rec={open} onClose={() => setOpen(null)} />}
    </section>
  );
}

function PlayerDialog({ rec, onClose }: { rec: RecordingMeta; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    let live = true;
    let made: string | null = null;
    (async () => {
      try {
        const parts: ArrayBuffer[] = [];
        for (let i = 0; i < rec.chunks; i++) {
          parts.push(await api.getRecordingChunk(rec.id, i));
          if (live) setProgress((i + 1) / rec.chunks);
        }
        if (!live) return;
        made = URL.createObjectURL(new Blob(parts, { type: rec.mime.split(";")[0] }));
        setUrl(made);
      } catch (e) {
        if (live) setError(errorText(e));
      }
    })();
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [rec]);

  // MediaRecorder dosyalarında süre bilgisi olmaz; sona sarıp geri alınca ileri-geri sarma çalışır.
  const fixDuration = (v: HTMLVideoElement) => {
    if (v.duration === Infinity) {
      v.currentTime = 1e101;
      v.ontimeupdate = () => {
        v.ontimeupdate = null;
        v.currentTime = 0;
      };
    }
  };

  return (
    <Modal title="Seans kaydı" onClose={onClose} width="max-w-3xl">
      <p className="mb-3 text-xs text-muted">
        {fmtDate(rec.created_at, true)} • {clock(rec.duration_seconds)} • {fmtBytes(rec.size)}
        {rec.consent_at ? ` • danışan onayı: ${fmtDate(rec.consent_at, true)}` : ""}
      </p>
      {error ? (
        <Empty text={error} />
      ) : url ? (
        <video src={url} controls autoPlay onLoadedMetadata={(e) => fixDuration(e.currentTarget)} className="w-full rounded-lg border border-line bg-black" />
      ) : (
        <div className="py-10 text-center text-sm text-muted">
          Kayıt şifreli veritabanından açılıyor… %{Math.round(progress * 100)}
          <div className="mx-auto mt-3 h-1.5 w-56 overflow-hidden rounded-full bg-line"><div className="h-full bg-accent" style={{ width: `${progress * 100}%` }} /></div>
        </div>
      )}
      <div className="mt-4 flex justify-between">
        {confirmDelete ? (
          <Button
            variant="danger"
            className="text-xs"
            onClick={async () => {
              await api.deleteRecording(rec.id);
              onClose();
              notifyDataChanged();
            }}
          >
            Silmeyi onayla (geri alınamaz)
          </Button>
        ) : (
          <Button variant="ghost" className="text-xs hover:text-danger" onClick={() => setConfirmDelete(true)}>
            <Trash2 size={14} /> Kaydı sil
          </Button>
        )}
        <Button variant="ghost" onClick={onClose}>Kapat</Button>
      </div>
    </Modal>
  );
}
