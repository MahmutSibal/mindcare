import { useEffect, useState } from "react";
import { PencilLine, Search, Trash2, UserPlus } from "lucide-react";
import { api, errorText, type Patient } from "../lib/api";
import { age, fmtDate, fmtDateTime, initials } from "../lib/format";
import { notifyDataChanged, useActiveSession, useDataVersion } from "../lib/session";
import PageHeader, { Table } from "../components/PageHeader";
import PatientForm from "../components/PatientForm";
import { Avatar, Badge, Button, Empty, inputCls, Modal } from "../components/ui";

export default function Patients({ onOpen }: { onOpen: (id: string) => void }) {
  const version = useDataVersion();
  const { session } = useActiveSession();
  const [list, setList] = useState<Patient[]>([]);
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState<Patient | null | "new">(null);
  const [del, setDel] = useState<Patient | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listPatients().then(setList);
  }, [version]);

  const filtered = list.filter((p) =>
    [p.full_name, p.phone, p.email].some((v) => v?.toLocaleLowerCase("tr-TR").includes(q.toLocaleLowerCase("tr-TR"))),
  );

  const remove = async () => {
    if (!del) return;
    try {
      await api.deletePatient(del.id);
      setDel(null);
      notifyDataChanged();
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <div className="h-full overflow-y-auto p-8">
      <PageHeader title="Danışanlar" subtitle={`${list.length} kayıtlı danışan`}>
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input className={inputCls + " w-64 pl-9"} placeholder="Ara…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Button onClick={() => setEdit("new")}><UserPlus size={16} /> Yeni Danışan</Button>
      </PageHeader>

      {filtered.length === 0 ? (
        <Empty text={q ? "Eşleşen danışan yok." : "Henüz danışan eklenmedi."} />
      ) : (
        <Table head={["Danışan", "Yaş", "İletişim", "Seans", "Son Seans", "Sonraki Randevu", "Durum", ""]}>
          {filtered.map((p) => (
            <tr key={p.id} className="cursor-pointer hover:bg-card/50" onClick={() => onOpen(p.id)}>
              <td className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <Avatar text={initials(p.full_name)} size={34} />
                  <span className="font-medium">{p.full_name}</span>
                </div>
              </td>
              <td className="px-4 py-3 text-muted">{age(p.birth_date) ?? "—"}</td>
              <td className="px-4 py-3 text-muted">
                <div>{p.phone ?? "—"}</div>
                <div className="text-xs text-faint">{p.email}</div>
              </td>
              <td className="px-4 py-3">{p.completed_sessions}</td>
              <td className="px-4 py-3 text-muted">{fmtDate(p.last_session_date)}</td>
              <td className="px-4 py-3 text-muted">{p.next_appointment ? fmtDateTime(p.next_appointment) : "—"}</td>
              <td className="px-4 py-3">
                {p.status === "active" ? <Badge>Aktif</Badge> : <Badge tone="muted">Pasif</Badge>}
              </td>
              <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                <div className="flex justify-end gap-1">
                  <Button variant="ghost" className="p-2" onClick={() => setEdit(p)} title="Düzenle"><PencilLine size={16} /></Button>
                  <Button
                    variant="ghost"
                    className="p-2 hover:text-danger"
                    onClick={() => setDel(p)}
                    disabled={session?.patient_id === p.id}
                    title="Sil"
                  >
                    <Trash2 size={16} />
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </Table>
      )}

      {edit && <PatientForm patient={edit === "new" ? null : edit} onClose={() => setEdit(null)} />}
      {del && (
        <Modal title="Danışanı sil" onClose={() => setDel(null)}>
          <p className="text-sm text-muted">
            <b className="text-ink">{del.full_name}</b> ve bu danışana ait <b className="text-ink">tüm seanslar, klinik notlar ve randevular</b> kalıcı olarak silinecek. Bu işlem geri alınamaz (yedekten geri yükleme hariç).
          </p>
          {error && <p className="mt-3 text-sm text-danger">{error}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDel(null)}>Vazgeç</Button>
            <Button variant="danger" onClick={remove}>Kalıcı Olarak Sil</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
