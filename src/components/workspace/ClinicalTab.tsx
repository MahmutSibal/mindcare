import { useState } from "react";
import { Pencil, Pill, Plus, Trash2, Wine } from "lucide-react";
import { api, errorText, type Patient, type Substance, type SubstanceKind } from "../../lib/api";
import { fmtDate } from "../../lib/format";
import { notifyDataChanged } from "../../lib/session";
import { Badge, Button, cx, Empty, Field, inputCls, Modal } from "../ui";

const KIND: Record<SubstanceKind, { label: string; plural: string; icon: typeof Pill; placeholder: string }> = {
  medication: { label: "İlaç", plural: "Kullanılan ilaçlar", icon: Pill, placeholder: "Örn. Sertralin" },
  substance: { label: "Madde", plural: "Alkol, sigara ve diğer maddeler", icon: Wine, placeholder: "Örn. Alkol, sigara, kafein" },
};

/**
 * Danışan dosyasının "Klinik" sekmesi: başvuru nedeni ve kullanılan ilaçlar/maddeler.
 * Başvuru nedeni burada düzenlenir; ilaç ve madde listesi kayıt bazlıdır.
 */
export default function ClinicalTab({ patient, substances }: { patient: Patient | null; substances: Substance[] }) {
  const [editing, setEditing] = useState<Substance | "new-medication" | "new-substance" | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!patient) return <Empty text="Danışan seçin" />;
  const reasonText = reason ?? patient.intake_reason ?? "";

  const saveReason = async () => {
    if (reason === null) return;
    setError(null);
    try {
      await api.updatePatient(patient.id, {
        full_name: patient.full_name,
        birth_date: patient.birth_date,
        phone: patient.phone,
        email: patient.email,
        status: patient.status,
        emergency_contact: patient.emergency_contact,
        emergency_phone: patient.emergency_phone,
        risk_note: patient.risk_note,
        intake_reason: reason,
      });
      setReason(null);
      notifyDataChanged();
    } catch (e) {
      setError(errorText(e));
    }
  };

  const group = (kind: SubstanceKind) => substances.filter((s) => s.kind === kind);

  return (
    <div className="space-y-4">
      <section>
        <h3 className="mb-1.5 text-[13px] font-medium">Başvuru nedeni</h3>
        <textarea
          className={cx(inputCls, "min-h-[84px] resize-y select-text")}
          value={reasonText}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Danışanın gelme nedeni, şikâyetin başlangıcı ve süresi…"
        />
        {reason !== null && (
          <div className="mt-1.5 flex justify-end gap-2">
            <Button variant="ghost" className="px-2.5 py-1 text-xs" onClick={() => setReason(null)}>Vazgeç</Button>
            <Button className="px-3 py-1 text-xs" onClick={saveReason}>Kaydet</Button>
          </div>
        )}
        {error && <p className="mt-1.5 text-xs text-danger">{error}</p>}
      </section>

      {(["medication", "substance"] as const).map((kind) => {
        const K = KIND[kind];
        const items = group(kind);
        return (
          <section key={kind}>
            <div className="mb-1.5 flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 text-[13px] font-medium">
                <K.icon size={14} className="text-accent" /> {K.plural}
              </h3>
              <button
                onClick={() => setEditing(kind === "medication" ? "new-medication" : "new-substance")}
                className="flex items-center gap-1 text-[13px] text-accent hover:underline"
              >
                <Plus size={14} /> Ekle
              </button>
            </div>
            {items.length === 0 ? (
              <p className="rounded-lg bg-card/50 px-3 py-2 text-xs text-faint">Kayıt yok.</p>
            ) : (
              <ul className="space-y-1.5">
                {items.map((s) => (
                  <li key={s.id} className={cx("group rounded-lg bg-card/70 px-3 py-2", !s.active && "opacity-60")}>
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <span className="select-text text-sm font-medium">{s.name}</span>
                          {s.dose && <span className="select-text text-xs text-muted">{s.dose}</span>}
                          {!s.active && <Badge tone="muted">Bırakıldı</Badge>}
                        </div>
                        <div className="select-text text-xs text-muted">
                          {[s.frequency, s.started_on ? `${fmtDate(s.started_on)}'den beri` : null].filter(Boolean).join(" • ")}
                        </div>
                        {s.note && <p className="mt-0.5 select-text whitespace-pre-wrap text-xs text-faint">{s.note}</p>}
                      </div>
                      <button
                        onClick={() => setEditing(s)}
                        className="rounded-md p-1 text-faint opacity-0 hover:bg-line hover:text-ink focus:opacity-100 group-hover:opacity-100"
                        title="Düzenle"
                        aria-label={`${s.name} kaydını düzenle`}
                      >
                        <Pencil size={13} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}

      {editing && (
        <SubstanceDialog
          patientId={patient.id}
          substance={typeof editing === "string" ? null : editing}
          kind={typeof editing === "string" ? (editing === "new-medication" ? "medication" : "substance") : editing.kind}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function SubstanceDialog({ patientId, substance, kind, onClose }: {
  patientId: string;
  substance: Substance | null;
  kind: SubstanceKind;
  onClose: () => void;
}) {
  const K = KIND[kind];
  const [form, setForm] = useState({
    name: substance?.name ?? "",
    dose: substance?.dose ?? "",
    frequency: substance?.frequency ?? "",
    started_on: substance?.started_on ?? "",
    note: substance?.note ?? "",
    active: substance?.active ?? true,
  });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api.saveSubstance(substance?.id ?? null, { patient_id: patientId, kind, ...form });
      notifyDataChanged();
      onClose();
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <Modal title={`${substance ? "Düzenle" : "Ekle"} • ${K.label}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Ad">
          <input className={inputCls} value={form.name} onChange={set("name")} placeholder={K.placeholder} autoFocus required />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label={kind === "medication" ? "Doz" : "Miktar"}>
            <input className={inputCls} value={form.dose} onChange={set("dose")} placeholder={kind === "medication" ? "Örn. 50 mg" : "Örn. günde 10 adet"} />
          </Field>
          <Field label="Sıklık">
            <input className={inputCls} value={form.frequency} onChange={set("frequency")} placeholder={kind === "medication" ? "Örn. günde 1 kez" : "Örn. hafta sonları"} />
          </Field>
          <Field label="Başlangıç tarihi">
            <input type="date" className={inputCls} value={form.started_on} onChange={set("started_on")} />
          </Field>
          <label className="flex items-end gap-2 pb-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[var(--color-accent)]"
              checked={form.active}
              onChange={(e) => setForm({ ...form, active: e.target.checked })}
            />
            Hâlâ kullanıyor
          </label>
        </div>
        <Field label="Not" hint="Yan etki, doktoru, bırakma nedeni gibi.">
          <textarea className={inputCls} rows={2} value={form.note} onChange={set("note")} />
        </Field>
        {error && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex items-center justify-between gap-2">
          {substance ? (
            confirmDelete ? (
              <Button
                type="button"
                variant="danger"
                className="text-xs"
                onClick={async () => {
                  await api.deleteSubstance(substance.id);
                  notifyDataChanged();
                  onClose();
                }}
              >
                Silmeyi onayla
              </Button>
            ) : (
              <Button type="button" variant="ghost" className="text-xs hover:text-danger" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={14} /> Sil
              </Button>
            )
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>Vazgeç</Button>
            <Button type="submit">Kaydet</Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
