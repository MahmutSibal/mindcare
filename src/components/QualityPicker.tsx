import { QUALITY_PRESETS, type QualityPreset } from "../lib/rtc";
import { cx } from "./ui";

/** Kişinin kendi gönderdiği görüntünün kalitesi (terapist ve danışan ortak kullanır). */
export default function QualityPicker({ value, onChange }: { value: QualityPreset; onChange: (q: QualityPreset) => void }) {
  return (
    <div role="radiogroup" aria-label="Gönderdiğim görüntü kalitesi">
      <p className="mb-2 text-[13px] font-medium text-ink">Gönderdiğim görüntü kalitesi</p>
      <div className="space-y-1.5">
        {QUALITY_PRESETS.map((q) => (
          <button
            key={q.id}
            role="radio"
            aria-checked={value === q.id}
            onClick={() => onChange(q.id)}
            className={cx(
              "block w-full rounded-lg border px-3 py-2 text-left transition-colors",
              value === q.id ? "border-accent bg-accent-soft" : "border-line bg-card/60 hover:bg-card",
            )}
          >
            <span className="block text-sm text-ink">{q.label}</span>
            <span className="block text-xs text-muted">{q.hint}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
