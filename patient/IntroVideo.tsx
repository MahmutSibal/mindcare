import { useEffect, useRef, useState, type ReactNode } from "react";
import { Volume2 } from "lucide-react";
import { t, useLang } from "./i18n";

/**
 * Karşılama videosu: terapist Ayarlar'a bir YouTube bağlantısı girmişse davet bağlantısı `&v=<kimlik>`
 * taşır; danışan katılma ekranından önce videoyu bir kez izler. Adres burada yalnızca doğrulanmış
 * 11 karakterlik kimlikten kurulur; bağlantıdan gelen başka hiçbir şey gömülmez.
 */
const YT_ORIGIN = "https://www.youtube-nocookie.com";
const SEEN_KEY = "mavi-ruh-giris-izlendi";
/** Video hiç başlayamazsa (ağ, otomatik oynatma engeli vb.) danışan beklemez. */
const START_TIMEOUT_MS = 8000;
/** Video beklenenden uzunsa da danışan en fazla bu kadar bekler. */
const MAX_PLAY_MS = 45000;

function introVideoId(): string | null {
  const v = new URLSearchParams(window.location.hash.slice(1)).get("v");
  return v && /^[A-Za-z0-9_-]{11}$/.test(v) ? v : null;
}

const seen = () => {
  try {
    return sessionStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
};

export default function IntroGate({ children }: { children: ReactNode }) {
  const [videoId] = useState(introVideoId);
  const [done, setDone] = useState(() => !videoId || seen());
  if (done || !videoId) return <>{children}</>;
  return <Player videoId={videoId} onDone={() => setDone(true)} />;
}

function Player({ videoId, onDone }: { videoId: string; onDone: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [muted, setMuted] = useState(true);
  useLang();

  useEffect(() => {
    let started = false;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      try {
        sessionStorage.setItem(SEEN_KEY, "1");
      } catch {
        /* gizli pencere: bir sonraki açılışta yeniden oynar */
      }
      onDone();
    };
    const post = (msg: object) =>
      frame.current?.contentWindow?.postMessage(JSON.stringify({ ...msg, id: "mavi-ruh-giris", channel: "widget" }), YT_ORIGIN);
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== YT_ORIGIN || e.source !== frame.current?.contentWindow) return;
      let d: { info?: { playerState?: unknown } } | null = null;
      try {
        d = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
      } catch {
        return;
      }
      const s = d?.info?.playerState;
      if (s === 1) started = true;
      if (s === 0) finish(); // video bitti
    };
    window.addEventListener("message", onMsg);
    const listen = setInterval(() => post({ event: "listening" }), 500);
    const startTimer = setTimeout(() => !started && finish(), START_TIMEOUT_MS);
    const maxTimer = setTimeout(finish, MAX_PLAY_MS);
    return () => {
      finished = true;
      clearInterval(listen);
      clearTimeout(startTimer);
      clearTimeout(maxTimer);
      window.removeEventListener("message", onMsg);
    };
  }, [onDone]);

  const unmute = () => {
    setMuted(false);
    frame.current?.contentWindow?.postMessage(JSON.stringify({ event: "command", func: "unMute", args: [], id: "mavi-ruh-giris", channel: "widget" }), YT_ORIGIN);
    frame.current?.contentWindow?.postMessage(JSON.stringify({ event: "command", func: "playVideo", args: [], id: "mavi-ruh-giris", channel: "widget" }), YT_ORIGIN);
  };

  const src =
    `${YT_ORIGIN}/embed/${videoId}?autoplay=1&mute=1&controls=0&disablekb=1&playsinline=1&rel=0&modestbranding=1&fs=0&enablejsapi=1` +
    `&origin=${encodeURIComponent(window.location.origin)}`;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black">
      <iframe
        ref={frame}
        src={src}
        title={t("Karşılama videosu")}
        className="pointer-events-none aspect-video max-h-full w-full max-w-5xl border-0"
        allow="autoplay; encrypted-media"
        referrerPolicy="strict-origin-when-cross-origin"
      />
      {muted && (
        <button
          onClick={unmute}
          className="absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-white/90 px-5 py-2.5 text-sm font-medium text-black shadow-lg"
        >
          <Volume2 size={16} /> {t("Sesi aç")}
        </button>
      )}
    </div>
  );
}
