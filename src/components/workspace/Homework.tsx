import { useEffect, useState } from "react";
import { ChevronRight, FileSignature, Plus, Send, Trash2 } from "lucide-react";
import { api, errorText, type Homework, type HomeworkStatus, type Patient } from "../../lib/api";
import { fmtDate, fmtDateTime } from "../../lib/format";
import { notifyDataChanged } from "../../lib/session";
import { Badge, Button, Card, cx, Empty, Field, inputCls, LinkButton, Modal } from "../ui";
import type { CallApi } from "./useCall";

export const HOMEWORK_STATUS: Record<HomeworkStatus, { label: string; tone: "accent" | "ok" | "warn" | "muted" }> = {
  assigned: { label: "Verildi", tone: "accent" },
  done: { label: "Yapıldı", tone: "ok" },
  partial: { label: "Kısmen", tone: "warn" },
  not_done: { label: "Yapılmadı", tone: "muted" },
};

// Bu oturumda danışana gönderilen ödevler. Danışan sayfasından gelen "ulaştı" onayı
// yalnızca bunlar için kabul edilir.
const sent = new Set<string>();

/** Ödevi görüşme kanalından danışana gönderir; kanal açık değilse `false` döner. */
export function sendHomework(call: CallApi, hw: Homework): boolean {
  const ok = call.sendMessage({ type: "homework", id: hw.id, title: hw.title, description: hw.description, due: hw.due_date });
  if (ok) sent.add(hw.id);
  return ok;
}

/** Danışan sayfasından gelen ödev onaylarını kaydeder. Çalışma alanında bir kez bağlanır. */
export function useHomeworkDeliveryReceipts(call: CallApi) {
  const { onMessage } = call;
  useEffect(
    () =>
      onMessage((m) => {
        if (m.type !== "homework_received" || !sent.has(m.id)) return;
        sent.delete(m.id);
        api.markHomeworkDelivered(m.id).then(notifyDataChanged).catch(() => {});
      }),
    [onMessage],
  );
}

// ───────────────────────────── Ödev verme ─────────────────────────────

export function HomeworkDialog({ patient, sessionId, call, onClose }: {
  patient: Patient;
  sessionId: string | null;
  call: CallApi;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [due, setDue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const connected = call.state === "connected";

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const hw = await api.createHomework({
        patient_id: patient.id,
        session_id: sessionId,
        title,
        description,
        due_date: due,
      });
      if (connected) sendHomework(call, hw);
      notifyDataChanged();
      onClose();
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <Modal title={`Ödev ver • ${patient.full_name}`} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <Field label="Başlık">
          <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus required placeholder="Örn. Düşünce kaydı tutmak" />
        </Field>
        <Field label="Açıklama" hint="Danışanın ekranında görünür; danışan indirip saklayabilir.">
          <textarea
            className={inputCls}
            rows={5}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Her gün kaygılandığınız bir anı, aklınızdan geçen düşünceyi ve o anki duygunuzu yazın…"
          />
        </Field>
        <Field label="Son tarih (isteğe bağlı)">
          <input type="date" className={inputCls} value={due} onChange={(e) => setDue(e.target.value)} />
        </Field>
        <p className={cx("rounded-lg px-3 py-2 text-xs", connected ? "bg-accent-soft text-accent" : "bg-card text-muted")}>
          {connected
            ? "Kaydedince danışanın ekranına da gönderilecek."
            : "Görüşme açık değil: ödev kaydedilir, sonraki görüşmede danışan dosyasından gönderebilirsiniz."}
        </p>
        {error && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Vazgeç</Button>
          <Button type="submit">{connected ? <><Send size={15} /> Kaydet ve gönder</> : "Kaydet"}</Button>
        </div>
      </form>
    </Modal>
  );
}

// ───────────────────────────── Danışan dosyasındaki kart ─────────────────────────────

export function HomeworkCard({ patient, homework, call, sessionId, inTab }: {
  patient: Patient | null;
  homework: Homework[];
  call: CallApi;
  sessionId: string | null;
  /** Sekmeli panelde: çerçevesiz, tüm liste. */
  inTab?: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<Homework | null>(null);
  const [all, setAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connected = call.state === "connected";
  const list = all || inTab ? homework : homework.slice(0, 3);

  const resend = (hw: Homework) => {
    setError(sendHomework(call, hw) ? null : "Danışan bağlantısı hazır değil.");
  };

  return (
    <Card
      bare={inTab}
      title="Ödevler"
      action={
        <div className="flex items-center gap-3">
          {!inTab && homework.length > 3 && <LinkButton onClick={() => setAll(!all)}>{all ? "Daralt" : "Tümü"} <ChevronRight size={14} /></LinkButton>}
          {patient && (
            inTab ? (
              <LinkButton onClick={() => setAdding(true)}><Plus size={14} /> Ödev ver</LinkButton>
            ) : (
              <button onClick={() => setAdding(true)} className="rounded-md p-1 text-muted hover:bg-card hover:text-ink" title="Ödev ver">
                <Plus size={17} />
              </button>
            )
          )}
        </div>
      }
    >
      {homework.length === 0 ? (
        <Empty text="Henüz ödev verilmedi." />
      ) : (
        <ul className="space-y-1">
          {list.map((h) => {
            const s = HOMEWORK_STATUS[h.status];
            return (
              <li key={h.id} className="flex items-center gap-2 rounded-md px-1 py-1.5 hover:bg-card">
                <button onClick={() => setOpen(h)} className="flex min-w-0 flex-1 items-center gap-2 text-left text-[13px]">
                  <FileSignature size={15} className="shrink-0 text-accent" />
                  <span className="truncate">{h.title}</span>
                  <span className="shrink-0 text-faint">• {fmtDate(h.created_at, true)}</span>
                </button>
                {!h.delivered_at && h.status === "assigned" && connected ? (
                  <Button variant="outline" className="px-2 py-0.5 text-[11px]" onClick={() => resend(h)} title="Danışana gönder">
                    <Send size={12} /> Gönder
                  </Button>
                ) : (
                  <Badge tone={s.tone}>{s.label}</Badge>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      {adding && patient && <HomeworkDialog patient={patient} sessionId={sessionId} call={call} onClose={() => setAdding(false)} />}
      {open && <HomeworkReview homework={open} onClose={() => setOpen(null)} />}
    </Card>
  );
}

function HomeworkReview({ homework: h, onClose }: { homework: Homework; onClose: () => void }) {
  const [status, setStatus] = useState<HomeworkStatus>(h.status);
  const [note, setNote] = useState(h.review_note ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    try {
      await api.reviewHomework(h.id, status, note);
      notifyDataChanged();
      onClose();
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <Modal title={h.title} onClose={onClose}>
      <div className="mb-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span>Verildi: {fmtDateTime(h.created_at, true)}</span>
        {h.session_number !== null && <span>{h.session_number}. Seans</span>}
        {h.due_date && <span>Son tarih: {fmtDate(h.due_date)}</span>}
        <span>{h.delivered_at ? `Danışana ulaştı: ${fmtDateTime(h.delivered_at, true)}` : "Danışana iletilmedi"}</span>
      </div>
      {h.description && <p className="mb-5 whitespace-pre-wrap rounded-lg bg-card/60 p-3 text-sm">{h.description}</p>}

      <p className="mb-2 text-[13px] text-muted">Değerlendirme</p>
      <div className="mb-3 grid grid-cols-4 gap-2">
        {(Object.keys(HOMEWORK_STATUS) as HomeworkStatus[]).map((k) => (
          <button
            key={k}
            onClick={() => setStatus(k)}
            className={cx(
              "rounded-lg border px-2 py-2 text-xs",
              status === k ? "border-accent bg-accent-soft text-ink" : "border-line text-muted hover:text-ink",
            )}
          >
            {HOMEWORK_STATUS[k].label}
          </button>
        ))}
      </div>
      <textarea className={inputCls} rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Not (isteğe bağlı): danışanın ödevle ilgili paylaştıkları…" />
      {error && <p className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

      <div className="mt-5 flex items-center justify-between gap-2">
        {confirmDelete ? (
          <Button
            variant="danger"
            className="text-xs"
            onClick={async () => {
              await api.deleteHomework(h.id);
              notifyDataChanged();
              onClose();
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
          <Button variant="ghost" onClick={onClose}>Vazgeç</Button>
          <Button onClick={save}>Kaydet</Button>
        </div>
      </div>
    </Modal>
  );
}
