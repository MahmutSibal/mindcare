// Ses ve görüntü cihazı seçimi için küçük yan panel: mikrofon (canlı seviye göstergesiyle), hoparlör ve kamera.
// Hem terapist uygulamasında hem danışan sayfasında kullanılır; metinler `t` ile çevrilir.

import { useEffect, useRef, useState } from "react";
import { Camera, Mic, Volume2, X } from "lucide-react";
import { listDevices, outputSelectable, type DeviceLists } from "../lib/rtc";
import { cx } from "./ui";

type Tr = (s: string) => string;
const id: Tr = (s) => s;

function Level({ stream }: { stream: MediaStream | null }) {
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const track = stream?.getAudioTracks()[0];
    if (!track) return;
    const ctx = new AudioContext();
    const an = ctx.createAnalyser();
    an.fftSize = 512;
    ctx.createMediaStreamSource(new MediaStream([track])).connect(an);
    const buf = new Uint8Array(an.fftSize);
    const timer = setInterval(() => {
      an.getByteTimeDomainData(buf);
      let peak = 0;
      for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
      if (bar.current) bar.current.style.width = `${Math.min(100, (peak / 64) * 100)}%`;
    }, 80);
    return () => {
      clearInterval(timer);
      void ctx.close().catch(() => {});
    };
  }, [stream]);
  return (
    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line" aria-hidden="true">
      <div ref={bar} className="h-full w-0 rounded-full bg-accent transition-[width] duration-75" />
    </div>
  );
}

/** Kısa bir uyarı sesi üretip seçili hoparlörden çalar. */
async function beep(sinkId: string) {
  const rate = 22050;
  const n = Math.floor(rate * 0.5);
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); w(8, "WAVE"); w(12, "fmt "); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const fade = Math.min(1, i / 800, (n - i) / 800);
    v.setInt16(44 + i * 2, Math.sin((2 * Math.PI * 660 * i) / rate) * 9000 * fade, true);
  }
  const url = URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
  const a = new Audio(url) as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
  try {
    if (sinkId && a.setSinkId) await a.setSinkId(sinkId);
    await a.play();
  } catch {
    /* çalınamadı */
  }
  a.onended = () => URL.revokeObjectURL(url);
}

export default function DevicePanel({ local, version = 0, outputId, onPickInput, onPickOutput, onClose, t = id }: {
  local: MediaStream | null;
  /** Giriş cihazı değişince artar; seviye göstergesi yeni mikrofona bağlanır. */
  version?: number;
  outputId: string;
  onPickInput: (kind: "audio" | "video", deviceId: string) => Promise<void> | void;
  onPickOutput: (deviceId: string) => void;
  onClose: () => void;
  t?: Tr;
}) {
  const [devs, setDevs] = useState<DeviceLists>({ mics: [], speakers: [], cams: [] });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const load = () => void listDevices().then(setDevs).catch(() => {});
    load();
    navigator.mediaDevices?.addEventListener?.("devicechange", load);
    return () => navigator.mediaDevices?.removeEventListener?.("devicechange", load);
  }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const curMic = (local?.getAudioTracks()[0]?.getSettings().deviceId as string | undefined) ?? "";
  const curCam = (local?.getVideoTracks()[0]?.getSettings().deviceId as string | undefined) ?? "";
  const pick = async (kind: "audio" | "video", deviceId: string) => {
    setBusy(true);
    setError(null);
    try {
      await onPickInput(kind, deviceId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      void listDevices().then(setDevs).catch(() => {});
    }
  };

  const sel = "mt-1.5 w-full rounded-lg border border-line bg-bg px-2.5 py-2 text-sm text-ink outline-none focus:border-accent disabled:opacity-50";
  const head = (Icon: typeof Mic, label: string) => (
    <div className="flex items-center gap-2 text-[13px] font-medium"><Icon size={15} className="text-accent" /> {label}</div>
  );

  return (
    <>
      <button className="fixed inset-0 z-[68] cursor-default bg-black/40" aria-label={t("Kapat")} onClick={onClose} />
      <aside
        className="fixed bottom-0 right-0 top-0 z-[69] flex w-[300px] max-w-[88vw] flex-col border-l border-line bg-panel pt-[env(safe-area-inset-top)] shadow-2xl"
        role="dialog"
        aria-label={t("Ses ve görüntü")}
      >
        <header className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3">
          <h3 className="text-sm font-semibold">{t("Ses ve görüntü")}</h3>
          <button onClick={onClose} className="rounded-md p-1 text-muted hover:bg-card hover:text-ink" aria-label={t("Kapat")}><X size={17} /></button>
        </header>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <section>
            {head(Mic, t("Mikrofon"))}
            <select className={sel} value={curMic} disabled={busy || devs.mics.length === 0} onChange={(e) => void pick("audio", e.target.value)}>
              {devs.mics.length === 0 && <option value="">{t("Cihaz bulunamadı")}</option>}
              {devs.mics.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
            </select>
            <Level key={version} stream={local} />
          </section>

          <section>
            {head(Volume2, t("Hoparlör / kulaklık"))}
            {outputSelectable() ? (
              <>
                <select className={sel} value={outputId} onChange={(e) => onPickOutput(e.target.value)} disabled={devs.speakers.length === 0}>
                  {devs.speakers.length === 0 && <option value="">{t("Cihaz bulunamadı")}</option>}
                  {devs.speakers.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
                </select>
                <button onClick={() => void beep(outputId)} className={cx("mt-2 rounded-lg border border-line bg-card px-3 py-1.5 text-xs text-ink hover:bg-line")}>
                  {t("Sesi dene")}
                </button>
              </>
            ) : (
              <p className="mt-1.5 text-xs leading-relaxed text-muted">{t("Bu cihazda hoparlör seçimi desteklenmiyor; sesi sistem ayarlarından seçebilirsiniz.")}</p>
            )}
          </section>

          <section>
            {head(Camera, t("Kamera"))}
            <select className={sel} value={curCam} disabled={busy || devs.cams.length === 0} onChange={(e) => void pick("video", e.target.value)}>
              {devs.cams.length === 0 && <option value="">{t("Cihaz bulunamadı")}</option>}
              {devs.cams.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
            </select>
          </section>

          {error && <p className="rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}
          <p className="text-[11px] leading-relaxed text-faint">
            {t("Ses 48 kHz ve yüksek bit hızıyla, görüntü bağlantı elverdiğince Full HD'ye kadar gönderilir. Kulaklık kullanmak yankıyı ve gürültüyü azaltır.")}
          </p>
        </div>
      </aside>
    </>
  );
}
