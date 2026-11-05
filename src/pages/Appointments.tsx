import { useEffect, useState } from "react";
import { CalendarPlus, Check, Trash2, X } from "lucide-react";
import { api, errorText, type Appointment, type AppointmentStatus, type Patient } from "../lib/api";
import { fmtDate, fmtTime, localInputValue } from "../lib/format";
import { notifyDataChanged, useDataVersion } from "../lib/session";
import PageHeader, { Table } from "../components/PageHeader";
import { Badge, Button, cx, Empty, Field, inputCls, Modal } from "../components/ui";

const STATUS: Record<AppointmentStatus, { label: string; tone: "accent" | "ok" | "muted" | "warn" }> = {
  scheduled: { label: "Planlandı", tone: "accent" },
  completed: { label: "Tamamlandı", tone: "ok" },
  cancelled: { label: "İptal", tone: "muted" },
  no_show: { label: "Gelmedi", tone: "warn" },
};

export default function Appointments() {
  const version = useDataVersion();
  const [list, setList] = useState<Appointment[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [filter, setFilter] = useState<"upcoming" | "past" | "all">("upcoming");
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    api.listAppointments().then(setList);
    api.listPatients().then(setPatients);
  }, [version]);

  const now = localInputValue(new Date());
  const shown = list.filter((a) =>
    filter === "all" ? true : filter === "upcoming" ? a.appointment_date >= now && a.status === "scheduled" : a.appointment_date < now || a.status !== "scheduled",
  );
  if (filter === "past") shown.reverse();

  const setStatus = async (a: Appointment, s: AppointmentStatus) => {
    await api.setAppointmentStatus(a.id, s);
    notifyDataChanged();
  };
  const remove = async (a: Appointment) => {
    await api.deleteAppointment(a.id);
    notifyDataChanged();
  };

  return (
    <div className="h-full overflow-y-auto p-8">
      <PageHeader title="Randevular" subtitle="Planlanan ve geçmiş randevular">
        <div className="flex rounded-lg border border-line bg-panel p-0.5">
          {([["upcoming", "Yaklaşan"], ["past", "Geçmiş"], ["all", "Tümü"]] as const).map(([id, l]) => (
            <button
              key={id}
              onClick={() => setFilter(id)}
              className={cx("rounded-md px-3 py-1.5 text-sm", filter === id ? "bg-accent-soft text-ink" : "text-muted hover:text-ink")}
            >
              {l}
            </button>
          ))}
        </div>
        <Button onClick={() => setAdding(true)} disabled={patients.length === 0}><CalendarPlus size={16} /> Yeni Randevu</Button>
      </PageHeader>

      {shown.length === 0 ? (
        <Empty text="Bu görünümde randevu yok." />
      ) : (
        <Table head={["Tarih", "Saat", "Danışan", "Süre", "Durum", ""]}>
          {shown.map((a) => (
            <tr key={a.id} className="hover:bg-card/50">
              <td className="px-4 py-3">{fmtDate(a.appointment_date)}</td>
              <td className="px-4 py-3 tabular-nums">{fmtTime(a.appointment_date)}</td>
              <td className="px-4 py-3 font-medium">{a.patient_name}</td>
              <td className="px-4 py-3 text-muted">{a.duration_minutes} dk</td>
              <td className="px-4 py-3"><Badge tone={STATUS[a.status].tone}>{STATUS[a.status].label}</Badge></td>
              <td className="px-4 py-3">
                <div className="flex justify-end gap-1">
                  {a.status === "scheduled" && (
                    <>
                      <Button variant="ghost" className="p-2 hover:text-ok" title="Tamamlandı" onClick={() => setStatus(a, "completed")}><Check size={16} /></Button>
                      <Button variant="ghost" className="p-2" title="İptal et" onClick={() => setStatus(a, "cancelled")}><X size={16} /></Button>
                    </>
                  )}
                  <Button variant="ghost" className="p-2 hover:text-danger" title="Sil" onClick={() => remove(a)}><Trash2 size={16} /></Button>
                </div>
              </td>
            </tr>
          ))}
        </Table>
      )}
      {adding && <AppointmentForm patients={patients} onClose={() => setAdding(false)} />}
    </div>
  );
}

function AppointmentForm({ patients, onClose }: { patients: Patient[]; onClose: () => void }) {
  const next = new Date();
  next.setDate(next.getDate() + 1);
  next.setHours(10, 0, 0, 0);
  const [form, setForm] = useState({
    patient_id: patients.find((p) => p.status === "active")?.id ?? patients[0]?.id ?? "",
    appointment_date: localInputValue(next),
    duration_minutes: 50,
  });
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.createAppointment(form);
      notifyDataChanged();
      onClose();
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <Modal title="Yeni Randevu" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Danışan">
          <select className={inputCls} value={form.patient_id} onChange={(e) => setForm({ ...form, patient_id: e.target.value })}>
            {patients.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Tarih ve saat">
            <input type="datetime-local" className={inputCls} value={form.appointment_date} required
              onChange={(e) => setForm({ ...form, appointment_date: e.target.value })} />
          </Field>
          <Field label="Süre (dakika)">
            <input type="number" min={5} max={480} step={5} className={inputCls} value={form.duration_minutes}
              onChange={(e) => setForm({ ...form, duration_minutes: Number(e.target.value) })} />
          </Field>
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Vazgeç</Button>
          <Button type="submit">Randevu Oluştur</Button>
        </div>
      </form>
    </Modal>
  );
}
