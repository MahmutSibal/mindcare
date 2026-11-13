// Grup seansı ekranı: ana sayfayla aynı düzen. Solda üyeler, ödevler ve geçmiş; ortada görüntü;
// sağda zengin metin grup notu, üye notları ve ödev verme.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check, ChevronDown, ChevronRight, Clock3, Copy, FileSignature, Mic, MicOff, MonitorUp, PhoneOff, Plus, Sparkles, UsersRound, Video, VideoOff,
} from "lucide-react";
import {
  api, errorText, type DrawingMeta, type GroupMember, type GroupSession, type Homework, type Material, type PatientFileMeta,
  type TestResult, type TherapyGroup,
} from "../../lib/api";
import { useBoard } from "../../lib/useBoard";
import { clock, fmtDate, fmtDateTime, initials } from "../../lib/format";
import type { GroupPeer } from "../../lib/groupRtc";
import { notifyDataChanged, useDataVersion } from "../../lib/session";
import { Avatar, Badge, Button, Card, cx, Empty, inputCls, Modal } from "../ui";
import AssistantChat from "../AssistantChat";
import { BoardPanel, BoardStartDialog, DrawingsList } from "./BoardPanel";
import { PatientFiles, ReceivedFilesToast, useIncomingFiles } from "./patientFiles";
import { EditorContent, NoteViewer, Toolbar, useNotesEditor } from "../NotesEditor";
import { HOMEWORK_STATUS } from "./Homework";
import { GroupHomeworkDialog, GroupTools, sentHomework, useGroupCallAdapter, useGroupMaterial } from "./GroupExtras";
import type { GroupCallApi } from "./useGroupCall";

const TARGET_SECONDS = 50 * 60;

// ───────────────────────────── Görüntü kutusu ─────────────────────────────

function Tile({ stream, name, muted, mirrored, state, off }: {
  stream: MediaStream | null;
  name: string;
  muted?: boolean;
  mirrored?: boolean;
  state?: GroupPeer["state"];
  off?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream, off]);
  return (
    <div className="relative aspect-[4/3] overflow-hidden rounded-xl border border-line bg-bg">
      {stream && !off ? (
        <video ref={ref} autoPlay playsInline muted={muted} className={cx("h-full w-full object-cover", mirrored && "-scale-x-100")} />
      ) : (
        <div className="flex h-full items-center justify-center"><Avatar text={initials(name)} size={64} /></div>
      )}
      {/* Ses, kamera kapalıyken de duyulsun diye video öğesi her zaman bağlı kalır. */}
      {stream && off && <video ref={ref} autoPlay playsInline muted={muted} className="hidden" />}
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/70 to-transparent px-2.5 pb-1.5 pt-5 text-xs text-white">
        <span className="truncate">{name}</span>
        {state && state !== "connected" && (
          <span className="rounded bg-warn/80 px-1 text-[10px] text-black">{state === "connecting" ? "bağlanıyor" : "yeniden bağlanıyor"}</span>
        )}
      </div>
    </div>
  );
}

// ───────────────────────────── Zengin grup notu ─────────────────────────────

function GroupNotes({ session }: { session: GroupSession }) {
  const [state, setState] = useState<"idle" | "dirty" | "saving" | "error">("idle");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<string>(session.note ?? "");
  const dirty = useRef(false);

  const save = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    setState("saving");
    try {
      await api.saveGroupSessionNote(session.id, latest.current || null, false);
      dirty.current = false;
      setSavedAt(new Date());
      setState("idle");
      notifyDataChanged();
    } catch {
      setState("error");
    }
  }, [session.id]);

  const editor = useNotesEditor({
    content: session.note ?? "",
    editable: true,
    placeholder: "Grup seansının genel akışı, grup dinamiği, konular…",
    onChange: (html) => {
      latest.current = html;
      dirty.current = true;
      setState("dirty");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(save, 1500);
    },
  });

  // Ekrandan çıkarken bekleyen değişiklik kaydedilir.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (dirty.current) void api.saveGroupSessionNote(session.id, latest.current || null, false).then(notifyDataChanged).catch(() => {});
    },
    [session.id],
  );

  const status =
    state === "saving" ? "Kaydediliyor…"
    : state === "dirty" ? "Kaydedilmemiş değişiklik"
    : state === "error" ? "Kaydedilemedi!"
    : savedAt ? `Otomatik kaydedildi • ${savedAt.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}`
    : "";

  return (
    <Card title="Grup Seans Notları" className="flex min-h-[170px] flex-1 flex-col">
      <Toolbar editor={editor} />
      <div className="mt-2 min-h-0 flex-1 overflow-y-auto rounded-lg border border-line bg-bg/60 p-3" onClick={() => editor?.commands.focus()}>
        <EditorContent editor={editor} className="h-full" />
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className={cx("text-xs", state === "error" ? "text-danger" : "text-muted")}>{status}</span>
        <Button onClick={save} disabled={state === "saving"} className="py-1.5">Notu Kaydet</Button>
      </div>
    </Card>
  );
}

function MemberNotes({ session, members }: { session: GroupSession; members: GroupMember[] }) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    api.listGroupMemberNotes(session.id).then((l) => setNotes(Object.fromEntries(l.map((n) => [n.patient_id, n.note]))));
  }, [session.id]);

  return (
    <Card title="Üye notları" className="flex max-h-[22%] min-h-[80px] shrink-0 flex-col">
      <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto">
        {members.map((m) => (
          <li key={m.patient_id} className="rounded-lg bg-card/70">
            <button
              onClick={() => setOpen(open === m.patient_id ? null : m.patient_id)}
              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[13px]"
            >
              {open === m.patient_id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <span className="min-w-0 flex-1 truncate">{m.full_name}</span>
              {notes[m.patient_id] && <span className="h-1.5 w-1.5 rounded-full bg-accent" title="Not var" />}
            </button>
            {open === m.patient_id && (
              <textarea
                className={cx(inputCls, "mx-2.5 mb-2 min-h-[70px] w-[calc(100%-1.25rem)] resize-y text-sm")}
                placeholder="Bu üyeye özel gözlem"
                value={notes[m.patient_id] ?? ""}
                onChange={(e) => setNotes((n) => ({ ...n, [m.patient_id]: e.target.value }))}
                onBlur={(e) => void api.saveGroupMemberNote(session.id, m.patient_id, e.target.value).catch(() => {})}
                autoFocus
              />
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ───────────────────────────── Ödev ─────────────────────────────

function HomeworkTab({ members, call }: { members: GroupMember[]; call: GroupCallApi }) {
  const version = useDataVersion();
  const [byMember, setByMember] = useState<Record<string, Homework[]>>({});
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    Promise.all(members.map((m) => api.listHomework(m.patient_id).then((h) => [m.patient_id, h] as const)))
      .then((e) => setByMember(Object.fromEntries(e)))
      .catch(() => {});
  }, [members, version]);

  return (
    <div>
      <div className="mb-2 flex justify-end">
        <Button variant="outline" className="px-3 py-1 text-xs" onClick={() => setAdding(true)}>
          <Plus size={14} /> Gruba ödev ver
        </Button>
      </div>
      {members.every((m) => (byMember[m.patient_id] ?? []).length === 0) ? (
        <Empty text="Henüz ödev verilmedi." />
      ) : (
        <div className="space-y-3">
          {members.map((m) => {
            const list = byMember[m.patient_id] ?? [];
            if (list.length === 0) return null;
            return (
              <section key={m.patient_id}>
                <h4 className="mb-1 text-xs font-medium text-muted">{m.full_name}</h4>
                <ul className="space-y-0.5">
                  {list.slice(0, 5).map((h) => {
                    const s = HOMEWORK_STATUS[h.status];
                    return (
                      <li key={h.id} className="flex items-center gap-2 rounded-md px-1 py-1 text-[13px]">
                        <FileSignature size={14} className="shrink-0 text-accent" />
                        <span className="min-w-0 flex-1 truncate">{h.title}</span>
                        <span className="shrink-0 text-faint">{fmtDate(h.created_at, true)}</span>
                        <Badge tone={s.tone}>{s.label}</Badge>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}
      {adding && <GroupHomeworkDialog members={members} call={call} onClose={() => setAdding(false)} />}
    </div>
  );
}

// ───────────────────────────── Çalışmalar ─────────────────────────────

function WorkTab({ members, onDraw }: { members: GroupMember[]; onDraw?: (f: PatientFileMeta) => void }) {
  const version = useDataVersion();
  const [data, setData] = useState<Record<string, { results: TestResult[]; drawings: DrawingMeta[]; files: PatientFileMeta[] }>>({});

  useEffect(() => {
    Promise.all(
      members.map(async (m) => {
        const [results, drawings, files] = await Promise.all([
          api.listTestResults(m.patient_id), api.listDrawings(m.patient_id), api.listPatientFiles(m.patient_id),
        ]);
        return [m.patient_id, { results, drawings, files }] as const;
      }),
    )
      .then((e) => setData(Object.fromEntries(e)))
      .catch(() => {});
  }, [members, version]);

  const empty = members.every((m) => {
    const d = data[m.patient_id];
    return !d || d.results.length + d.drawings.length + d.files.length === 0;
  });
  if (empty) return <Empty text="Henüz test sonucu, çizim ya da dosya yok." />;
  return (
    <div className="space-y-4">
      {members.map((m) => {
        const d = data[m.patient_id];
        if (!d || d.results.length + d.drawings.length + d.files.length === 0) return null;
        return (
          <section key={m.patient_id}>
            <h4 className="mb-1 text-xs font-semibold text-muted">{m.full_name}</h4>
            {d.results.length > 0 && (
              <ul className="space-y-0.5">
                {d.results.slice(0, 5).map((r) => (
                  <li key={r.id} className="flex items-center gap-2 px-1 py-1 text-[13px]">
                    <span className="min-w-0 flex-1 truncate">{r.test_title}</span>
                    {r.total_score !== null && <Badge tone="accent">{r.total_score} puan</Badge>}
                    <span className="shrink-0 text-faint">{fmtDate(r.completed_at, true)}</span>
                  </li>
                ))}
              </ul>
            )}
            <DrawingsList drawings={d.drawings} />
            <PatientFiles files={d.files} onDraw={onDraw} />
          </section>
        );
      })}
    </div>
  );
}

// ───────────────────────────── Geçmiş ─────────────────────────────

function HistoryTab({ group, current }: { group: TherapyGroup; current: GroupSession | null }) {
  const version = useDataVersion();
  const [sessions, setSessions] = useState<GroupSession[]>([]);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    api.listGroupSessions(group.id).then((l) => setSessions(l.filter((s) => s.id !== current?.id && s.ended_at))).catch(() => {});
  }, [group.id, current?.id, version]);

  if (sessions.length === 0) return <Empty text="Tamamlanmış grup seansı yok." />;
  return (
    <ul className="space-y-1">
      {sessions.map((s) => (
        <li key={s.id} className="rounded-lg bg-card/70">
          <button onClick={() => setOpen(open === s.id ? null : s.id)} className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-[13px]">
            {open === s.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span className="flex-1">{s.session_number}. seans</span>
            <span className="text-xs text-faint">{fmtDateTime(s.started_at, true)}</span>
          </button>
          {open === s.id && (
            <div className="px-3 pb-3 text-sm">
              {s.note ? <NoteViewer html={s.note} /> : <p className="text-xs text-muted">Bu seans için not yazılmamış.</p>}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

// ───────────────────────────── Ekran ─────────────────────────────

function LeftTabs({ tabs, request }: { tabs: { id: string; label: string; body: React.ReactNode }[]; request?: { tab: string; n: number } | null }) {
  const [active, setActive] = useState(tabs[0]!.id);
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
              "-mb-px flex min-w-0 flex-1 items-center justify-center border-b-2 px-1 pb-2 pt-2 text-[12px] transition-colors",
              t.id === active ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink",
            )}
          >
            <span className="truncate">{t.label}</span>
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">{current.body}</div>
    </section>
  );
}

export function GroupSessionView({ group, call, onClose, onNavigate }: {
  group: TherapyGroup;
  call: GroupCallApi;
  onClose: () => void;
  onNavigate: (p: "materials" | "settings") => void;
}) {
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [session, setSession] = useState<GroupSession | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const memberIds = useRef(new Set<string>());
  memberIds.current = new Set(members.map((m) => m.patient_id));
  const version = useDataVersion();
  const [materials, setMaterials] = useState<Material[]>([]);
  const [rightView, setRightView] = useState<"session" | "assistant">("session");
  const [tabRequest, setTabRequest] = useState<{ tab: string; n: number } | null>(null);
  const adapter = useGroupCallAdapter(call);
  const material = useGroupMaterial(adapter);

  useEffect(() => {
    api.listMaterials().then(setMaterials).catch(() => {});
  }, [version]);

  // Ortak çizim: herkes için tek tuval; gösterilen görsel arka plan olabilir.
  const boardApi = useBoard("host", call.sendMessage, call.state === "connected");
  const [boardStarting, setBoardStarting] = useState(false);
  const [boardBackdrop, setBoardBackdrop] = useState<string | null>(null);
  useEffect(() => call.onMessage((m) => void boardApi.handle(m)), [call.onMessage, boardApi.handle]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!call.inCall && boardApi.session) boardApi.close();
  }, [call.inCall]); // eslint-disable-line react-hooks/exhaustive-deps

  const drawOnMaterial = async (m: Material, bytes?: Uint8Array<ArrayBuffer>) => {
    const s = await material.show(m, bytes);
    if (!s?.shareId || !s.previewUrl) return;
    setBoardBackdrop(s.previewUrl);
    boardApi.open(null, s.shareId);
  };

  /** Üyenin gönderdiği görseli gruba gösterip üzerine ortak çizim açar. */
  const drawOnFile = async (f: PatientFileMeta) => {
    try {
      const bytes = new Uint8Array(await api.getPatientFile(f.id));
      await drawOnMaterial({ id: `file:${f.id}`, title: f.name, category: "image", file_path: f.name, description: null, created_at: f.created_at }, bytes);
    } catch (e) {
      setError(errorText(e));
    }
  };

  // Üyelerin gönderdiği dosyalar, gönderen üyenin dosyasına kaydedilir.
  const incoming = useIncomingFiles({ onMessage: call.onMessage, sendMessage: call.sendMessage }, (from) => {
    const memberId = call.peers.find((p) => p.id === from)?.memberId;
    return memberId && memberIds.current.has(memberId) ? { patientId: memberId, sessionId: null } : null;
  });

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const m = await api.listGroupMembers(group.id);
        const s = await api.startGroupSession(group.id);
        if (!live) return;
        setMembers(m);
        setSession(s);
      } catch (e) {
        if (live) setError(errorText(e));
      }
    })();
    return () => {
      live = false;
    };
  }, [group.id]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Üyelerden gelen onam ve ödev "ulaştı" onayları.
  const { onMessage } = call;
  useEffect(
    () =>
      onMessage((m, from) => {
        if (m.type === "consent") {
          const peer = call.peers.find((p) => p.id === from);
          if (peer?.memberId && memberIds.current.has(peer.memberId)) {
            api.recordPatientConsent(peer.memberId).then(notifyDataChanged).catch(() => {});
          }
        }
        if (m.type === "homework_received" && sentHomework.has(m.id)) {
          sentHomework.delete(m.id);
          api.markHomeworkDelivered(m.id).then(notifyDataChanged).catch(() => {});
        }
      }),
    [onMessage, call.peers],
  );

  const begin = () => void call.start(members.map((m) => ({ id: m.patient_id, name: m.full_name })));

  const finish = async () => {
    if (!session) return;
    setSaving(true);
    try {
      // Bekleyen not değişikliği editör kapanırken kaydedilir; seans bitirilirken metni değiştirmeyiz.
      await call.hangup();
      await api.markGroupSessionFinished(session.id);
      onClose();
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
      setConfirmEnd(false);
    }
  };

  const copy = async (key: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 2000);
  };

  const statusOf = (id: string) => call.peers.find((p) => p.memberId === id);
  const connectedCount = call.peers.filter((p) => p.state === "connected").length;
  const elapsed = session ? Math.max(0, Math.floor((now - Date.parse(session.started_at.replace(" ", "T") + "Z")) / 1000)) : 0;
  const over = elapsed > TARGET_SECONDS;
  const pct = Math.min(100, (elapsed / TARGET_SECONDS) * 100);

  const membersTab = (
    <ul className="space-y-2">
      {members.map((m) => {
        const peer = statusOf(m.patient_id);
        const invite = call.invites.find((i) => i.memberId === m.patient_id);
        return (
          <li key={m.patient_id} className="rounded-lg border border-line bg-bg p-2">
            <div className="flex items-center gap-2 text-sm">
              <span className={cx("h-2 w-2 shrink-0 rounded-full", peer?.state === "connected" ? "bg-ok" : peer ? "bg-warn" : "bg-faint")} />
              <span className="min-w-0 flex-1 truncate">{m.full_name}</span>
              <span className="text-[11px] text-faint">{peer?.state === "connected" ? "bağlı" : peer ? "bağlanıyor" : "katılmadı"}</span>
            </div>
            {invite && (
              <Button variant="subtle" className="mt-1.5 w-full px-2 py-1 text-xs" onClick={() => void copy(m.patient_id, invite.link)}>
                {copied === m.patient_id ? <><Check size={13} /> Kopyalandı</> : <><Copy size={13} /> Davet bağlantısını kopyala</>}
              </Button>
            )}
          </li>
        );
      })}
      {call.invites.length > 0 && (
        <p className="text-[11px] leading-snug text-faint">Her bağlantı yalnızca o üyeye özeldir ve tek kullanımlıktır. Üyeye ayrı ayrı gönderin.</p>
      )}
    </ul>
  );

  return (
    <div className="grid h-full grid-cols-[minmax(270px,310px)_minmax(0,1fr)_minmax(300px,360px)] gap-2.5 p-2.5">
      {/* Sol: grup ve sekmeler */}
      <div className="flex min-h-0 flex-col gap-2.5">
        <Card className="shrink-0">
          <div className="flex items-center gap-3">
            <Avatar text={initials(group.name)} size={44} />
            <div className="min-w-0">
              <div className="truncate font-medium">{group.name}</div>
              <div className="text-xs text-muted">
                {session ? `${session.session_number}. grup seansı` : "Yükleniyor…"} • {members.length} üye
              </div>
            </div>
          </div>
          {!call.inCall && (
            <>
              <Button className="mt-3 w-full" onClick={begin} disabled={!session || members.length === 0}>
                <Video size={16} /> Görüşmeyi başlat ve davetleri oluştur
              </Button>
              <Button variant="ghost" className="mt-1 w-full text-xs" onClick={onClose}>Gruplara dön</Button>
            </>
          )}
          {call.error && <p className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{call.error}</p>}
          {error && <p className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
        </Card>
        <LeftTabs
          request={tabRequest}
          tabs={[
            { id: "members", label: "Üyeler", body: membersTab },
            { id: "work", label: "Çalışmalar", body: <WorkTab members={members} onDraw={call.state === "connected" ? (f) => void drawOnFile(f) : undefined} /> },
            { id: "homework", label: "Ödevler", body: <HomeworkTab members={members} call={call} /> },
            { id: "history", label: "Geçmiş", body: <HistoryTab group={group} current={session} /> },
          ]}
        />
      </div>

      {/* Orta: süre ve görüntü */}
      <div className="flex min-h-0 flex-col gap-2.5">
        <ReceivedFilesToast
          files={incoming.received}
          onOpen={() => {
            setTabRequest({ tab: "work", n: Date.now() });
            incoming.dismiss();
          }}
          onDismiss={incoming.dismiss}
        />
        <section className="shrink-0 overflow-hidden rounded-xl border border-line bg-panel">
          <div className="flex items-center gap-3 px-3 py-2">
            <Clock3 size={18} className="shrink-0 text-accent" />
            <span className="min-w-0 flex-1 truncate text-[13px] text-muted">
              {session ? `${session.session_number}. Grup seansı • ${group.name}` : "Yükleniyor…"}
            </span>
            <span className="text-lg font-semibold tabular-nums">
              <span className={over ? "text-warn" : ""}>{clock(elapsed)}</span>
              <span className="text-sm font-normal text-muted"> / {clock(TARGET_SECONDS)}</span>
            </span>
          </div>
          <div className="h-1 bg-card">
            <div className={cx("h-full transition-all", over ? "bg-warn" : "bg-accent")} style={{ width: `${pct}%` }} />
          </div>
        </section>

        <div className="flex min-h-0 flex-1 flex-col gap-2 rounded-xl border border-line bg-panel p-2.5">
          <div className="flex shrink-0 items-center justify-between text-xs text-muted">
            <span className="flex items-center gap-1.5"><UsersRound size={14} /> {connectedCount} / {members.length} katılımcı bağlı</span>
            {call.screen && <Badge tone="accent">Ekran paylaşılıyor</Badge>}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {call.inCall ? (
              <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-2">
                {call.peers.map((p) => <Tile key={p.id} stream={p.stream} name={p.name} state={p.state} />)}
                <Tile stream={call.local} name="Siz" muted mirrored off={!call.camOn} />
              </div>
            ) : (
              <div className="flex h-full items-center justify-center">
                <Empty icon={<UsersRound size={28} />} text="Görüşmeyi başlatınca üyeler için davet bağlantıları oluşur." />
              </div>
            )}
          </div>
          <div className="flex shrink-0 items-center justify-center gap-3">
            <Button variant={call.micOn ? "outline" : "danger"} onClick={call.toggleMic} disabled={!call.inCall}>
              {call.micOn ? <Mic size={16} /> : <MicOff size={16} />} {call.micOn ? "Mikrofon" : "Kapalı"}
            </Button>
            <Button variant={call.camOn ? "outline" : "danger"} onClick={call.toggleCam} disabled={!call.inCall}>
              {call.camOn ? <Video size={16} /> : <VideoOff size={16} />} {call.camOn ? "Kamera" : "Kapalı"}
            </Button>
            <Button variant={call.screen ? "primary" : "outline"} onClick={() => void call.shareScreen()} disabled={!call.inCall}>
              <MonitorUp size={16} /> {call.screen ? "Paylaşımı durdur" : "Ekran paylaş"}
            </Button>
            <Button variant="danger" onClick={() => setConfirmEnd(true)} disabled={!session}>
              <PhoneOff size={16} /> Seansı bitir
            </Button>
          </div>
        </div>
      </div>

      {/* Sağ: notlar */}
      <div className="flex min-h-0 flex-col gap-2">
        <div className="flex shrink-0 gap-1 rounded-xl border border-line bg-panel p-1" role="tablist">
          {([["session", "Seans", null], ["assistant", "Asistan", Sparkles]] as const).map(([id, label, Icon]) => (
            <button
              key={id}
              role="tab"
              aria-selected={rightView === id}
              onClick={() => setRightView(id)}
              className={cx(
                "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] transition-colors",
                rightView === id ? "bg-accent-soft font-medium text-ink" : "text-muted hover:text-ink",
              )}
            >
              {Icon && <Icon size={14} className={rightView === id ? "text-accent" : ""} />}
              {label}
            </button>
          ))}
        </div>
        {/* İkisi de bağlı kalır: görünüm değişince not ve konuşma kaybolmaz. */}
        <div className={cx("min-h-0 flex-1 flex-col gap-2.5", rightView === "session" ? "flex" : "hidden")}>
          {session ? <GroupNotes key={session.id} session={session} /> : <Card title="Grup Seans Notları"><Empty text="Yükleniyor…" /></Card>}
          {session && <MemberNotes session={session} members={members} />}
          <GroupTools
            call={call}
            members={members}
            materials={materials}
            material={material}
            onOpenBoard={() => setBoardStarting(true)}
            onDrawMaterial={(m) => void drawOnMaterial(m)}
            onNavigate={onNavigate}
          />
        </div>
        <div className={cx("min-h-0 flex-1 overflow-hidden rounded-xl border border-line bg-panel", rightView === "assistant" ? "block" : "hidden")}>
          <AssistantChat onOpenSettings={() => onNavigate("settings")} />
        </div>
      </div>

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
          patient={null}
          sessionId={null}
          remote={call.peers[0]?.stream ?? null}
          backdropUrl={boardBackdrop}
          saveFor={members.map((m) => m.patient_id)}
          label={group.name}
        />
      )}

      {confirmEnd && (
        <Modal title="Grup seansı bitirilsin mi?" onClose={() => setConfirmEnd(false)}>
          <p className="text-sm text-muted">Görüşme tüm katılımcılar için sona erer ve seans tamamlanır. Notlarınız kayıtlıdır.</p>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmEnd(false)}>Vazgeç</Button>
            <Button variant="danger" onClick={finish} disabled={saving}>{saving ? "Bitiriliyor…" : "Seansı bitir"}</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
