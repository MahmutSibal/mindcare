import { useCallback, useEffect, useRef, useState } from "react";
import { ClipboardCheck, Clock3, FileSignature, MonitorX, Pause, Pencil, Play, Send, Sparkles, Square, Undo2 } from "lucide-react";
import { api, errorText, type Patient, type Test } from "../../lib/api";
import type { SharedMaterial } from "./materialShare";
import { clock } from "../../lib/format";
import { notifyDataChanged, useActiveSession } from "../../lib/session";
import { maxScore, parseDefinition } from "../../lib/tests";
import { EditorContent, Toolbar, useNotesEditor } from "../NotesEditor";
import { HomeworkDialog } from "./Homework";
import { Button, Card, cx, Empty, Modal } from "../ui";
import { CATEGORY_LABEL, CategoryIcon } from "../category";
import type { CallApi } from "./useCall";
import AssistantChat from "../AssistantChat";

export default function SessionPanel({ call, patient, shared, onClearShared, materials, onOpenBoard, onOpenSettings }: {
  call: CallApi;
  patient: Patient | null;
  shared: SharedMaterial | null;
  onClearShared: () => void;
  /** Materyal kütüphanesi (seans araçlarının bir sekmesi). */
  materials: React.ReactNode;
  onOpenBoard: () => void;
  onOpenSettings: () => void;
}) {
  const [view, setView] = useState<"session" | "assistant">("session");
  // Önizleme yalnızca danışana bir şey gösterilirken yer kaplar.
  const sharing = !!call.screen || !!shared;
  return (
    <div className="flex min-h-0 flex-col gap-2">
      <div className="flex shrink-0 gap-1 rounded-xl border border-line bg-panel p-1" role="tablist">
        {([["session", "Seans", null], ["assistant", "Asistan", Sparkles]] as const).map(([id, label, Icon]) => (
          <button
            key={id}
            role="tab"
            aria-selected={view === id}
            onClick={() => setView(id)}
            className={cx(
              "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] transition-colors",
              view === id ? "bg-accent-soft font-medium text-ink" : "text-muted hover:text-ink",
            )}
          >
            {Icon && <Icon size={14} className={view === id ? "text-accent" : ""} />}
            {label}
          </button>
        ))}
      </div>
      {/* İkisi de bağlı kalır: görünüm değişince not ve konuşma kaybolmaz. */}
      <div className={cx("min-h-0 flex-1 flex-col gap-2.5", view === "session" ? "flex" : "hidden")}>
        <LiveNotesEditor />
        {sharing && <PatientScreenPreview call={call} shared={shared} onClearShared={onClearShared} />}
        <QuickTools call={call} patient={patient} materials={materials} onOpenBoard={onOpenBoard} />
      </div>
      <div className={cx("min-h-0 flex-1 overflow-hidden rounded-xl border border-line bg-panel", view === "assistant" ? "block" : "hidden")}>
        <AssistantChat onOpenSettings={onOpenSettings} />
      </div>
    </div>
  );
}

// ───────────────────────────── Zamanlayıcı ─────────────────────────────

/** Seans süresi: görüntünün üstünde tek satırlık ince çubuk. */
export function SessionTimer({ patient, call }: { patient: Patient | null; call: CallApi }) {
  const a = useActiveSession();
  const [error, setError] = useState<string | null>(null);
  const pct = Math.min(100, (a.elapsed / a.targetSeconds) * 100);
  const over = a.elapsed > a.targetSeconds;
  // Son 5 dakikada terapisti seansı toparlaması için uyar.
  const remaining = a.targetSeconds - a.elapsed;
  const closing = !!a.session && remaining > 0 && remaining <= 300;

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
    <section className="shrink-0 overflow-hidden rounded-xl border border-line bg-panel">
      <div className="flex items-center gap-3 px-3 py-2">
        <Clock3 size={18} className="shrink-0 text-accent" />
        <span className="min-w-0 flex-1 truncate text-[13px] text-muted">
          {a.session ? `${a.session.session_number}. Seans • ${a.session.patient_name}` : "Seans başlamadı"}
        </span>
        {closing && (
          <span className="rounded-md border border-warn/40 bg-warn/10 px-2 py-0.5 text-xs text-warn">
            {Math.ceil(remaining / 60)} dk kaldı
          </span>
        )}
        <span className="text-lg font-semibold tabular-nums">
          <span className={over ? "text-warn" : ""}>{clock(a.elapsed)}</span>
          <span className="text-sm font-normal text-muted"> / {clock(a.targetSeconds)}</span>
        </span>
        {a.session ? (
          <div className="flex gap-1">
            <button
              onClick={a.running ? a.pause : a.resume}
              className="rounded-lg p-1.5 text-ink hover:bg-card"
              title={a.running ? "Duraklat" : "Devam et"}
            >
              {a.running ? <Pause size={16} /> : <Play size={16} />}
            </button>
            <button onClick={finish} className="rounded-lg p-1.5 text-danger hover:bg-card" title="Seansı bitir">
              <Square size={16} />
            </button>
          </div>
        ) : (
          <Button variant="subtle" className="px-2.5 py-1 text-xs" onClick={startInPerson} disabled={!patient} title="Görüntülü görüşme olmadan seans başlat">
            <Play size={13} /> Yüz yüze başlat
          </Button>
        )}
      </div>
      <div className="h-1 bg-card">
        <div className={cx("h-full transition-all", over ? "bg-warn" : "bg-accent")} style={{ width: `${pct}%` }} />
      </div>
      {error && <p className="px-3 py-1.5 text-xs text-danger">{error}</p>}
    </section>
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
    <Card title="Seans Notları" className="flex min-h-[170px] flex-1 flex-col">
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
  /** Danışan sayfası testi aldığını bildirdi mi; `false` = süre doldu, onay gelmedi. */
  delivered: boolean | null;
}

/** Danışan sayfası bu süre içinde "ulaştı" demezse terapist uyarılır. */
const DELIVERY_TIMEOUT_MS = 6000;

function QuickTools({ call, patient, materials, onOpenBoard }: {
  call: CallApi;
  patient: Patient | null;
  materials: React.ReactNode;
  onOpenBoard: () => void;
}) {
  const { session } = useActiveSession();
  const [tab, setTab] = useState<"tools" | "materials">("tools");
  const [picking, setPicking] = useState(false);
  const [givingHomework, setGivingHomework] = useState(false);
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
        if (!p || !("requestId" in m) || m.requestId !== p.requestId) return;
        if (m.type === "test_received") {
          setPending({ ...p, delivered: true });
          return;
        }
        if (m.type !== "test_answers") return;
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
    setPending({ requestId, test, patientId: patient.id, sessionId: session?.id ?? null, delivered: null });
    setLast(null);
    setPicking(false);
    setTimeout(() => {
      const p = pendingRef.current;
      if (p?.requestId === requestId && p.delivered === null) setPending({ ...p, delivered: false });
    }, DELIVERY_TIMEOUT_MS);
  };

  const withdraw = () => {
    if (pending) call.sendMessage({ type: "test_cancel", requestId: pending.requestId });
    setPending(null);
  };

  const homeworkSession = session && session.patient_id === patient?.id ? session.id : null;

  return (
    <section className="flex max-h-[42%] shrink-0 flex-col rounded-xl border border-line bg-panel">
      <div className="flex shrink-0 gap-0.5 border-b border-line px-2 pt-1.5">
        {([["tools", "Test ve Ödev"], ["materials", "Materyaller"]] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cx(
              "-mb-px border-b-2 px-2.5 py-2 text-[13px] transition-colors",
              tab === id ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
      {tab === "materials" ? materials : (
      <ul className="space-y-1.5">
        <li className="rounded-lg bg-card/70 px-3 py-2">
          <div className="flex items-center gap-3">
            <ClipboardCheck size={18} className={connected ? "text-accent" : "text-muted"} />
            <div className="min-w-0 flex-1 text-[13px]">
              Test gönder
              <div className="truncate text-xs text-faint">
                {pending
                  ? pending.delivered === null
                    ? `Gönderiliyor: ${pending.test.title}`
                    : pending.delivered
                      ? `Danışan dolduruyor: ${pending.test.title}`
                      : `Ulaşmadı: ${pending.test.title}`
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
          {pending?.delivered === false && (
            <p className="mt-2 text-xs text-warn">
              Test danışanın ekranına ulaşmadı. Danışanın sayfası eski bir sürüm olabilir: sayfayı yenileyip yeniden
              katılmasını isteyin, sonra testi tekrar gönderin.
            </p>
          )}
          {error && <p className="mt-2 text-xs text-danger">{error}</p>}
        </li>
        <li className="flex items-center gap-3 rounded-lg bg-card/70 px-3 py-2">
          <Pencil size={18} className={connected ? "text-accent" : "text-muted"} />
          <div className="min-w-0 flex-1 text-[13px]">
            Ortak çizim
            <div className="truncate text-xs text-faint">
              {connected ? "İkiniz de aynı tuvale çizersiniz" : "Görüşme bağlanınca kullanılabilir"}
            </div>
          </div>
          <Button variant="outline" className="px-3 py-1 text-xs" onClick={onOpenBoard} disabled={!connected}>
            Aç
          </Button>
        </li>
        <li className="flex items-center gap-3 rounded-lg bg-card/70 px-3 py-2">
          <FileSignature size={18} className={patient ? "text-accent" : "text-muted"} />
          <div className="min-w-0 flex-1 text-[13px]">
            Ödev ver
            <div className="truncate text-xs text-faint">
              {connected ? "Danışanın ekranına da gönderilir" : "Kaydedilir, görüşmede gönderilebilir"}
            </div>
          </div>
          <Button variant="outline" className="px-3 py-1 text-xs" onClick={() => setGivingHomework(true)} disabled={!patient}>
            Ver
          </Button>
        </li>
      </ul>
      )}
      </div>
      {picking && <TestPicker onClose={() => setPicking(false)} onSend={send} />}
      {givingHomework && patient && (
        <HomeworkDialog patient={patient} sessionId={homeworkSession} call={call} onClose={() => setGivingHomework(false)} />
      )}
    </section>
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

const MEDIA_LABEL = {
  unstarted: "başlatılmadı",
  playing: "oynatılıyor",
  paused: "duraklatıldı",
  buffering: "yükleniyor",
  ended: "bitti",
} as const;

const SHARE_STATUS: Record<SharedMaterial["status"], string> = {
  sending: "Gönderiliyor",
  sent: "Gönderildi, danışanın onayı bekleniyor",
  shown: "Danışanın ekranında",
  failed: "Gönderilemedi",
  video: "Danışana yayınlanıyor",
};

function PatientScreenPreview({ call, shared, onClearShared }: { call: CallApi; shared: SharedMaterial | null; onClearShared: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const live = call.screen ?? (shared?.status === "video" ? call.videoShare?.stream ?? null : null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = live;
  }, [live]);

  return (
    <Card title="Danışanın gördüğü" className="shrink-0">
      <div className="relative aspect-video overflow-hidden rounded-lg border border-line bg-bg">
        {live ? (
          <video ref={ref} autoPlay muted playsInline className="h-full w-full object-contain" />
        ) : shared?.previewUrl ? (
          <img src={shared.previewUrl} alt={shared.material.title} className="h-full w-full object-contain" />
        ) : shared?.text ? (
          <div className="flex h-full items-center justify-center overflow-y-auto p-4 text-center text-sm italic leading-relaxed">“{shared.text}”</div>
        ) : shared ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
            <span className="text-accent"><CategoryIcon c={shared.material.category} size={34} /></span>
            <div className="text-sm">{shared.material.title}</div>
            <div className="text-xs text-muted">{CATEGORY_LABEL[shared.material.category]}</div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-faint">Danışanla paylaşılan bir şey yok</div>
        )}
        {shared && !call.screen && (
          <div className="absolute left-2 top-2 rounded-md bg-black/60 px-2 py-1 text-[11px] text-white">
            {shared.media
              ? `Danışanda: ${MEDIA_LABEL[shared.media.state]} • ${clock(shared.media.time)}${shared.media.duration ? ` / ${clock(shared.media.duration)}` : ""}`
              : SHARE_STATUS[shared.status]}
            {shared.status === "sending" && ` • %${Math.round(shared.progress * 100)}`}
          </div>
        )}
        {shared?.status === "sending" && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-card">
            <div className="h-full bg-accent transition-all" style={{ width: `${shared.progress * 100}%` }} />
          </div>
        )}
        {shared?.media && shared.shareId && !call.screen && (
          <button
            onClick={() =>
              call.sendMessage({ type: "media_control", id: shared.shareId!, action: shared.media!.state === "playing" ? "pause" : "play" })
            }
            className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-lg bg-card px-3 py-1.5 text-xs font-medium hover:bg-line"
            title="Danışanın ekranındaki videoyu kumanda eder"
          >
            {shared.media.state === "playing" ? <><Pause size={14} /> Duraklat</> : <><Play size={14} /> Oynat</>}
          </button>
        )}
        {shared?.status === "video" && call.videoShare && !call.screen && (
          <button
            onClick={() => (call.videoPaused ? call.videoShare!.el.play() : call.videoShare!.el.pause())}
            className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-lg bg-card px-3 py-1.5 text-xs font-medium hover:bg-line"
          >
            {call.videoPaused ? <><Play size={14} /> Oynat</> : <><Pause size={14} /> Duraklat</>}
          </button>
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
