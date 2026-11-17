import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { errorText } from "../lib/api";
import { checkQuietly, installUpdate, updatesSupported, type Update } from "../lib/updater";
import { Button } from "./ui";

const SIX_HOURS = 6 * 3600 * 1000;

/** Açılışta ve 6 saatte bir yeni sürümü denetler; varsa köşede küçük bir bildirim gösterir. */
export default function UpdateBanner({ sessionActive }: { sessionActive: boolean }) {
  const [update, setUpdate] = useState<Update | null>(null);
  const [progress, setProgress] = useState<number | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!updatesSupported()) return;
    const run = () => void checkQuietly().then((u) => u && setUpdate(u));
    const first = setTimeout(run, 10_000);
    const every = setInterval(run, SIX_HOURS);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, []);

  if (!update || hidden) return null;
  const installing = progress !== undefined;

  const go = async () => {
    setError(null);
    setProgress(null);
    try {
      await installUpdate(update, setProgress);
    } catch (e) {
      setProgress(undefined);
      setError(errorText(e));
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-[64] max-w-sm rounded-xl border border-accent/40 bg-panel p-4 text-sm shadow-xl">
      <div className="flex items-center gap-2 font-medium"><Download size={16} className="text-accent" /> Yeni sürüm hazır: {update.version}</div>
      <p className="mt-1 text-xs text-muted">
        {sessionActive
          ? "Seans sürerken yüklenmez; seans bitince güncelleyebilirsiniz."
          : "Verileriniz korunur. Yükleme sırasında uygulama kısa süre kapanıp yeniden açılır."}
      </p>
      {installing && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
          <div className="h-full bg-accent transition-all" style={{ width: `${Math.round((progress ?? 0.05) * 100)}%` }} />
        </div>
      )}
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      <div className="mt-3 flex gap-2">
        <Button className="py-1.5 text-xs" onClick={() => void go()} disabled={sessionActive || installing}>
          {installing ? "Yükleniyor…" : "Şimdi güncelle"}
        </Button>
        {!installing && <Button variant="ghost" className="py-1.5 text-xs" onClick={() => setHidden(true)}>Sonra</Button>}
      </div>
    </div>
  );
}
