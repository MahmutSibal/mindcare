import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Trash2, UsersRound, Video } from "lucide-react";
import { api, errorText, type Patient, type TherapyGroup } from "../lib/api";
import { MAX_GROUP_GUESTS } from "../lib/groupRtc";
import { notifyDataChanged, useDataVersion } from "../lib/session";
import { Avatar, Badge, Button, Card, Empty, Field, inputCls, Modal } from "../components/ui";
import { initials } from "../lib/format";
import { useGroupCall } from "../components/workspace/useGroupCall";
import { GroupSessionView } from "../components/workspace/GroupSession";

export default function Groups({ onNavigate }: { onNavigate: (p: "materials" | "settings") => void }) {
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
        onNavigate={onNavigate}
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
