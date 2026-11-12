import { useEffect, useRef, useState } from "react";
import { Pencil, Save, Trash2, X } from "lucide-react";
import { api, errorText, type DrawingMeta, type Patient } from "../../lib/api";
import { loadImage, renderPngBase64 } from "../../lib/board";
import { fmtDate } from "../../lib/format";
import { notifyDataChanged } from "../../lib/session";
import type { BoardApi } from "../../lib/useBoard";
import BoardCanvas from "../BoardCanvas";
import { Button, Empty, Field, inputCls, Modal } from "../ui";

const BACKGROUND = "#152629";

const SUGGESTIONS = [
  "Bir ev, bir ağaç ve bir insan çizin.",
  "Bir saat çizin ve saati on bir geçeyi gösterecek şekilde ayarlayın.",
  "Şu an nasıl hissettiğinizi renklerle ya da şekillerle gösterin.",
  "Ailenizi çizin.",
];

/** Terapist: ortak çizimi başlatırken isteğe bağlı yönerge sorar. */
export function BoardStartDialog({ onStart, onClose }: { onStart: (prompt: string | null) => void; onClose: () => void }) {
  const [prompt, setPrompt] = useState("");
  return (
    <Modal title="Ortak çizim başlat" onClose={onClose}>
      <p className="mb-4 text-sm text-muted">
        Danışanın ekranında bir tuval açılır; ikiniz de aynı tuvale yazıp çizersiniz, çizilenler anında karşı tarafta görünür.
        Telefon, tablet ve bilgisayarda parmak, kalem veya fareyle çalışır.
      </p>
      <Field label="Danışana yönerge (isteğe bağlı)" hint="Tuvalin üstünde danışana gösterilir.">
        <textarea className={inputCls} rows={2} value={prompt} onChange={(e) => setPrompt(e.target.value)} autoFocus />
      </Field>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {SUGGESTIONS.map((s) => (
          <button key={s} onClick={() => setPrompt(s)} className="rounded-full border border-line bg-card px-2.5 py-1 text-xs text-muted hover:text-ink">
            {s}
          </button>
        ))}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Vazgeç</Button>
        <Button onClick={() => onStart(prompt)}><Pencil size={15} /> Başlat</Button>
      </div>
    </Modal>
  );
}

function RemoteThumb({ stream }: { stream: MediaStream | null }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  if (!stream) return null;
  return <video ref={ref} autoPlay playsInline muted className="h-16 w-24 shrink-0 rounded-lg border border-line bg-black object-cover" />;
}

/** Terapist: ortak tuval, kaydetme ve kapatma. Ses ve görüntü açık kalır. */
export function BoardPanel({ boardApi, patient, sessionId, remote, backdropUrl }: {
  boardApi: BoardApi;
  patient: Patient | null;
  sessionId: string | null;
  remote: MediaStream | null;
  /** Arka plan görseli (üzerine çizilen materyal). */
  backdropUrl: string | null;
}) {
  const session = boardApi.session!;
  const [title, setTitle] = useState(session.prompt?.slice(0, 60) || "Çizim");
  const [savedRev, setSavedRev] = useState<number | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const empty = boardApi.board.elements.length === 0;
  const dirty = !empty && savedRev !== boardApi.rev;

  const save = async (): Promise<boolean> => {
    if (!patient) return false;
    if (empty) {
      setMessage({ ok: false, text: "Tuval boş; kaydedilecek bir şey yok." });
      return false;
    }
    try {
      const img = backdropUrl ? await loadImage(backdropUrl).catch(() => null) : null;
      await api.saveDrawing({
        patient_id: patient.id,
        session_id: sessionId,
        title: title.trim() || "Çizim",
        prompt: session.prompt ?? undefined,
        png_base64: renderPngBase64(boardApi.board.elements, BACKGROUND, img),
      });
      setSavedRev(boardApi.rev);
      setMessage({ ok: true, text: "Danışan dosyasına kaydedildi (Klinik → Testler)." });
      notifyDataChanged();
      return true;
    } catch (e) {
      setMessage({ ok: false, text: errorText(e) });
      return false;
    }
  };

  return (
    <div className="fixed inset-3 z-40 flex flex-col gap-2 rounded-2xl border border-line bg-panel p-3 shadow-2xl">
      <div className="flex shrink-0 items-center gap-3">
        <RemoteThumb stream={remote} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">Ortak çizim{patient ? ` • ${patient.full_name}` : ""}</div>
          {session.prompt && <p className="truncate text-xs text-muted" title={session.prompt}>Yönerge: {session.prompt}</p>}
        </div>
        <input
          className={`${inputCls} hidden w-48 md:block`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={80}
          aria-label="Kayıt başlığı"
          placeholder="Kayıt başlığı"
        />
        <Button variant="outline" onClick={() => void save()} disabled={!patient}>
          <Save size={15} /> Danışan dosyasına kaydet
        </Button>
        <Button variant="ghost" onClick={() => (dirty ? setConfirmClose(true) : boardApi.close())} aria-label="Tahtayı kapat" title="Tahtayı iki taraf için kapat">
          <X size={18} />
        </Button>
      </div>
      {message && <p className={`shrink-0 text-xs ${message.ok ? "text-ok" : "text-danger"}`}>{message.text}</p>}
      <div className="min-h-0 flex-1">
        <BoardCanvas board={boardApi.board} rev={boardApi.rev} sessionId={session.id} send={boardApi.send} onChange={boardApi.bump} background={BACKGROUND} backdropUrl={backdropUrl} />
      </div>

      {confirmClose && (
        <Modal title="Kaydedilmemiş çizim var" onClose={() => setConfirmClose(false)}>
          <p className="text-sm text-muted">Tahtayı kapatırsanız çizim iki taraftan da silinir. Önce danışan dosyasına kaydetmek ister misiniz?</p>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmClose(false)}>Vazgeç</Button>
            <Button variant="danger" onClick={() => boardApi.close()}>Kaydetmeden kapat</Button>
            <Button
              onClick={async () => {
                if (await save()) boardApi.close();
                else setConfirmClose(false);
              }}
            >
              Kaydet ve kapat
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** Danışan dosyasında kayıtlı çizimler (Testler sekmesinin altında). */
export function DrawingsList({ drawings }: { drawings: DrawingMeta[] }) {
  const [open, setOpen] = useState<DrawingMeta | null>(null);
  const [png, setPng] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setPng(null);
    setConfirmDelete(false);
    if (open) api.getDrawing(open.id).then(setPng).catch(() => setPng(""));
  }, [open]);

  if (drawings.length === 0) return null;
  return (
    <section className="mt-4">
      <h3 className="mb-1.5 flex items-center gap-1.5 text-[13px] font-medium">
        <Pencil size={13} className="text-accent" /> Çizimler
      </h3>
      <ul className="space-y-1">
        {drawings.map((d) => (
          <li key={d.id}>
            <button onClick={() => setOpen(d)} className="flex w-full items-center gap-2 rounded-md px-1 py-1.5 text-left text-[13px] hover:bg-card">
              <span className="truncate">{d.title}</span>
              <span className="shrink-0 text-faint">
                • {fmtDate(d.created_at, true)}
                {d.session_number !== null ? ` • ${d.session_number}. seans` : ""}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {open && (
        <Modal title={open.title} onClose={() => setOpen(null)} width="max-w-3xl">
          {open.prompt && <p className="mb-3 text-xs text-muted">Yönerge: {open.prompt}</p>}
          {png === null ? (
            <Empty text="Yükleniyor…" />
          ) : png === "" ? (
            <Empty text="Çizim açılamadı." />
          ) : (
            <img src={`data:image/png;base64,${png}`} alt={open.title} className="w-full rounded-lg border border-line" />
          )}
          <div className="mt-4 flex justify-between">
            {confirmDelete ? (
              <Button
                variant="danger"
                className="text-xs"
                onClick={async () => {
                  await api.deleteDrawing(open.id);
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
            <Button variant="ghost" onClick={() => setOpen(null)}>Kapat</Button>
          </div>
        </Modal>
      )}
    </section>
  );
}
