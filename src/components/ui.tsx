import { type ButtonHTMLAttributes, type ReactNode, useEffect } from "react";
import { X } from "lucide-react";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function Card({ title, action, children, className }: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx("rounded-xl border border-line bg-panel p-4", className)}>
      {(title || action) && (
        <header className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="text-[15px] font-semibold text-ink">{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

type Variant = "primary" | "ghost" | "danger" | "outline" | "subtle";

export function Button({ variant = "primary", className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
}) {
  const styles: Record<Variant, string> = {
    primary: "bg-accent-strong hover:bg-accent text-white",
    ghost: "text-muted hover:text-ink hover:bg-card",
    danger: "bg-danger/90 hover:bg-danger text-white",
    outline: "border border-accent/60 text-accent hover:bg-accent-soft",
    subtle: "bg-card hover:bg-line text-ink",
  };
  return (
    <button
      {...props}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-40",
        styles[variant],
        className,
      )}
    />
  );
}

export function LinkButton({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1 text-[13px] text-accent hover:underline">
      {children}
    </button>
  );
}

export function Modal({ title, onClose, children, width = "max-w-lg" }: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onMouseDown={onClose}>
      <div
        className={cx("w-full rounded-2xl border border-line bg-panel shadow-2xl", width)}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <h3 className="text-base font-semibold">{title}</h3>
          <button onClick={onClose} className="rounded-md p-1 text-muted hover:bg-card hover:text-ink" aria-label="Kapat">
            <X size={18} />
          </button>
        </header>
        <div className="max-h-[75vh] overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-faint">{hint}</span>}
    </label>
  );
}

export const inputCls =
  "w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-ink outline-none placeholder:text-faint focus:border-accent";

export function Empty({ icon, text, children }: { icon?: ReactNode; text: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-6 text-center text-sm text-faint">
      {icon}
      <p>{text}</p>
      {children}
    </div>
  );
}

export function Avatar({ text, size = 72 }: { text: string; size?: number }) {
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full bg-accent-strong/80 font-medium text-white"
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {text}
    </div>
  );
}

export function Badge({ children, tone = "ok" }: { children: ReactNode; tone?: "ok" | "muted" | "warn" | "accent" }) {
  const tones = {
    ok: "bg-ok/15 text-ok border-ok/30",
    muted: "bg-card text-muted border-line",
    warn: "bg-warn/15 text-warn border-warn/30",
    accent: "bg-accent-soft text-accent border-accent/30",
  };
  return (
    <span className={cx("inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium", tones[tone])}>
      {children}
    </span>
  );
}

export function SoonTag({ version }: { version: string }) {
  return <span className="rounded bg-card px-1.5 py-0.5 text-[10px] font-medium text-faint">Sürüm {version}</span>;
}
