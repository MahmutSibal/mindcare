import { useCallback, useEffect, useRef, useState } from "react";
import { ClipboardCheck, Clock3, FileSignature, MonitorX, Pause, Play, PenTool, Send, Square, Undo2 } from "lucide-react";
import { api, errorText, type Material, type Patient, type Test } from "../../lib/api";
import { clock } from "../../lib/format";
import { notifyDataChanged, useActiveSession } from "../../lib/session";
import { maxScore, parseDefinition } from "../../lib/tests";
import { EditorContent, Toolbar, useNotesEditor } from "../NotesEditor";
import { Button, Card, cx, Empty, Modal, SoonTag } from "../ui";
import { CATEGORY_LABEL, CategoryIcon } from "../category";
import type { CallApi } from "./useCall";

export default function SessionPanel({ call, patient, shared, onClearShared }: {
  call: CallApi;
  patient: Patient | null;
  shared: Material | null;
  onClearShared: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-col gap-3 overflow-y-auto pl-0.5">
      <SessionTimer patient={patient} call={call} />
      <LiveNotesEditor />
      <QuickTools call={call} patient={patient} />
      <PatientScreenPreview call={call} shared={shared} onClearShared={onClearShared} />
    </div>
  );
}

// ───────────────────────────── Zamanlayıcı ─────────────────────────────

function SessionTimer({ patient, call }: { patient: Patient | null; call: CallApi }) {
  const a = useActiveSession();
  const [error, setError] = useState<string | null>(null);
  const pct = Math.min(100, (a.elapsed / a.targetSeconds) * 100);
  const over = a.elapsed > a.targetSeconds;

  const startInPerson = async () => {
    if (!patient) return;
    setError(null);
    try {
      await a.start(patient.id);
      notifyDataChanged();
    } catch (e) {
      setError(errorText(e));
    }
  };
  const finish = async () => {
    if (call.inCall) await call.hangup();
    await a.finish();
    notifyDataChanged();
  };

  return (
    <Card>
      <div className="flex items-center gap-4">
        <Clock3 size={34} className="shrink-0 text-accent" strokeWidth={1.8} />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] text-muted">
            {a.session ? `${a.session.session_number}. Seans • ${a.session.patient_name}` : "Seans Süresi"}
          </div>
          <div className="text-[26px] font-semibold tabular-nums leading-tight">
            <span className={over ? "text-warn" : ""}>{clock(a.elapsed)}</span>
            <span className="text-lg text-accent"> / {clock(a.targetSeconds)}</span>
          </div>
        </div>
        {a.session ? (
          <div className="flex gap-1.5">
            <button
              onClick={a.running ? a.pause : a.resume}
              className="rounded-lg bg-card p-2.5 text-ink hover:bg-line"
              title={a.running ? "Duraklat" : "Devam et"}
            >
              {a.running ? <Pause size={18} /> : <Play size={18} />}
            </button>
            <button onClick={finish} className="rounded-lg bg-card p-2.5 text-danger hover:bg-line" title="Seansı bitir">
              <Square size={18} />
            </button>
          </div>
        ) : (
          <Button variant="subtle" className="text-xs" onClick={startInPerson} disabled={!patient} title="Görüntülü görüşme olmadan seans başlat">
            <Play size={14} /> Başlat
          </Button>
        )}
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-card">
        <div className={cx("h-full rounded-full transition-all", over ? "bg-warn" : "bg-accent")} style={{ width: `${pct}%` }} />
      </div>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </Card>
  );
}

// ───────────────────────────── Canlı not editörü ─────────────────────────────

function LiveNotesEditor() {
  const { session } = useActiveSession();
  // Seans değişince editör sıfırdan kurulur.
  return <NotesForSession key={session?.id ?? "none"} sessionId={session?.id ?? null} />;
}

function NotesForSession({ sessionId }: { sessionId: string | null }) {
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [state, setState] = useState<"idle" | "dirty" | "saving" | "error">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<string>("");
  const loaded = useRef(false);

  const save = useCallback(async () => {
    if (!sessionId || !loaded.current) return;
    if (timer.current) clearTimeout(timer.current);
    setState("saving");
    try {
      await api.saveNote(sessionId, latest.current);
      setSavedAt(new Date());
      setState("idle");
      notifyDataChanged();
    } catch {
      setState("error");
    }
  }, [sessionId]);

  const editor = useNotesEditor({
    content: "",
    editable: !!sessionId,
    placeholder: sessionId ? "Seans notlarınızı buraya yazın…" : "Not almak için bir seans başlatın.",
    onChange: (html) => {
      latest.current = html;
      setState("dirty");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(save, 1500);
    },
  });

  useEffect(() => {
    if (!sessionId || !editor) return;
    api.getSessionNote(sessionId).then((html) => {
      if (html) editor.commands.setContent(html, { emitUpdate: false });
      latest.current = editor.getHTML();
      loaded.current = true;
    });
  }, [sessionId, editor]);

  // Editör kapanırken bekleyen değişikliği kaydet.
  useEffect(() => () => {
    if (timer.current && sessionId && loaded.current) {
      clearTimeout(timer.current);
      api.saveNote(sessionId, latest.current).then(notifyDataChanged).catch(() => {});
    }
  }, [sessionId]);

  const status =
    state === "saving" ? "Kaydediliyor…"
    : state === "dirty" ? "Kaydedilmemiş değişiklik"
    : state === "error" ? "Kaydedilemedi!"
    : savedAt ? `Otomatik kaydedildi • ${savedAt.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}`
    : "";

  return (
    <Card title="Seans Notları" className="flex min-h-[300px] flex-1 flex-col">
      <Toolbar editor={editor} />
      <div
        className={cx("mt-2 min-h-0 flex-1 overflow-y-auto rounded-lg border border-line bg-bg/60 p-3", !sessionId && "opacity-60")}
        onClick={() => editor?.commands.focus()}
      >
        <EditorContent editor={editor} className="h-full" />
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className={cx("text-xs", state === "error" ? "text-danger" : "text-muted")}>{status}</span>
        <Button onClick={save} disabled={!sessionId || state === "saving"} className="py-1.5">Notu Kaydet</Button>
      </div>
    </Card>
  );
}

// ───────────────────────────── Hızlı araçlar ─────────────────────────────

interface PendingTest {
  requestId: string;
  test: Test;
  patientId: string;
  sessionId: string | null;
}

function QuickTools({ call, patient }: { call: CallApi; patient: Patient | null }) {
  const { session } = useActiveSession();
  const [picking, setPicking] = useState(false);
  const [pending, setPending] = useState<PendingTest | null>(null);
  const [last, setLast] = useState<{ title: string; score: number | null; max: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const connected = call.state === "connected";

  // Danışandan gelen test cevaplarını kaydet. Puan Rust tarafında yeniden hesaplanır.
  const { onMessage } = call;
  useEffect(
    () =>
      onMessage(async (m) => {
        const p = pendingRef.current;
        if (m.type !== "test_answers" || !p || m.requestId !== p.requestId) return;
        setPending(null);
        try {
          const r = await api.saveTestResult({
            patient_id: p.patientId,
            session_id: p.sessionId,
            test_id: p.test.id,
            test_title: p.test.title,
            definition_json: p.test.definition_json,
            answers_json: JSON.stringify(m.answers),
          });
          setLast({ title: r.test_title, score: r.total_score, max: maxScore(parseDefinition(r.definition_json)) });
          notifyDataChanged();
        } catch (e) {
          setError(`Test sonucu kaydedilemedi: ${errorText(e)}`);
        }
      }),
    [onMessage],
  );

  // Görüşme bitince bekleyen test düşer.
  useEffect(() => {
    if (!call.inCall) setPending(null);
  }, [call.inCall]);

  const send = (test: Test) => {
    if (!patient) return;
    setError(null);
    const requestId = crypto.randomUUID();
    const ok = call.sendMessage({
      type: "test",
      requestId,
      title: test.title,
      instructions: test.instructions,
      definition: parseDefinition(test.definition_json),
    });
    if (!ok) {
      setError("Danışan bağlantısı hazır değil. Görüşme bağlandıktan sonra tekrar deneyin.");
      return;
    }
    setPending({ requestId, test, patientId: patient.id, sessionId: session?.id ?? null });
    setLast(null);
    setPicking(false);
  };

  const withdraw = () => {
    if (pending) call.sendMessage({ type: "test_cancel", requestId: pending.requestId });
    setPending(null);
  };

  const soon = [
    { icon: FileSignature, title: "Dijital Ödev Ver", v: "1.2" },
    { icon: PenTool, title: "Beyaz Tahta Aç", v: "1.3" },
  ];

  return (
    <Card title="Hızlı Araçlar">
      <ul className="space-y-2">
        <li className="rounded-lg bg-card px-3 py-2.5">
          <div className="flex items-center gap-3">
            <ClipboardCheck size={20} className={connected ? "text-accent" : "text-muted"} />
            <div className="min-w-0 flex-1 text-sm">
              Klinik Test Gönder
              <div className="truncate text-xs text-faint">
                {pending
                  ? `Danışan dolduruyor: ${pending.test.title}`
                  : last
                    ? `Son: ${last.title}${last.score !== null ? ` • ${last.score}${last.max !== null ? ` / ${last.max}` : ""} puan` : ""}`
                    : connected ? "Görüşme sırasında danışana gönderin" : "Görüşme bağlanınca kullanılabilir"}
              </div>
            </div>
            {pending ? (
              <Button variant="ghost" className="px-2 py-1 text-xs" onClick={withdraw}><Undo2 size={14} /> Geri çek</Button>
            ) : (
              <Button variant="outline" className="px-3 py-1 text-xs" onClick={() => setPicking(true)} disabled={!connected || !patient}>
                Seç
              </Button>
            )}
          </div>
          {error && <p className="mt-2 text-xs text-danger">{error}</p>}
        </li>
        {soon.map(({ icon: I, title, v }) => (
          <li key={title} className="flex items-center gap-3 rounded-lg bg-card px-3 py-2.5 opacity-70" title="Sonraki sürümde">
            <I size={20} className="text-muted" />
            <div className="flex-1 text-sm">{title}</div>
            <SoonTag version={v} />
          </li>
        ))}
      </ul>
      {picking && <TestPicker onClose={() => setPicking(false)} onSend={send} />}
    </Card>
  );
}

function TestPicker({ onClose, onSend }: { onClose: () => void; onSend: (t: Test) => void }) {
  const [tests, setTests] = useState<Test[] | null>(null);
  useEffect(() => {
    api.listTests().then(setTests);
  }, []);
  return (
    <Modal title="Danışana test gönder" onClose={onClose}>
      {tests === null ? null : tests.length === 0 ? (
        <Empty text="Henüz test yok. Sol menüdeki Testler sayfasından oluşturabilirsiniz." />
      ) : (
        <ul className="space-y-2">
          {tests.map((t) => {
            const def = parseDefinition(t.definition_json);
            return (
              <li key={t.id} className="flex items-center gap-3 rounded-lg bg-card p-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{t.title}</div>
                  <div className="text-xs text-muted">{def.questions.length} soru</div>
                </div>
                <Button className="px-3 py-1.5 text-xs" onClick={() => onSend(t)}><Send size={14} /> Gönder</Button>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}

// ───────────────────────────── Paylaşım önizlemesi ─────────────────────────────

function PatientScreenPreview({ call, shared, onClearShared }: { call: CallApi; shared: Material | null; onClearShared: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = call.screen;
  }, [call.screen]);

  return (
    <Card title="Paylaşılan Ekran Önizleme">
      <div className="relative aspect-video overflow-hidden rounded-lg border border-line bg-bg">
        {call.screen ? (
          <video ref={ref} autoPlay muted playsInline className="h-full w-full object-contain" />
        ) : shared ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
            <span className="text-accent"><CategoryIcon c={shared.category} size={34} /></span>
            <div className="text-sm">{shared.title}</div>
            <div className="text-xs text-muted">{CATEGORY_LABEL[shared.category]} • danışana başlık bildirildi</div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-faint">Danışanla paylaşılan bir şey yok</div>
        )}
        {(call.screen || shared) && (
          <button
            onClick={call.screen ? call.stopScreen : onClearShared}
            className="absolute bottom-2 right-2 flex items-center gap-1.5 rounded-lg bg-danger px-3 py-1.5 text-xs font-medium text-white hover:bg-danger/85"
          >
            <MonitorX size={14} /> Paylaşımı Durdur
          </button>
        )}
      </div>
    </Card>
  );
}
