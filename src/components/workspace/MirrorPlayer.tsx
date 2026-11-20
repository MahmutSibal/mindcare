import { useCallback, useEffect, useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import type { MediaState } from "../../lib/rtc";

const YT_ORIGIN = "https://www.youtube-nocookie.com";
/** Danışanın bildirdiği süre ile bu oynatıcı arasındaki fark bu kadar saniyeyi geçerse atlanır. */
const DRIFT_SECONDS = 5;

/**
 * Terapist ekranında, danışanın izlediği YouTube videosunun sessiz kopyası. Danışan sayfası durumu
 * (oynuyor/duraklatıldı/süre) birkaç saniyede bir bildirir; burada aynı video ona göre oynatılır ya da
 * duraklatılır. Oynatıcıya dokunulamaz: kumanda "Oynat/Duraklat" düğmesiyle danışana gider, böylece
 * iki ekran birbirinden ayrılmaz. Adres yalnızca doğrulanmış video kimliğinden kurulur.
 */
export default function MirrorPlayer({ videoId, start, media }: {
  videoId: string;
  start: number;
  media?: { state: MediaState; time: number; duration: number };
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const ready = useRef(false);
  const playerTime = useRef(0);
  const [muted, setMuted] = useState(true);

  const command = useCallback((func: string, args: unknown[] = []) => {
    frame.current?.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args, id: "mavi-ruh-ayna", channel: "widget" }), YT_ORIGIN);
  }, []);

  // Oynatıcıdan gelen süre bilgisi (kayma denetimi için) ve hazır olana kadar "dinliyorum" bildirimi.
  useEffect(() => {
    ready.current = false;
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== YT_ORIGIN || e.source !== frame.current?.contentWindow) return;
      ready.current = true;
      let d: { info?: { currentTime?: unknown } } | null = null;
      try {
        d = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
      } catch {
        return;
      }
      const t = d?.info?.currentTime;
      if (typeof t === "number") playerTime.current = t;
    };
    window.addEventListener("message", onMsg);
    const iv = setInterval(() => {
      if (!ready.current) frame.current?.contentWindow?.postMessage(JSON.stringify({ event: "listening", id: "mavi-ruh-ayna", channel: "widget" }), YT_ORIGIN);
    }, 500);
    return () => {
      clearInterval(iv);
      window.removeEventListener("message", onMsg);
    };
  }, [videoId]);

  // Danışanın durumuna uy.
  useEffect(() => {
    if (!media) return;
    if (media.state === "playing" || media.state === "buffering") {
      if (Math.abs(playerTime.current - media.time) > DRIFT_SECONDS) command("seekTo", [media.time, true]);
      command("playVideo");
    } else if (media.state === "paused" || media.state === "ended" || media.state === "unstarted") {
      command("pauseVideo");
      if (Math.abs(playerTime.current - media.time) > 1) command("seekTo", [media.time, true]);
    }
  }, [media, command]);

  useEffect(() => command(muted ? "mute" : "unMute"), [muted, command]);

  const src =
    `${YT_ORIGIN}/embed/${videoId}?mute=1&controls=0&disablekb=1&playsinline=1&rel=0&enablejsapi=1` +
    `&origin=${encodeURIComponent(window.location.origin)}${start ? `&start=${start}` : ""}`;

  return (
    <>
      <iframe
        ref={frame}
        src={src}
        title="Danışanın izlediği video"
        className="pointer-events-none h-full w-full border-0"
        allow="autoplay; encrypted-media"
        referrerPolicy="strict-origin-when-cross-origin"
        onLoad={() => command(muted ? "mute" : "unMute")}
      />
      <button
        onClick={() => setMuted((m) => !m)}
        className="absolute right-2 top-2 flex items-center gap-1 rounded-md bg-black/60 px-2 py-1 text-[11px] text-white hover:bg-black/80"
        title={muted ? "Sesi aç (görüşmede yankı yapabilir)" : "Sesi kapat"}
      >
        {muted ? <VolumeX size={13} /> : <Volume2 size={13} />} {muted ? "Sessiz" : "Ses açık"}
      </button>
    </>
  );
}
