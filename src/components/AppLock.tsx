import { useState } from "react";
import { LockKeyhole } from "lucide-react";
import { api, errorText } from "../lib/api";
import { BRAND_NAME } from "../lib/brand";
import BrandMark from "./BrandMark";
import { Button, inputCls } from "./ui";

/** Tam ekran kilit: doğru PIN girilene kadar altındaki uygulama görünmez (görüşme arka planda sürer). */
export default function AppLock({ onUnlock }: { onUnlock: () => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (await api.verifyAppPin(pin)) onUnlock();
      else {
        setError("PIN yanlış.");
        setPin("");
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-bg p-6">
      <form onSubmit={submit} className="w-full max-w-xs text-center">
        <div className="mb-4 flex justify-center"><BrandMark size={48} /></div>
        <h1 className="text-lg font-semibold">{BRAND_NAME}</h1>
        <p className="mt-1 flex items-center justify-center gap-1.5 text-sm text-muted"><LockKeyhole size={14} /> Kilitli</p>
        <input
          type="password"
          inputMode="numeric"
          autoFocus
          autoComplete="off"
          maxLength={8}
          className={inputCls + " mt-5 text-center text-lg tracking-[0.4em]"}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          placeholder="PIN"
          aria-label="PIN"
        />
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
        <Button type="submit" className="mt-4 w-full" disabled={busy || pin.length < 4}>{busy ? "Kontrol ediliyor…" : "Kilidi aç"}</Button>
      </form>
    </div>
  );
}
