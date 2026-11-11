// Danışan tarafı: terapistin gösterdiği materyal (görsel, belge, alıntı).
// Parçalar şifreli veri kanalından gelir, bellekte birleştirilir; hiçbir yere kaydedilmez.

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, ExternalLink, FileText, Play, Quote, X } from "lucide-react";
import type { ChannelMessage, MediaState } from "../src/lib/rtc";
import { fmtBytes, fromBase64, httpsUrl, isPdf, isSafeImage, MAX_FILE_SHARE_BYTES, parseYouTube } from "../src/lib/share";
import { Button } from "../src/components/ui";
import { saveFile } from "./saveFile";

type Show = Extract<ChannelMessage, { type: "material_show" }>;

export interface IncomingMaterial {
  id: string;
  title: string;
  kind: Show["kind"];
  mime: string;
  size: number;
  text?: string;
  progress: number;
  url?: string;
  /** Doğrulanmış https bağlantısı (kind: "link"). */
  link?: string;
}

/** Materyal mesajlarını işler. `handle` materyal mesajıysa `true` döner. */
export function useIncomingMaterial(ack: (id: string) => void) {
  const [current, setCurrent] = useState<IncomingMaterial | null>(null);
  // Aktarım durumu ref'lerde tutulur: kanal mesajları ekran yenilenmeden art arda gelebilir,
  // bu yüzden state'in son çizimdeki değerine güvenilmez.
  const parts = useRef<{ meta: IncomingMaterial; chunks: Uint8Array<ArrayBuffer>[]; received: number; lastReport: number } | null>(null);
  const shownId = useRef<string | null>(null);
  const [control, setControl] = useState<MediaControl | null>(null);
  const objectUrl = useRef<string | null>(null);

  const clear = useCallback(() => {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = null;
    parts.current = null;
    shownId.current = null;
    setControl(null);
    setCurrent(null);
  }, []);

  const handle = useCallback(
    (m: ChannelMessage): boolean => {
      switch (m.type) {
        case "material_show": {
          clear();
          if (m.kind === "link") {
            // Bağlantı burada yeniden doğrulanır; yalnızca https kabul edilir.
            const link = httpsUrl(m.url ?? "");
            if (!link) return true;
            shownId.current = m.id;
            setCurrent({ id: m.id, title: m.title, kind: "link", mime: m.mime, size: 0, progress: 1, link });
            ack(m.id);
            return true;
          }
          if (!["image", "document", "quote"].includes(m.kind) || m.size > MAX_FILE_SHARE_BYTES) return true;
          const meta: IncomingMaterial = { id: m.id, title: m.title, kind: m.kind, mime: m.mime, size: m.size, progress: 0 };
          shownId.current = m.id;
          if (m.kind === "quote") {
            setCurrent({ ...meta, text: m.text ?? "", progress: 1 });
            ack(m.id);
          } else {
            parts.current = { meta, chunks: [], received: 0, lastReport: 0 };
            setCurrent(meta);
          }
          return true;
        }
        case "material_chunk": {
          const p = parts.current;
          if (!p || p.meta.id !== m.id) return true;
          const bytes = fromBase64(m.data);
          p.received += bytes.byteLength;
          if (p.received > p.meta.size) {
            clear(); // Bildirilen boyutu aşan aktarım reddedilir.
            return true;
          }
          p.chunks.push(bytes);
          const progress = p.received / p.meta.size;
          if (progress - p.lastReport >= 0.05) {
            p.lastReport = progress;
            setCurrent({ ...p.meta, progress });
          }
          return true;
        }
        case "material_end": {
          const p = parts.current;
          if (!p || p.meta.id !== m.id) return true;
          parts.current = null;
          const url = URL.createObjectURL(new Blob(p.chunks, { type: p.meta.mime }));
          objectUrl.current = url;
          setCurrent({ ...p.meta, progress: 1, url });
          ack(m.id);
          return true;
        }
        case "media_control":
          if (shownId.current === m.id) setControl({ action: m.action, time: m.time, nonce: Date.now() });
          return true;
        case "material_hide":
          if (shownId.current === m.id) clear();
          return true;
        default:
          return false;
      }
    },
    [ack, clear],
  );

  return { current, control, handle, clear };
}

function safeName(title: string, mime: string): string {
  const ext = isPdf(mime) ? ".pdf" : mime.startsWith("image/") ? `.${mime.split("/")[1]!.replace("jpeg", "jpg")}` : mime.startsWith("text/") ? ".txt" : "";
  const base = title.toLocaleLowerCase("tr-TR").replace(/[^a-z0-9çğıöşü]+/g, "-").replace(/^-|-$/g, "") || "materyal";
  return base + ext;
}

export interface MediaReport {
  state: MediaState;
  time: number;
  duration: number;
}
export interface MediaControl {
  action: "play" | "pause" | "seek";
  time?: number;
  /** Aynı komut art arda gelse de etkili olsun diye her mesajda değişir. */
  nonce: number;
}

const YT_ORIGIN = "https://www.youtube-nocookie.com";
// YouTube oynatıcı durum kodları.
const YT_STATE: Record<number, MediaState> = { [-1]: "unstarted", 0: "ended", 1: "playing", 2: "paused", 3: "buffering", 5: "unstarted" };
const MEDIA_TEXT: Record<MediaState, string> = {
  unstarted: "Video başlatılmadı",
  playing: "Oynatılıyor",
  paused: "Duraklatıldı",
  buffering: "Yükleniyor…",
  ended: "Video bitti",
};

/**
 * Kumandalı YouTube oynatıcısı. Oynatıcıyla, YouTube'un gömülü oynatıcı mesajlaşmasıyla
 * (postMessage) konuşulur; dışarıdan betik yüklenmez. Durum terapiste bildirilir, terapistin
 * oynat/duraklat komutları uygulanır.
 */
function YouTubeEmbed({ id, title, videoId, start, closeBtn, control, onMediaState }: {
  id: string;
  title: string;
  videoId: string;
  start: number;
  closeBtn: React.ReactNode;
  control?: MediaControl | null;
  onMediaState?: (id: string, s: MediaReport) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const info = useRef<MediaReport>({ state: "unstarted", time: 0, duration: 0 });
  const [state, setState] = useState<MediaState>("unstarted");

  const post = useCallback((msg: object) => {
    frame.current?.contentWindow?.postMessage(JSON.stringify({ ...msg, id: "mindcare", channel: "widget" }), YT_ORIGIN);
  }, []);
  const command = useCallback((func: string, args: unknown[] = []) => post({ event: "command", func, args }), [post]);

  useEffect(() => {
    let ready = false;
    let lastSent = 0;
    let lastState = "";
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== YT_ORIGIN || e.source !== frame.current?.contentWindow) return;
      let d: { info?: Record<string, unknown> } | null = null;
      try {
        d = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
      } catch {
        return;
      }
      ready = true;
      const i = d?.info;
      if (!i || typeof i !== "object") return;
      if (typeof i.currentTime === "number") info.current.time = Math.floor(i.currentTime);
      if (typeof i.duration === "number" && i.duration > 0) info.current.duration = Math.floor(i.duration);
      if (typeof i.playerState === "number") {
        info.current.state = YT_STATE[i.playerState] ?? info.current.state;
        setState(info.current.state);
      }
      const changed = info.current.state !== lastState;
      const now = Date.now();
      if (!changed && now - lastSent < 3000) return;
      lastState = info.current.state;
      lastSent = now;
      onMediaState?.(id, { ...info.current });
    };
    window.addEventListener("message", onMsg);
    // Oynatıcı hazır olana kadar "dinliyorum" bildirimi yinelenir.
    const t = setInterval(() => {
      if (!ready) post({ event: "listening" });
    }, 500);
    return () => {
      clearInterval(t);
      window.removeEventListener("message", onMsg);
    };
  }, [id, post, onMediaState]);

  useEffect(() => {
    if (!control) return;
    if (control.action === "play") command("playVideo");
    else if (control.action === "pause") command("pauseVideo");
    else command("seekTo", [Math.max(0, control.time ?? 0), true]);
  }, [control, command]);

  // Adres burada, yalnızca doğrulanmış video kimliğinden kurulur; gelen bağlantı gömülmez.
  const src =
    `${YT_ORIGIN}/embed/${videoId}?autoplay=1&playsinline=1&rel=0&enablejsapi=1` +
    `&origin=${encodeURIComponent(window.location.origin)}${start ? `&start=${start}` : ""}`;

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-black/95">
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="flex-1 truncate text-sm text-white">{title}</span>
        {closeBtn}
      </div>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-2">
        <iframe
          ref={frame}
          src={src}
          title={title}
          className="aspect-video max-h-[70%] w-full max-w-4xl rounded-lg border-0 landscape:max-h-full landscape:w-auto"
          allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
        <div className="flex items-center gap-3 text-xs text-white/80">
          <span role="status">{MEDIA_TEXT[state]}</span>
          {state !== "playing" && (
            <button
              onClick={() => command("playVideo")}
              className="flex items-center gap-1.5 rounded-lg bg-accent-strong px-4 py-2 text-sm font-medium text-white"
            >
              <Play size={15} /> Videoyu başlat
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function MaterialView({ item, onClose, control, onMediaState }: {
  item: IncomingMaterial;
  onClose: () => void;
  control?: MediaControl | null;
  onMediaState?: (id: string, s: MediaReport) => void;
}) {
  // Görüşme sayfasından ayrılmadan kaydet (bkz. saveFile).
  const save = async () => {
    if (!item.url) return;
    const blob = await (await fetch(item.url)).blob();
    await saveFile(blob, safeName(item.title, item.mime));
  };
  const closeBtn = (
    <button onClick={onClose} className="rounded-md p-1.5 text-muted hover:bg-card hover:text-ink" aria-label="Kapat">
      <X size={18} />
    </button>
  );

  if (item.kind === "link" && item.link) {
    const yt = parseYouTube(item.link);
    if (yt) {
      return (
        <YouTubeEmbed
          key={item.id}
          id={item.id}
          title={item.title}
          videoId={yt.id}
          start={yt.start}
          closeBtn={closeBtn}
          control={control}
          onMediaState={onMediaState}
        />
      );
    }
    return (
      <div className="absolute inset-x-3 top-16 z-20 rounded-2xl border border-line bg-panel/95 p-4 shadow-2xl backdrop-blur sm:inset-x-auto sm:right-4 sm:w-[380px]">
        <div className="mb-3 flex items-center gap-2">
          <ExternalLink size={18} className="text-accent" />
          <span className="flex-1 truncate font-medium">{item.title}</span>
          {closeBtn}
        </div>
        <p className="mb-3 break-all text-xs text-muted">Terapistiniz bir bağlantı paylaştı: {new URL(item.link).hostname}</p>
        <Button variant="outline" className="w-full py-1.5 text-xs" onClick={() => window.open(item.link, "_blank", "noopener,noreferrer")}>
          <ExternalLink size={14} /> Bağlantıyı yeni sekmede aç
        </Button>
      </div>
    );
  }

  if (!item.url && item.kind !== "quote") {
    return (
      <div className="absolute left-1/2 top-16 z-20 w-[min(90%,360px)] -translate-x-1/2 rounded-xl border border-line bg-panel p-4 shadow-2xl">
        <div className="mb-2 text-sm">Terapistiniz bir materyal paylaşıyor: <b>{item.title}</b></div>
        <div className="h-2 overflow-hidden rounded-full bg-card">
          <div className="h-full bg-accent transition-all" style={{ width: `${Math.round(item.progress * 100)}%` }} />
        </div>
        <div className="mt-1 text-right text-xs text-muted">%{Math.round(item.progress * 100)} • {fmtBytes(item.size)}</div>
      </div>
    );
  }

  if (item.kind === "image" && item.url && isSafeImage(item.mime)) {
    return (
      <div className="absolute inset-0 z-20 flex flex-col bg-black/95">
        <div className="flex items-center gap-2 px-3 py-2">
          <span className="flex-1 truncate text-sm text-white">{item.title}</span>
          <button onClick={() => void save()} className="rounded-md p-1.5 text-muted hover:bg-card hover:text-ink" aria-label="İndir">
            <Download size={18} />
          </button>
          {closeBtn}
        </div>
        <img src={item.url} alt={item.title} className="min-h-0 flex-1 object-contain" />
      </div>
    );
  }

  if (item.kind === "quote") {
    return (
      <div className="absolute inset-x-3 top-1/2 z-20 -translate-y-1/2 rounded-2xl border border-line bg-panel/95 p-6 shadow-2xl backdrop-blur sm:inset-x-auto sm:left-1/2 sm:w-[520px] sm:-translate-x-1/2">
        <div className="mb-3 flex items-center gap-2">
          <Quote size={18} className="text-accent" />
          <span className="flex-1 text-sm text-muted">{item.title}</span>
          {closeBtn}
        </div>
        <p className="whitespace-pre-wrap text-lg leading-relaxed">{item.text}</p>
      </div>
    );
  }

  // Belge: yalnızca PDF tarayıcıda açılır; diğer türler (çalıştırılabilir içerik olabilir) yalnızca indirilir.
  return (
    <div className="absolute inset-x-3 top-16 z-20 rounded-2xl border border-line bg-panel/95 p-4 shadow-2xl backdrop-blur sm:inset-x-auto sm:right-4 sm:w-[380px]">
      <div className="mb-3 flex items-center gap-2">
        <FileText size={18} className="text-accent" />
        <span className="flex-1 truncate font-medium">{item.title}</span>
        {closeBtn}
      </div>
      <p className="mb-3 text-xs text-muted">Terapistiniz bir belge paylaştı • {fmtBytes(item.size)}</p>
      <div className="flex gap-2">
        {isPdf(item.mime) && (
          <Button variant="outline" className="flex-1 py-1.5 text-xs" onClick={() => window.open(item.url, "_blank", "noopener")}>
            <ExternalLink size={14} /> Aç
          </Button>
        )}
        <Button variant="outline" className="flex-1 py-1.5 text-xs" onClick={() => void save()}>
          <Download size={14} /> İndir
        </Button>
      </div>
    </div>
  );
}
