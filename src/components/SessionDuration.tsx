import { useState } from "react";
import { Pencil } from "lucide-react";
import { api, errorText, type Session } from "../lib/api";
import { notifyDataChanged } from "../lib/session";
import { fmtDate } from "../lib/format";
import { Button, Field, inputCls, Modal } from "./ui";

/** Tamamlanmış bir seansın süresini düzeltmek için kalem düğmesi ve küçük pencere. */
export default function DurationEditButton({ session }: { session: Session }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (session.status !== "completed") return null;

  const openDialog = (e: React.MouseEvent) => {
    e.stopPropagation(); // satır tıklaması danışanı açmasın
    setValue(String(Math.round(session.duration_seconds / 60)));
    setError(null);
    setOpen(true);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const m = Number(value.replace(",", "."));
    if (!Number.isFinite(m) || m < 0 || m > 1440) {
      setError("Süre 0 ile 1440 dakika (24 saat) arasında olmalı.");
      return;
    }
    setSaving(true);
    try {
      await api.updateSessionDuration(session.id, Math.round(m * 60));
      notifyDataChanged();
      setOpen(false);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button
        onClick={openDialog}
        className="rounded-md p-1 text-faint hover:bg-card hover:text-ink"
        title="Seans süresini düzenle"
        aria-label="Seans süresini düzenle"
      >
        <Pencil size={13} />
      </button>
      {open && (
        <Modal title="Seans süresini düzenle" onClose={() => setOpen(false)} width="max-w-sm">
          <form onSubmit={save} className="space-y-4" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm text-muted">
              {session.session_number}. seans • {fmtDate(session.session_date)}
            </p>
            <Field label="Süre (dakika)">
              <input
                type="number"
                min={0}
                max={1440}
                step={1}
                className={inputCls}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                autoFocus
                required
              />
            </Field>
            {error && <p className="text-xs text-danger">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Vazgeç</Button>
              <Button type="submit" disabled={saving}>{saving ? "Kaydediliyor…" : "Kaydet"}</Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
