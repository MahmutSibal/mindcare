import { cx } from "./ui";

/** Telefonda üç sütunlu ekranların yerine geçen üst sekme çubuğu (masaüstünde gizlenir). */
export default function MobileTabs<T extends string>({ tabs, value, onChange }: {
  tabs: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="flex shrink-0 gap-1 rounded-xl border border-line bg-panel p-1 xl:hidden" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cx(
            "flex-1 rounded-lg px-2 py-2 text-[13px] transition-colors",
            value === t.id ? "bg-accent-soft font-medium text-ink" : "text-muted",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
