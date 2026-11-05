import { useState } from "react";
import { api, errorText, type Patient, type PatientStatus } from "../lib/api";
import { notifyDataChanged } from "../lib/session";
import { Button, Field, inputCls, Modal } from "./ui";

export default function PatientForm({ patient, onClose, onSaved }: {
  patient?: Patient | null;
  onClose: () => void;
  onSaved?: (id: string) => void;
}) {
  const [form, setForm] = useState({
    full_name: patient?.full_name ?? "",
    birth_date: patient?.birth_date ?? "",
    phone: patient?.phone ?? "",
    email: patient?.email ?? "",
    status: (patient?.status ?? "active") as PatientStatus,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      let id = patient?.id;
      if (id) await api.updatePatient(id, form);
      else id = await api.createPatient(form);
      notifyDataChanged();
      onSaved?.(id);
      onClose();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={patient ? "Danışanı Düzenle" : "Yeni Danışan"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Ad Soyad *">
          <input className={inputCls} value={form.full_name} onChange={set("full_name")} autoFocus required />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Doğum Tarihi">
            <input type="date" className={inputCls} value={form.birth_date} onChange={set("birth_date")} />
          </Field>
          <Field label="Durum">
            <select className={inputCls} value={form.status} onChange={set("status")}>
              <option value="active">Aktif</option>
              <option value="passive">Pasif</option>
            </select>
          </Field>
          <Field label="Telefon">
            <input className={inputCls} value={form.phone} onChange={set("phone")} inputMode="tel" />
          </Field>
          <Field label="E-posta">
            <input type="email" className={inputCls} value={form.email} onChange={set("email")} />
          </Field>
        </div>
        {error && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Vazgeç</Button>
          <Button type="submit" disabled={busy}>{patient ? "Kaydet" : "Danışan Ekle"}</Button>
        </div>
      </form>
    </Modal>
  );
}
