import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, Mic, MicOff, MonitorUp, PhoneOff, Pencil, Plus, Trash2, Users, UsersRound, Video, VideoOff } from "lucide-react";
import {
  api, errorText, type GroupMember, type GroupSession, type Patient, type TherapyGroup,
} from "../lib/api";
import { MAX_GROUP_GUESTS, type GroupPeer } from "../lib/groupRtc";
import { notifyDataChanged, useDataVersion } from "../lib/session";
import { Avatar, Badge, Button, Card, cx, Empty, Field, inputCls, Modal } from "../components/ui";
import { initials } from "../lib/format";
import { useGroupCall, type GroupCallApi } from "../components/workspace/useGroupCall";

export default function Groups() {
  const version = useDataVersion();
  const [groups, setGroups] = useState<TherapyGroup[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [editing, setEditing] = useState<TherapyGroup | "new" | null>(null);
  const [active, setActive] = useState<TherapyGroup | null>(null);
  const call = useGroupCall();

  const load = useCallback(() => {
    api.listGroups().then(setGroups).catch(() => {});
    api.listPatients().then(setPatients).catch(() => {});
  }, []);
  useEffect(load, [load, version]);

  if (active) {
    return (
      <GroupSessionView
        key={active.id}
        group={active}
        call={call}
        onClose={() => {
          setActive(null);
          notifyDataChanged();
        }}
      />
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-3xl">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Gruplar</h1>
            <p className="text-sm text-muted">
              Grup terapileri: en fazla {MAX_GROUP_GUESTS} danışanla ortak görüntülü seans; grup notu ve üye başına not.
            </p>
          </div>
          <Button onClick={() => setEditing("new")}>
            <Plus size={16} /> Yeni grup
          </Button>
        </div>

        {groups.length === 0 ? (
          <Empty icon={<UsersRound size={28} />} text="Henüz grup yok. Bir grup oluşturup danışanları ekleyin." />
        ) : (
          <div className="space-y-2.5">
            {groups.map((g) => (
              <Card key={g.id} className={g.status === "passive" ? "opacity-60" : ""}>
                <div className="flex items-center gap-3">
                  <Avatar text={initials(g.name)} size={44} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 font-medium">
                      <span className="truncate">{g.name}</span>
                      {g.status === "passive" && <Badge tone="muted">Pasif</Badge>}
                    </div>
                    <div className="text-xs text-muted">
                      {g.member_count} üye • {g.session_count} tamamlanan seans
                      {g.description ? ` • ${g.description}` : ""}
                    </div>
                  </div>
                  <Button variant="ghost" onClick={() => setEditing(g)} aria-label={`${g.name} grubunu düzenle`}>
                    <Pencil size={15} />
                  </Button>
                  <Button disabled={g.member_count === 0 || g.status === "passive"} onClick={() => setActive(g)}>
                    <Video size={16} /> Seansı başlat
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {editing && (
        <GroupDialog
          group={editing === "new" ? null : editing}
          patients={patients}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
            notifyDataChanged();
          }}
        />
      )}
    </div>
  );
}

// ───────────────────────────── Grup düzenleme ─────────────────────────────

function GroupDialog({ group, patients, onClose, onSaved }: {
  group: TherapyGroup | null;
  patients: Patient[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(group?.name ?? "");
  const [description, setDescription] = useState(group?.description ?? "");
  const [status, setStatus] = useState<"active" | "passive">(group?.status ?? "active");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (group) api.listGroupMembers(group.id).then((m) => setSelected(new Set(m.map((x) => x.patient_id))));
  }, [group]);

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else if (n.size < MAX_GROUP_GUESTS) n.add(id);
      return n;
    });

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const id = await api.saveGroup(group?.id ?? null, { name, description: description || undefined, status });
      await api.setGroupMembers(id, [...selected]);
      onSaved();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  return (
    <Modal title={group ? "Grubu düzenle" : "Yeni grup"} onClose={onClose}>
      <div className="space-y-3">
        <Field label="Grup adı">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={80} />
        </Field>
        <Field label="Açıklama (isteğe bağlı)">
          <input className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} />
        </Field>
        <Field label={`Üyeler (${selected.size}/${MAX_GROUP_GUESTS})`} hint="Yalnızca kayıtlı danışanlar eklenebilir.">
          <div className="max-h-52 space-y-0.5 overflow-y-auto rounded-lg border border-line bg-bg p-1.5">
            {patients.length === 0 && <p className="p-2 text-sm text-muted">Önce Danışanlar sayfasından danışan ekleyin.</p>}
            {patients.map((p) => (
              <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-card">
                <input
                  type="checkbox"
                  checked={selected.has(p.id)}
                  onChange={() => toggle(p.id)}
                  disabled={!selected.has(p.id) && selected.size >= MAX_GROUP_GUESTS}
                />
                <span className="truncate">{p.full_name}</span>
                {p.status === "passive" && <Badge tone="muted">Pasif</Badge>}
              </label>
            ))}
          </div>
        </Field>
        {group && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={status === "passive"} onChange={(e) => setStatus(e.target.checked ? "passive" : "active")} />
            Grubu pasife al (seans başlatılamaz)
          </label>
        )}
        {error && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
      </div>
      <div className="mt-5 flex items-center justify-between">
        {group ? (
          confirmDelete ? (
            <Button
              variant="danger"
              onClick={async () => {
                await api.deleteGroup(group.id);
                onSaved();
              }}
            >
              Silmeyi onayla (seanslar da silinir)
            </Button>
          ) : (
            <Button variant="ghost" className="hover:text-danger" onClick={() => setConfirmDelete(true)}>
              <Trash2 size={15} /> Sil
            </Button>
          )
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>Vazgeç</Button>
          <Button onClick={save} disabled={busy || !name.trim()}>{busy ? "Kaydediliyor…" : "Kaydet"}</Button>
        </div>
      </div>
    </Modal>
  );
}

// ───────────────────────────── Grup seansı ─────────────────────────────

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
        {state && state !== "connected" && <span className="rounded bg-warn/80 px-1 text-[10px] text-black">{state === "connecting" ? "bağlanıyor" : "yeniden bağlanıyor"}</span>}
      </div>
    </div>
  );
}

function GroupSessionView({ group, call, onClose }: { group: TherapyGroup; call: GroupCallApi; onClose: () => void }) {
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [session, setSession] = useState<GroupSession | null>(null);
  const [note, setNote] = useState("");
  const [memberNotes, setMemberNotes] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noteRef = useRef(note);
  noteRef.current = note;
  const memberIds = useRef(new Set<string>());
  memberIds.current = new Set(members.map((m) => m.patient_id));

  // Üyeler ve (yarım kalmış olabilecek) açık grup seansı yüklenir.
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const m = await api.listGroupMembers(group.id);
        const s = await api.startGroupSession(group.id);
        const notes = await api.listGroupMemberNotes(s.id);
        if (!live) return;
        setMembers(m);
        setSession(s);
        setNote(s.note ?? "");
        setMemberNotes(Object.fromEntries(notes.map((n) => [n.patient_id, n.note])));
      } catch (e) {
        if (live) setError(errorText(e));
      }
    })();
    return () => {
      live = false;
    };
  }, [group.id]);

  // Grup notu yazıldıkça kendiliğinden kaydedilir.
  useEffect(() => {
    if (!session) return;
    const t = setTimeout(() => void api.saveGroupSessionNote(session.id, noteRef.current || null, false).catch(() => {}), 1500);
    return () => clearTimeout(t);
  }, [note, session]);

  // Danışan katılırken onam verdiyse, o üyenin dosyasına işlenir.
  const { onMessage } = call;
  useEffect(
    () =>
      onMessage((m, from) => {
        if (m.type !== "consent") return;
        const peer = call.peers.find((p) => p.id === from);
        if (peer?.memberId && memberIds.current.has(peer.memberId)) {
          api.recordPatientConsent(peer.memberId).then(notifyDataChanged).catch(() => {});
        }
      }),
    [onMessage, call.peers],
  );

  const begin = () => void call.start(members.map((m) => ({ id: m.patient_id, name: m.full_name })));

  const finish = async () => {
    if (!session) return;
    setSaving(true);
    try {
      await api.saveGroupSessionNote(session.id, note || null, true);
      await call.hangup();
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
  const others = call.peers;
  const connectedCount = others.filter((p) => p.state === "connected").length;

  return (
    <div className="grid h-full grid-cols-[minmax(250px,300px)_minmax(0,1fr)_minmax(290px,340px)] gap-2.5 p-2.5">
      {/* Üyeler ve davetler */}
      <div className="flex min-h-0 flex-col gap-2.5 overflow-y-auto">
        <Card title={group.name}>
          <p className="text-xs text-muted">
            {session ? `${session.session_number}. grup seansı` : "Yükleniyor…"} • {members.length} üye
          </p>
          {!call.inCall && (
            <Button className="mt-3 w-full" onClick={begin} disabled={!session || members.length === 0}>
              <Video size={16} /> Görüşmeyi başlat ve davetleri oluştur
            </Button>
          )}
          {!call.inCall && (
            <Button variant="ghost" className="mt-1 w-full text-xs" onClick={onClose}>Gruplara dön</Button>
          )}
          {call.error && <p className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{call.error}</p>}
          {error && <p className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
        </Card>

        <Card title="Üyeler">
          <ul className="space-y-2">
            {members.map((m) => {
              const peer = statusOf(m.patient_id);
              const invite = call.invites.find((i) => i.memberId === m.patient_id);
              return (
                <li key={m.patient_id} className="rounded-lg border border-line bg-bg p-2">
                  <div className="flex items-center gap-2 text-sm">
                    <span
                      className={cx("h-2 w-2 shrink-0 rounded-full", peer?.state === "connected" ? "bg-ok" : peer ? "bg-warn" : "bg-faint")}
                      title={peer ? peer.state : "katılmadı"}
                    />
                    <span className="min-w-0 flex-1 truncate">{m.full_name}</span>
                    <span className="text-[11px] text-faint">{peer?.state === "connected" ? "bağlı" : peer ? "bağlanıyor" : "katılmadı"}</span>
                  </div>
                  {invite && (
                    <Button
                      variant="subtle"
                      className="mt-1.5 w-full px-2 py-1 text-xs"
                      onClick={() => void copy(m.patient_id, invite.link)}
                    >
                      {copied === m.patient_id ? <><Check size={13} /> Kopyalandı</> : <><Copy size={13} /> Davet bağlantısını kopyala</>}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
          {call.invites.length > 0 && (
            <p className="mt-2 text-[11px] leading-snug text-faint">
              Her bağlantı yalnızca o üyeye özeldir ve tek kullanımlıktır. Üyeye ayrı ayrı gönderin.
            </p>
          )}
        </Card>
      </div>

      {/* Görüntü ızgarası */}
      <div className="flex min-h-0 flex-col gap-2 rounded-xl border border-line bg-panel p-2.5">
        <div className="flex shrink-0 items-center justify-between text-xs text-muted">
          <span className="flex items-center gap-1.5"><Users size={14} /> {connectedCount} / {members.length} katılımcı bağlı</span>
          {call.screen && <Badge tone="accent">Ekran paylaşılıyor</Badge>}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {call.inCall ? (
            <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-2">
              {others.map((p) => (
                <Tile key={p.id} stream={p.stream} name={p.name} state={p.state} />
              ))}
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

      {/* Notlar */}
      <div className="flex min-h-0 flex-col gap-2.5 overflow-y-auto">
        <Card title="Grup notu">
          <textarea
            className={cx(inputCls, "min-h-[150px] resize-y")}
            placeholder="Seansın genel akışı, grup dinamiği, konular…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <p className="mt-1 text-[11px] text-faint">Yazdıkça kendiliğinden kaydedilir.</p>
        </Card>
        <Card title="Üye notları">
          <div className="space-y-2.5">
            {members.map((m) => (
              <Field key={m.patient_id} label={m.full_name}>
                <textarea
                  className={cx(inputCls, "min-h-[56px] resize-y text-sm")}
                  placeholder="Bu üyeye özel gözlem (isteğe bağlı)"
                  value={memberNotes[m.patient_id] ?? ""}
                  onChange={(e) => setMemberNotes((n) => ({ ...n, [m.patient_id]: e.target.value }))}
                  onBlur={(e) => session && void api.saveGroupMemberNote(session.id, m.patient_id, e.target.value).catch(() => {})}
                />
              </Field>
            ))}
          </div>
        </Card>
      </div>

      {confirmEnd && (
        <Modal title="Grup seansı bitirilsin mi?" onClose={() => setConfirmEnd(false)}>
          <p className="text-sm text-muted">
            Görüşme tüm katılımcılar için sona erer, grup notu kaydedilir ve seans tamamlanır.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmEnd(false)}>Vazgeç</Button>
            <Button variant="danger" onClick={finish} disabled={saving}>{saving ? "Kaydediliyor…" : "Seansı bitir"}</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
