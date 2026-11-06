import { useCallback, useEffect, useState } from "react";
import { CalendarCheck2, ChevronDown, ChevronRight, ClipboardList, PencilLine, UserPlus, Users } from "lucide-react";
import { CATEGORY_LABEL, CategoryIcon } from "../components/category";
import { api, type Material, type Note, type Patient, type Session, type TestResult } from "../lib/api";
import { age, fmtDate, fmtDateTime, initials, minutes, plainText } from "../lib/format";
import { useDataVersion } from "../lib/session";
import { maxScore, parseAnswers, parseDefinition } from "../lib/tests";
import { Avatar, Badge, Button, Card, cx, Empty, LinkButton, Modal } from "../components/ui";
import PatientForm from "../components/PatientForm";
import { NoteViewer } from "../components/NotesEditor";
import CallPanel from "../components/workspace/CallPanel";
import SessionPanel from "../components/workspace/SessionPanel";
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
  const [materials, setMaterials] = useState<Material[]>([]);
  const [shared, setShared] = useState<Material | null>(null);
  const call = useCall();

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
    const [p, s, n, r] = await Promise.all([
      api.getPatient(patientId),
      api.listSessions(patientId),
      api.listNotes(patientId),
      api.listTestResults(patientId),
    ]);
    setPatient(p);
    setSessions(s);
    setNotes(n);
    setResults(r);
  }, [patientId]);

  useEffect(() => {
    loadPatient().catch(() => setPatient(null));
  }, [loadPatient, version]);

  const showMaterial = (m: Material) => {
    setShared(m);
    call.sendMessage({ type: "material", title: m.title, category: m.category });
  };

  if (patients.length === 0) {
    return <FirstRun onNavigate={onNavigate} onCreated={onSelectPatient} />;
  }

  return (
    <div className="grid h-full grid-cols-[minmax(300px,330px)_minmax(0,1fr)_minmax(330px,370px)] gap-3 p-3">
      {/* Sol panel — danışan */}
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-0.5">
        <PatientProfileCard
          patient={patient}
          patients={patients}
          onSelect={onSelectPatient}
          locked={call.inCall}
          onChanged={loadPatient}
        />
        <SessionHistory sessions={sessions} onAll={() => onNavigate("sessions")} />
        <PrivateNotesHistory notes={notes} />
        <TestResults results={results} />
        <MaterialLibrary materials={materials} onShow={showMaterial} onAll={() => onNavigate("materials")} />
      </div>

      {/* Orta panel — görüntülü görüşme */}
      <CallPanel call={call} patient={patient} />

      {/* Sağ panel — seans */}
      <SessionPanel call={call} patient={patient} shared={shared} onClearShared={() => setShared(null)} />
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
  if (!patient) return <Card title="Danışan Profili"><Empty text="Danışan seçin" /></Card>;
  const a = age(patient.birth_date);
  return (
    <Card
      title="Danışan Profili"
      action={
        <button onClick={() => setEditing(true)} className="rounded-md p-1 text-muted hover:bg-card hover:text-ink" title="Düzenle">
          <PencilLine size={17} />
        </button>
      }
    >
      <div className="relative">
        <button
          disabled={locked}
          onClick={() => setPicker(!picker)}
          className="flex w-full items-center gap-4 rounded-lg p-1 text-left hover:bg-card disabled:hover:bg-transparent"
          title={locked ? "Görüşme sürerken danışan değiştirilemez" : "Danışan değiştir"}
        >
          <Avatar text={initials(patient.full_name)} size={64} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-lg font-medium">{patient.full_name}</div>
            <div className="text-sm text-muted">
              {a !== null ? `${a} yaş • ${fmtDate(patient.birth_date)}` : "Doğum tarihi yok"}
            </div>
          </div>
          {!locked && <ChevronDown size={16} className="text-faint" />}
        </button>
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

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <Stat label="Toplam Seans" value={String(patient.completed_sessions)} />
        <Stat label="Son Seans" value={fmtDate(patient.last_session_date)} />
        <Stat label="Kayıt Tarihi" value={fmtDate(patient.created_at, true)} />
        <Stat label="Sonraki Randevu" value={patient.next_appointment ? fmtDateTime(patient.next_appointment) : "—"} />
      </dl>
      <div className="mt-4">
        {patient.status === "active" ? (
          <Badge><span className="h-2 w-2 rounded-full bg-ok" /> Aktif Danışan</Badge>
        ) : (
          <Badge tone="muted">Pasif Danışan</Badge>
        )}
      </div>
      {editing && <PatientForm patient={patient} onClose={() => setEditing(false)} onSaved={onChanged} />}
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[13px] text-muted">{label}</dt>
      <dd className="mt-0.5 text-ink">{value}</dd>
    </div>
  );
}

// ───────────────────────────── Seans geçmişi ─────────────────────────────

function SessionHistory({ sessions, onAll }: { sessions: Session[]; onAll: () => void }) {
  const done = sessions.filter((s) => s.status === "completed");
  return (
    <Card title="Seans Geçmişi" action={<LinkButton onClick={onAll}>Tümünü Gör <ChevronRight size={14} /></LinkButton>}>
      {done.length === 0 ? (
        <Empty text="Henüz tamamlanmış seans yok." />
      ) : (
        <ul className="space-y-1">
          {done.slice(0, 4).map((s, i) => (
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

function PrivateNotesHistory({ notes }: { notes: Note[] }) {
  const [open, setOpen] = useState<Note | null>(null);
  const [all, setAll] = useState(false);
  const list = all ? notes : notes.slice(0, 3);
  return (
    <Card
      title="Notlar"
      action={notes.length > 3 && <LinkButton onClick={() => setAll(!all)}>{all ? "Daralt" : "Tümünü Gör"} <ChevronRight size={14} /></LinkButton>}
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

function TestResults({ results }: { results: TestResult[] }) {
  const [open, setOpen] = useState<TestResult | null>(null);
  const [all, setAll] = useState(false);
  const list = all ? results : results.slice(0, 3);
  return (
    <Card
      title="Test Sonuçları"
      action={results.length > 3 && <LinkButton onClick={() => setAll(!all)}>{all ? "Daralt" : "Tümünü Gör"} <ChevronRight size={14} /></LinkButton>}
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

function MaterialLibrary({ materials, onShow, onAll }: { materials: Material[]; onShow: (m: Material) => void; onAll: () => void }) {
  const [tab, setTab] = useState<"all" | "video" | "document">("all");
  const list = materials.filter((m) => tab === "all" || (tab === "video" ? m.category === "video" : m.category !== "video"));
  return (
    <Card title="Materyal Kütüphanesi" action={<LinkButton onClick={onAll}>Yönet <ChevronRight size={14} /></LinkButton>}>
      <div className="mb-3 flex gap-1 border-b border-line">
        {([["all", "Tümü"], ["video", "Videolar"], ["document", "Dokümanlar"]] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cx(
              "-mb-px border-b-2 px-3 py-1.5 text-[13px]",
              tab === id ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {list.length === 0 ? (
        <Empty text="Materyal yok." />
      ) : (
        <ul className="space-y-2">
          {list.slice(0, 3).map((m) => (
            <li key={m.id} className="flex items-center gap-3 rounded-lg bg-card p-2.5">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">
                <CategoryIcon c={m.category} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">{m.title}</div>
                <div className="text-xs text-muted">{CATEGORY_LABEL[m.category]}</div>
              </div>
              <Button variant="outline" className="px-3 py-1 text-xs" onClick={() => onShow(m)}>Göster</Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
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
