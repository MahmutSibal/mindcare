import { useCallback, useEffect, useRef, useState } from "react";
import {
  CalendarCheck2, ChevronDown, ChevronRight, ClipboardList, FileCheck2, Pencil, PencilLine, Phone, ShieldAlert, UserPlus, Users,
} from "lucide-react";
import { CATEGORY_LABEL, CategoryIcon } from "../components/category";
import { api, type DrawingMeta, type Homework, type Material, type Note, type Patient, type PatientFileMeta, type Session, type Substance, type TestResult } from "../lib/api";
import ClinicalTab from "../components/workspace/ClinicalTab";
import { PatientFiles, ReceivedFilesToast, useIncomingFiles } from "../components/workspace/patientFiles";
import { BoardPanel, BoardStartDialog, DrawingsList } from "../components/workspace/BoardPanel";
import { useBoard } from "../lib/useBoard";
import { age, fmtDate, fmtDateTime, initials, minutes, plainText } from "../lib/format";
import { notifyDataChanged, useActiveSession, useDataVersion } from "../lib/session";
import { HomeworkCard, useHomeworkDeliveryReceipts } from "../components/workspace/Homework";
import { hideMaterial, showMaterial as shareMaterial, type SharedMaterial } from "../components/workspace/materialShare";
import { errorText } from "../lib/api";
import { maxScore, parseAnswers, parseDefinition } from "../lib/tests";
import { Avatar, Button, Card, cx, Empty, LinkButton, Modal } from "../components/ui";
import PatientForm from "../components/PatientForm";
import { NoteViewer } from "../components/NotesEditor";
import CallPanel from "../components/workspace/CallPanel";
import SessionPanel, { SessionTimer } from "../components/workspace/SessionPanel";
import { useCall } from "../components/workspace/useCall";
import type { Page } from "../App";

export default function Workspace({ patientId, onSelectPatient, onNavigate }: {
  patientId: string | null;
  onSelectPatient: (id: string | null) => void;
  onNavigate: (p: Page) => void;
}) {
  const version = useDataVersion();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [results, setResults] = useState<TestResult[]>([]);
  const [homework, setHomework] = useState<Homework[]>([]);
  const [substances, setSubstances] = useState<Substance[]>([]);
  const [drawings, setDrawings] = useState<DrawingMeta[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [shared, setShared] = useState<SharedMaterial | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const call = useCall();
  const { session } = useActiveSession();
  const sessionRef = useRef(session);
  sessionRef.current = session;
  useHomeworkDeliveryReceipts(call);
  const [files, setFiles] = useState<PatientFileMeta[]>([]);
  const [tabRequest, setTabRequest] = useState<{ tab: HistoryTab; n: number } | null>(null);
  // Danışanın gönderdiği dosyalar, görüşmenin ait olduğu danışanın dosyasına kaydedilir.
  const incoming = useIncomingFiles(call, () =>
    sessionRef.current ? { patientId: sessionRef.current.patient_id, sessionId: sessionRef.current.id } : null,
  );

  // Ortak çizim: terapist başlatır; gösterilen görsel arka plan olabilir.
  const boardApi = useBoard("host", call.sendMessage, call.state === "connected");
  const [boardStarting, setBoardStarting] = useState(false);
  const [boardBackdrop, setBoardBackdrop] = useState<string | null>(null);
  const { onMessage: onCallMessage } = call;
  useEffect(() => onCallMessage((m) => void boardApi.handle(m)), [onCallMessage, boardApi.handle]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!call.inCall && boardApi.session) boardApi.close();
  }, [call.inCall]); // eslint-disable-line react-hooks/exhaustive-deps

  // Danışan materyali eksiksiz aldığında onay gönderir.
  const { onMessage } = call;
  useEffect(
    () =>
      onMessage((m) => {
        if (m.type === "material_received") {
          setShared((s) => (s && s.shareId === m.id ? { ...s, status: "shown" } : s));
        }
        if (m.type === "media_state") {
          setShared((s) =>
            s && s.shareId === m.id ? { ...s, status: "shown", media: { state: m.state, time: m.time, duration: m.duration } } : s,
          );
        }
        // Danışan katılırken onam verdi: görüşmenin ait olduğu danışanın dosyasına işlenir.
        if (m.type === "consent" && sessionRef.current) {
          api.recordPatientConsent(sessionRef.current.patient_id).then(notifyDataChanged).catch(() => {});
        }
      }),
    [onMessage],
  );

  // Görüşme bitince gösterim de biter; video yayını başka yoldan durursa (ör. ekran paylaşımı) kart temizlenir.
  useEffect(() => {
    if (!call.inCall) setShared(null);
  }, [call.inCall]);
  useEffect(() => {
    if (!call.videoShare) setShared((s) => (s?.status === "video" ? null : s));
  }, [call.videoShare]);

  useEffect(() => {
    api.listPatients().then((list) => {
      setPatients(list);
      if (!patientId && list.length) onSelectPatient(list.find((p) => p.status === "active")?.id ?? list[0]!.id);
    });
    api.listMaterials().then(setMaterials);
  }, [version]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadPatient = useCallback(async () => {
    if (!patientId) {
      setPatient(null);
      return;
    }
    const [p, s, n, r, h, sub, dr, fl] = await Promise.all([
      api.getPatient(patientId),
      api.listSessions(patientId),
      api.listNotes(patientId),
      api.listTestResults(patientId),
      api.listHomework(patientId),
      api.listSubstances(patientId),
      api.listDrawings(patientId),
      api.listPatientFiles(patientId),
    ]);
    setPatient(p);
    setSessions(s);
    setNotes(n);
    setResults(r);
    setHomework(h);
    setSubstances(sub);
    setDrawings(dr);
    setFiles(fl);
  }, [patientId]);

  useEffect(() => {
    loadPatient().catch(() => setPatient(null));
  }, [loadPatient, version]);

  // Yalnızca en son başlatılan gösterim durumu güncelleyebilir; durdurulan veya yerine
  // yenisi gelen bir aktarımın geç gelen güncellemeleri yok sayılır.
  const activeShare = useRef<object | null>(null);

  const showMaterial = async (m: Material, bytes?: Uint8Array<ArrayBuffer>): Promise<SharedMaterial | null> => {
    setShareError(null);
    if (shared) hideMaterial(call, shared);
    setShared(null);
    const token = {};
    activeShare.current = token;
    let last: SharedMaterial | null = null;
    try {
      await shareMaterial(call, m, (s) => {
        last = s;
        if (activeShare.current === token) setShared(s);
      }, bytes);
      return last;
    } catch (e) {
      if (activeShare.current !== token) return null;
      setShared(null);
      setShareError(errorText(e));
      return null;
    }
  };

  /** Görseli danışana gösterir, sonra üzerine ortak çizim açar. */
  const drawOnMaterial = async (m: Material, bytes?: Uint8Array<ArrayBuffer>) => {
    const s = await showMaterial(m, bytes);
    if (!s?.shareId || !s.previewUrl) return;
    setBoardBackdrop(s.previewUrl);
    boardApi.open(null, s.shareId);
  };

  /** Danışanın gönderdiği görseli ekrana getirir ve üzerine ortak çizim açar. */
  const drawOnFile = async (f: PatientFileMeta) => {
    try {
      const bytes = new Uint8Array(await api.getPatientFile(f.id));
      await drawOnMaterial({ id: `file:${f.id}`, title: f.name, category: "image", file_path: f.name, description: null, created_at: f.created_at }, bytes);
    } catch (e) {
      setShareError(errorText(e));
    }
  };

  const clearShared = () => {
    activeShare.current = null;
    if (shared) hideMaterial(call, shared);
    setShared(null);
  };

  if (patients.length === 0) {
    return <FirstRun onNavigate={onNavigate} onCreated={onSelectPatient} />;
  }

  const historyTabs: { id: HistoryTab; label: string; count: number; body: React.ReactNode }[] = [
    {
      id: "clinical",
      label: "Klinik",
      count: substances.filter((s) => s.active).length,
      body: <ClinicalTab patient={patient} substances={substances} />,
    },
    { id: "notes", label: "Notlar", count: notes.length, body: <PrivateNotesHistory notes={notes} inTab /> },
    {
      id: "tests",
      label: "Çalışmalar",
      count: results.length + drawings.length + files.length,
      body: (
        <>
          <TestResults results={results} inTab />
          <DrawingsList drawings={drawings} />
          <PatientFiles files={files} onDraw={call.state === "connected" ? (f) => void drawOnFile(f) : undefined} />
        </>
      ),
    },
    {
      id: "homework",
      label: "Ödevler",
      count: homework.length,
      body: (
        <HomeworkCard
          patient={patient}
          homework={homework}
          call={call}
          sessionId={session && session.patient_id === patient?.id ? session.id : null}
          inTab
        />
      ),
    },
    { id: "sessions", label: "Seanslar", count: sessions.filter((s) => s.status === "completed").length, body: <SessionHistory sessions={sessions} onAll={() => onNavigate("sessions")} inTab /> },
  ];

  return (
    <div className="grid h-full grid-cols-[minmax(270px,310px)_minmax(0,1fr)_minmax(290px,330px)] gap-2.5 p-2.5">
      {/* Sol panel — danışan ve geçmişi */}
      <div className="flex min-h-0 flex-col gap-2.5">
        <PatientProfileCard
          patient={patient}
          patients={patients}
          onSelect={onSelectPatient}
          locked={call.inCall}
          onChanged={loadPatient}
        />
        <TabbedCard tabs={historyTabs} request={tabRequest} />
      </div>

      {/* Orta panel — seans süresi ve görüntülü görüşme */}
      <div className="flex min-h-0 flex-col gap-2.5">
        <ReceivedFilesToast
          files={incoming.received}
          onOpen={() => {
            setTabRequest({ tab: "tests", n: Date.now() });
            incoming.dismiss();
          }}
          onDismiss={incoming.dismiss}
        />
        <SessionTimer patient={patient} call={call} />
        <CallPanel call={call} patient={patient} />
      </div>

      {/* Sağ panel — canlı notlar ve seans araçları */}
      <SessionPanel
        call={call}
        patient={patient}
        shared={shared}
        onClearShared={clearShared}
        materials={
          <MaterialLibrary
            materials={materials}
            onShow={(m) => void showMaterial(m)}
            onDraw={(m) => void drawOnMaterial(m)}
            onAll={() => onNavigate("materials")}
            connected={call.state === "connected"}
            error={shareError}
          />
        }
        onOpenBoard={() => setBoardStarting(true)}
      />

      {boardStarting && (
        <BoardStartDialog
          onClose={() => setBoardStarting(false)}
          onStart={(prompt) => {
            setBoardStarting(false);
            setBoardBackdrop(null);
            boardApi.open(prompt);
          }}
        />
      )}
      {boardApi.session && (
        <BoardPanel
          key={boardApi.session.id}
          boardApi={boardApi}
          patient={patient}
          sessionId={session && session.patient_id === patient?.id ? session.id : null}
          remote={call.remote}
          backdropUrl={boardBackdrop}
        />
      )}
    </div>
  );
}

// ───────────────────────────── Profil kartı ─────────────────────────────

function PatientProfileCard({ patient, patients, onSelect, locked, onChanged }: {
  patient: Patient | null;
  patients: Patient[];
  onSelect: (id: string) => void;
  locked: boolean;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [picker, setPicker] = useState(false);
  if (!patient) return <Card title="Danışan"><Empty text="Danışan seçin" /></Card>;
  const a = age(patient.birth_date);
  return (
    <Card className="shrink-0">
      <div className="relative">
        <div className="flex items-center gap-1">
          <button
            disabled={locked}
            onClick={() => setPicker(!picker)}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-lg p-1 text-left hover:bg-card disabled:hover:bg-transparent"
            title={locked ? "Görüşme sürerken danışan değiştirilemez" : "Danışan değiştir"}
          >
            <Avatar text={initials(patient.full_name)} size={44} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium">{patient.full_name}</span>
                <span className={cx("h-2 w-2 shrink-0 rounded-full", patient.status === "active" ? "bg-ok" : "bg-faint")} title={patient.status === "active" ? "Aktif danışan" : "Pasif danışan"} />
              </div>
              <div className="text-xs text-muted">
                {a !== null ? `${a} yaş • ${fmtDate(patient.birth_date)}` : "Doğum tarihi yok"}
              </div>
            </div>
            {!locked && <ChevronDown size={16} className="shrink-0 text-faint" />}
          </button>
          <button onClick={() => setEditing(true)} className="shrink-0 rounded-md p-1.5 text-muted hover:bg-card hover:text-ink" title="Düzenle">
            <PencilLine size={16} />
          </button>
        </div>
        {picker && (
          <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-lg border border-line bg-card p-1 shadow-xl">
            {patients.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  onSelect(p.id);
                  setPicker(false);
                }}
                className={cx(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-line",
                  p.id === patient.id && "text-accent",
                )}
              >
                <Avatar text={initials(p.full_name)} size={26} />
                <span className="truncate">{p.full_name}</span>
                {p.status === "passive" && <span className="ml-auto text-xs text-faint">pasif</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {patient.risk_note && (
        <p className="mt-3 flex items-start gap-2 rounded-lg border border-warn/40 bg-warn/10 px-2.5 py-2 text-xs leading-relaxed text-warn" title="Risk notu (danışana gösterilmez)">
          <ShieldAlert size={14} className="mt-0.5 shrink-0" /> <span className="whitespace-pre-wrap">{patient.risk_note}</span>
        </p>
      )}
      <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
        <Stat label="Seans" value={String(patient.completed_sessions)} />
        <Stat label="Son seans" value={fmtDate(patient.last_session_date)} />
        <Stat label="Sonraki" value={patient.next_appointment ? fmtDate(patient.next_appointment) : "—"} />
      </dl>
      <div className="mt-2 space-y-1 text-xs text-muted">
        <p className="flex items-center gap-1.5">
          <Phone size={12} className="shrink-0 text-faint" />
          {patient.emergency_contact || patient.emergency_phone ? (
            <span className="select-text truncate">Acil: {[patient.emergency_contact, patient.emergency_phone].filter(Boolean).join(" • ")}</span>
          ) : (
            <button onClick={() => setEditing(true)} className="text-warn hover:underline">Acil durum kişisi eklenmemiş</button>
          )}
        </p>
        <p className="flex items-center gap-1.5">
          <FileCheck2 size={12} className={cx("shrink-0", patient.consent_at ? "text-ok" : "text-faint")} />
          {patient.consent_at ? `Çevrim içi görüşme onamı: ${fmtDate(patient.consent_at, true)}` : "Çevrim içi görüşme onamı henüz yok"}
        </p>
      </div>
      {editing && <PatientForm patient={patient} onClose={() => setEditing(false)} onSaved={onChanged} />}
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-card/60 px-2 py-1.5">
      <dt className="text-[11px] text-faint">{label}</dt>
      <dd className="truncate text-[13px] text-ink">{value}</dd>
    </div>
  );
}

// ───────────────────────────── Seans geçmişi ─────────────────────────────

function SessionHistory({ sessions, onAll, inTab }: { sessions: Session[]; onAll: () => void; inTab?: boolean }) {
  const done = sessions.filter((s) => s.status === "completed");
  return (
    <Card bare={inTab} title="Seans Geçmişi" action={<LinkButton onClick={onAll}>Tümünü Gör <ChevronRight size={14} /></LinkButton>}>
      {done.length === 0 ? (
        <Empty text="Henüz tamamlanmış seans yok." />
      ) : (
        <ul className="space-y-1">
          {(inTab ? done : done.slice(0, 4)).map((s, i) => (
            <li key={s.id} className="grid grid-cols-[20px_1fr_1fr_auto] items-center gap-2 rounded-md px-1 py-1.5 text-[13px]">
              <CalendarCheck2 size={15} className="text-accent" />
              <span className={i === 0 ? "text-accent" : "text-muted"}>{fmtDate(s.session_date)}</span>
              <span className={i === 0 ? "text-accent" : "text-muted"}>{s.session_number}. Seans</span>
              <span className="text-muted">{minutes(s.duration_seconds)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ───────────────────────────── Notlar ─────────────────────────────

function PrivateNotesHistory({ notes, inTab }: { notes: Note[]; inTab?: boolean }) {
  const [open, setOpen] = useState<Note | null>(null);
  const [all, setAll] = useState(false);
  const list = all || inTab ? notes : notes.slice(0, 3);
  return (
    <Card
      bare={inTab}
      title="Notlar"
      action={!inTab && notes.length > 3 && <LinkButton onClick={() => setAll(!all)}>{all ? "Daralt" : "Tümünü Gör"} <ChevronRight size={14} /></LinkButton>}
    >
      {notes.length === 0 ? (
        <Empty text="Kayıtlı klinik not yok." />
      ) : (
        <ul className="space-y-2">
          {list.map((n) => (
            <li key={n.id}>
              <button
                onClick={() => setOpen(n)}
                className="w-full truncate border-l-2 border-accent pl-3 text-left text-[13px] text-ink/90 hover:text-accent"
              >
                {fmtDate(n.session_date)} – {plainText(n.note_content) || "(boş not)"}
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && (
        <Modal title={`${open.session_number}. Seans • ${fmtDate(open.session_date)}`} onClose={() => setOpen(null)} width="max-w-2xl">
          <NoteViewer html={open.note_content} />
          <p className="mt-4 text-xs text-faint">
            Son güncelleme: {fmtDateTime(open.updated_at ?? open.created_at, true)}
          </p>
        </Modal>
      )}
    </Card>
  );
}

// ───────────────────────────── Test sonuçları ─────────────────────────────

function TestResults({ results, inTab }: { results: TestResult[]; inTab?: boolean }) {
  const [open, setOpen] = useState<TestResult | null>(null);
  const [all, setAll] = useState(false);
  const list = all || inTab ? results : results.slice(0, 3);
  return (
    <Card
      bare={inTab}
      title="Test Sonuçları"
      action={!inTab && results.length > 3 && <LinkButton onClick={() => setAll(!all)}>{all ? "Daralt" : "Tümünü Gör"} <ChevronRight size={14} /></LinkButton>}
    >
      {results.length === 0 ? (
        <Empty text="Henüz test sonucu yok." />
      ) : (
        <ul className="space-y-1">
          {list.map((r) => {
            const max = maxScore(parseDefinition(r.definition_json));
            return (
              <li key={r.id}>
                <button
                  onClick={() => setOpen(r)}
                  className="grid w-full grid-cols-[18px_1fr_auto] items-center gap-2 rounded-md px-1 py-1.5 text-left text-[13px] hover:bg-card"
                >
                  <ClipboardList size={15} className="text-accent" />
                  <span className="truncate">
                    {r.test_title} <span className="text-faint">• {fmtDate(r.completed_at, true)}</span>
                  </span>
                  {r.total_score !== null && (
                    <span className="font-medium tabular-nums">{r.total_score}{max !== null && <span className="text-faint">/{max}</span>}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {open && <TestResultView result={open} onClose={() => setOpen(null)} />}
    </Card>
  );
}

function TestResultView({ result, onClose }: { result: TestResult; onClose: () => void }) {
  const def = parseDefinition(result.definition_json);
  const answers = parseAnswers(result.answers_json);
  const max = maxScore(def);
  return (
    <Modal title={result.test_title} onClose={onClose} width="max-w-2xl">
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
        <span>{fmtDateTime(result.completed_at, true)}</span>
        {result.session_number !== null && <span>{result.session_number}. Seans</span>}
        {result.total_score !== null && (
          <span className="ml-auto text-base font-semibold text-ink">
            Toplam: {result.total_score}{max !== null && <span className="font-normal text-muted"> / {max}</span>}
          </span>
        )}
      </div>
      <ol className="space-y-2">
        {def.questions.map((q, i) => {
          const a = answers[q.id];
          const chosen = q.kind === "scale" && a?.option != null ? def.options[a.option] : undefined;
          return (
            <li key={q.id} className="rounded-lg bg-card/60 p-3 text-sm">
              <div className="text-muted">{i + 1}. {q.text}</div>
              <div className="mt-1 text-ink">
                {q.kind === "scale"
                  ? chosen ? <>{chosen.label} <span className="text-faint">({chosen.score})</span></> : <span className="text-faint">—</span>
                  : a?.text?.trim() ? <span className="whitespace-pre-wrap">{a.text}</span> : <span className="text-faint">Boş bırakıldı</span>}
              </div>
            </li>
          );
        })}
      </ol>
    </Modal>
  );
}

// ───────────────────────────── Materyaller ─────────────────────────────

function MaterialLibrary({ materials, onShow, onDraw, onAll, connected, error }: {
  materials: Material[];
  onShow: (m: Material) => void;
  /** Görselin üzerine ortak çizim açar. */
  onDraw: (m: Material) => void;
  onAll: () => void;
  connected: boolean;
  error: string | null;
}) {
  return (
    <Card bare action={<LinkButton onClick={onAll}>Kütüphaneyi yönet <ChevronRight size={14} /></LinkButton>}>
      {materials.length === 0 ? (
        <Empty text="Materyal yok. Materyaller sayfasından ekleyin." />
      ) : (
        <ul className="space-y-1.5">
          {materials.map((m) => (
            <li key={m.id} className="flex items-center gap-2.5 rounded-lg bg-card/70 p-2">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">
                <CategoryIcon c={m.category} size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">{m.title}</div>
                <div className="text-xs text-muted">{CATEGORY_LABEL[m.category]}</div>
              </div>
              <Button
                variant="outline"
                className="px-3 py-1 text-xs"
                onClick={() => onShow(m)}
                disabled={!connected}
                title={connected ? "Danışanın ekranında göster" : "Görüşme bağlanınca kullanılabilir"}
              >
                Göster
              </Button>
              {m.category === "image" && (
                <Button
                  variant="ghost"
                  className="px-2 py-1 text-xs"
                  onClick={() => onDraw(m)}
                  disabled={!connected}
                  title={connected ? "Görseli gösterip üzerine birlikte çizin" : "Görüşme bağlanınca kullanılabilir"}
                >
                  <Pencil size={13} /> Çiz
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </Card>
  );
}

// ───────────────────────────── Sekmeli kart ─────────────────────────────

type HistoryTab = "clinical" | "notes" | "tests" | "homework" | "sessions";

/** Danışan geçmişi tek kartta: sekmeler ve kaydırılabilir içerik; kalan yüksekliği doldurur. */
function TabbedCard({ tabs, request }: {
  tabs: { id: HistoryTab; label: string; count: number; body: React.ReactNode }[];
  /** Dışarıdan sekme açma isteği (her istek farklı `n` taşır). */
  request?: { tab: HistoryTab; n: number } | null;
}) {
  const [active, setActive] = useState<HistoryTab>(tabs[0]!.id);
  useEffect(() => {
    if (request) setActive(request.tab);
  }, [request]);
  const current = tabs.find((t) => t.id === active) ?? tabs[0]!;
  return (
    <section className="flex min-h-0 flex-1 flex-col rounded-xl border border-line bg-panel">
      <div className="flex shrink-0 border-b border-line px-1 pt-1.5">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setActive(t.id)}
            className={cx(
              "relative -mb-px flex min-w-0 flex-1 items-center justify-center border-b-2 px-1 pb-2 pt-3 text-[12px] transition-colors",
              t.id === active ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink",
            )}
          >
            <span className="truncate">{t.label}</span>
            {t.count > 0 && (
              <span className="absolute right-0 top-0.5 min-w-[15px] rounded-full bg-card px-1 text-center text-[9px] leading-[15px] text-muted">{t.count}</span>
            )}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">{current.body}</div>
    </section>
  );
}

// ───────────────────────────── İlk kullanım ─────────────────────────────

function FirstRun({ onNavigate, onCreated }: { onNavigate: (p: Page) => void; onCreated: (id: string) => void }) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="flex h-full items-center justify-center">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-accent-soft text-accent">
          <Users size={30} />
        </div>
        <h1 className="text-xl font-semibold">MindCare'e hoş geldiniz</h1>
        <p className="mt-2 text-sm text-muted">
          Danışan kayıtları, seans geçmişi ve klinik notlar yalnızca bu bilgisayarda, şifreli veritabanında tutulur.
          Başlamak için ilk danışanınızı ekleyin.
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <Button onClick={() => setAdding(true)}><UserPlus size={16} /> Danışan Ekle</Button>
          <Button variant="subtle" onClick={() => onNavigate("settings")}>Ayarlar</Button>
        </div>
      </div>
      {adding && <PatientForm onClose={() => setAdding(false)} onSaved={onCreated} />}
    </div>
  );
}
