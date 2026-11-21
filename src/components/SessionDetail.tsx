import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Pencil, Trash2 } from "lucide-react";
import {
  api, errorText, type DrawingMeta, type Homework, type PatientFileMeta, type RecordingMeta, type Session, type TestResult,
} from "../lib/api";
import { clock, fmtDate, fmtDateTime, minutes, plainText } from "../lib/format";
import { notifyDataChanged, useActiveSession } from "../lib/session";
import { HOMEWORK_STATUS } from "./workspace/Homework";
import { EditorContent, NoteViewer, Toolbar, useNotesEditor } from "./NotesEditor";
import { Button, Field, inputCls, Modal } from "./ui";

/** Geçmiş seansın yanındaki "Düzenle" düğmesi: o seansa ait her şeyi açar (süre, not, test, ödev, çizim, dosya, kayıt). */
export function SessionEditButton({ session }: { session: Session }) {
  const [open, setOpen] = useState(false);
  const { session: live } = useActiveSession();
  // Şu an süren seansı saat tutar ve ekranda yazılır; onu buradan düzenlemeyiz.
  if (live?.id === session.id || session.status === "planned") return null;
  return (
    <>
      <button
        onClick={(e) => {
          e.stopPropagation(); // satır tıklaması danışanı açmasın
          setOpen(true);
        }}
        className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-accent hover:bg-accent-soft"
        title="Bu seansın bilgilerini düzenle veya sil"
      >
        <Pencil size={12} /> Düzenle
      </button>
      {open && <SessionDetail session={session} onClose={() => setOpen(false)} />}
    </>
  );
}

interface Data {
  note: string | null;
  results: TestResult[];
  homework: Homework[];
  drawings: DrawingMeta[];
  files: PatientFileMeta[];
  recordings: RecordingMeta[];
}

function SessionDetail({ session, onClose }: { session: Session; onClose: () => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [duration, setDuration] = useState(String(Math.round(session.duration_seconds / 60)));
  const [savedDuration, setSavedDuration] = useState(session.duration_seconds);
  const [editingNote, setEditingNote] = useState(false);
  const [ask, setAsk] = useState<{ text: string; run: () => Promise<void> } | null>(null);
  const [withItems, setWithItems] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const pid = session.patient_id;
    const n = session.session_number;
    const [note, results, homework, drawings, files, recordings] = await Promise.all([
      api.getSessionNote(session.id),
      api.listTestResults(pid),
      api.listHomework(pid),
      api.listDrawings(pid),
      api.listPatientFiles(pid),
      api.listRecordings(pid),
    ]);
    setData({
      note,
      results: results.filter((r) => r.session_id === session.id),
      homework: homework.filter((h) => h.session_id === session.id),
      drawings: drawings.filter((d) => d.session_number === n),
      files: files.filter((f) => f.session_number === n),
      recordings: recordings.filter((r) => r.session_number === n),
    });
  }, [session]);

  useEffect(() => {
    load().catch((e) => setMsg({ ok: false, text: errorText(e) }));
  }, [load]);

  const run = async (fn: () => Promise<void>, done?: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      notifyDataChanged();
      await load();
      if (done) setMsg({ ok: true, text: done });
    } catch (e) {
      setMsg({ ok: false, text: errorText(e) });
    } finally {
      setBusy(false);
      setAsk(null);
    }
  };

  const saveDuration = () => {
    const m = Number(duration.replace(",", "."));
    if (!Number.isFinite(m) || m < 0 || m > 1440) {
      setMsg({ ok: false, text: "Süre 0 ile 1440 dakika (24 saat) arasında olmalı." });
      return;
    }
    void run(async () => {
      await api.updateSessionDuration(session.id, Math.round(m * 60));
      setSavedDuration(Math.round(m * 60));
    }, "Süre kaydedildi.");
  };

  const del = (text: string, fn: () => Promise<void>) => setAsk({ text, run: () => run(fn, "Silindi.") });

  const removeSession = () =>
    setAsk({
      text: withItems
        ? "Seans, notu ve seansa bağlı her şey (test sonuçları, ödevler, çizimler, dosyalar, kayıtlar) kalıcı olarak silinecek."
        : "Seans ve notu silinecek. Seansa bağlı test sonuçları, ödevler, çizimler ve dosyalar danışan dosyasında kalır.",
      run: async () => {
        setBusy(true);
        try {
          await api.deleteSession(session.id, withItems);
          notifyDataChanged();
          onClose();
        } catch (e) {
          setMsg({ ok: false, text: errorText(e) });
          setAsk(null);
          setBusy(false);
        }
      },
    });

  return (
    <Modal title={`${session.session_number}. Seans • ${fmtDate(session.session_date)}`} onClose={onClose} width="max-w-2xl">
      <div className="space-y-5 text-sm">
        <Section title="Süre">
          <div className="flex items-end gap-2">
            <Field label="Dakika">
              <input type="number" min={0} max={1440} className={`${inputCls} w-28`} value={duration} onChange={(e) => setDuration(e.target.value)} />
            </Field>
            <Button variant="subtle" onClick={saveDuration} disabled={busy || Number(duration) * 60 === savedDuration}>Kaydet</Button>
            <span className="pb-2 text-xs text-faint">Şu an: {minutes(savedDuration)}</span>
          </div>
        </Section>

        <Section title="Seans notu">
          {data === null ? null : editingNote ? (
            <NoteEditor
              initial={data.note ?? ""}
              onCancel={() => setEditingNote(false)}
              onSave={(html) => run(async () => {
                await api.saveNote(session.id, html);
                setEditingNote(false);
              }, "Not kaydedildi.")}
            />
          ) : data.note ? (
            <>
              <div className="max-h-48 overflow-y-auto rounded-lg bg-card/60 p-3"><NoteViewer html={data.note} /></div>
              <div className="mt-2 flex gap-2">
                <Button variant="subtle" onClick={() => setEditingNote(true)}><Pencil size={14} /> Notu düzenle</Button>
                <Button variant="ghost" className="hover:text-danger" onClick={() => del("Bu seansın notu silinecek.", () => api.deleteSessionNote(session.id))}>
                  <Trash2 size={14} /> Notu sil
                </Button>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-3 text-muted">
              Bu seansta not yok.
              <Button variant="subtle" onClick={() => setEditingNote(true)}>Not ekle</Button>
            </div>
          )}
        </Section>

        {data && (
          <>
            <List title="Test sonuçları" empty="Bu seansta test sonucu yok." items={data.results.map((r) => ({
              id: r.id,
              label: r.test_title,
              hint: `${r.total_score !== null ? `${r.total_score} puan • ` : ""}${fmtDateTime(r.completed_at, true)}`,
              remove: () => del(`“${r.test_title}” sonucu silinecek.`, () => api.deleteTestResult(r.id)),
            }))} />
            <List title="Ödevler" empty="Bu seansta verilen ödev yok." items={data.homework.map((h) => ({
              id: h.id,
              label: h.title,
              hint: HOMEWORK_STATUS[h.status].label,
              remove: () => del(`“${h.title}” ödevi silinecek.`, () => api.deleteHomework(h.id)),
            }))} />
            <List title="Çizimler" empty="Bu seansta çizim yok." items={data.drawings.map((d) => ({
              id: d.id,
              label: d.title,
              hint: fmtDateTime(d.created_at, true),
              remove: () => del(`“${d.title}” çizimi silinecek.`, () => api.deleteDrawing(d.id)),
            }))} />
            <List title="Danışanın gönderdiği dosyalar" empty="Bu seansta dosya yok." items={data.files.map((f) => ({
              id: f.id,
              label: f.name,
              hint: fmtDateTime(f.created_at, true),
              remove: () => del(`“${f.name}” dosyası silinecek.`, () => api.deletePatientFile(f.id)),
            }))} />
            <List title="Görüşme kayıtları" empty="Bu seansta kayıt yok." items={data.recordings.map((r) => ({
              id: r.id,
              label: `Kayıt • ${clock(r.duration_seconds)}`,
              hint: fmtDateTime(r.created_at, true),
              remove: () => del("Bu görüşme kaydı silinecek.", () => api.deleteRecording(r.id)),
            }))} />
          </>
        )}

        {msg && <p className={`text-xs ${msg.ok ? "text-ok" : "text-danger"}`}>{msg.text}</p>}

        <div className="rounded-lg border border-danger/30 bg-danger/5 p-3">
          <div className="mb-2 text-xs font-medium text-danger">Seansı sil</div>
          <label className="mb-2 flex cursor-pointer items-start gap-2 text-xs text-muted">
            <input type="checkbox" className="mt-0.5 h-3.5 w-3.5 accent-[var(--color-danger)]" checked={withItems} onChange={(e) => setWithItems(e.target.checked)} />
            <span>Seansa bağlı test sonuçları, ödevler, çizimler, dosyalar ve kayıtlar da silinsin</span>
          </label>
          <Button variant="danger" onClick={removeSession} disabled={busy}><Trash2 size={14} /> Seansı sil</Button>
        </div>
      </div>

      {ask && (
        <div className="mt-4 rounded-lg border border-danger/40 bg-card p-3">
          <p className="text-sm">{ask.text} <b>Bu işlem geri alınamaz.</b></p>
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setAsk(null)} disabled={busy}>Vazgeç</Button>
            <Button variant="danger" onClick={() => void ask.run()} disabled={busy}>{busy ? "Siliniyor…" : "Evet, sil"}</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">{title}</h3>
      {children}
    </section>
  );
}

function List({ title, empty, items }: { title: string; empty: string; items: { id: string; label: string; hint: string; remove: () => void }[] }) {
  return (
    <Section title={`${title} (${items.length})`}>
      {items.length === 0 ? (
        <p className="text-xs text-faint">{empty}</p>
      ) : (
        <ul className="space-y-1">
          {items.map((i) => (
            <li key={i.id} className="flex items-center gap-2 rounded-lg bg-card/60 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate">{i.label}</div>
                <div className="text-xs text-muted">{i.hint}</div>
              </div>
              <button onClick={i.remove} className="rounded-md p-1.5 text-muted hover:bg-danger/10 hover:text-danger" title="Sil" aria-label="Sil">
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function NoteEditor({ initial, onSave, onCancel }: { initial: string; onSave: (html: string) => Promise<void>; onCancel: () => void }) {
  const [html, setHtml] = useState(initial);
  const editor = useNotesEditor({ content: initial, editable: true, placeholder: "Seans notu…", onChange: setHtml });
  return (
    <div>
      <Toolbar editor={editor} />
      <div className="mt-2 h-48 overflow-y-auto rounded-lg border border-line bg-bg p-3">
        <EditorContent editor={editor} className="h-full" />
      </div>
      <div className="mt-2 flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>Vazgeç</Button>
        <Button onClick={() => void onSave(html)} disabled={!plainText(html).trim() && !html.includes("<img")}>Kaydet</Button>
      </div>
    </div>
  );
}
