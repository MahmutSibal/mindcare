// Danışan tarafı: terapistin gösterdiği materyal (görsel, belge, alıntı).
// Parçalar şifreli veri kanalından gelir, bellekte birleştirilir; hiçbir yere kaydedilmez.

import { useCallback, useRef, useState } from "react";
import { Download, ExternalLink, FileText, Quote, X } from "lucide-react";
import type { ChannelMessage } from "../src/lib/rtc";
import { fmtBytes, fromBase64, isPdf, isSafeImage, MAX_FILE_SHARE_BYTES } from "../src/lib/share";
import { Button } from "../src/components/ui";

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
}

/** Materyal mesajlarını işler. `handle` materyal mesajıysa `true` döner. */
export function useIncomingMaterial(ack: (id: string) => void) {
  const [current, setCurrent] = useState<IncomingMaterial | null>(null);
  // Aktarım durumu ref'lerde tutulur: kanal mesajları ekran yenilenmeden art arda gelebilir,
  // bu yüzden state'in son çizimdeki değerine güvenilmez.
  const parts = useRef<{ meta: IncomingMaterial; chunks: Uint8Array<ArrayBuffer>[]; received: number; lastReport: number } | null>(null);
  const shownId = useRef<string | null>(null);
  const objectUrl = useRef<string | null>(null);

  const clear = useCallback(() => {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = null;
    parts.current = null;
    shownId.current = null;
    setCurrent(null);
  }, []);

  const handle = useCallback(
    (m: ChannelMessage): boolean => {
      switch (m.type) {
        case "material_show": {
          clear();
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
        case "material_hide":
          if (shownId.current === m.id) clear();
          return true;
        default:
          return false;
      }
    },
    [ack, clear],
  );

  return { current, handle, clear };
}

function safeName(title: string, mime: string): string {
  const ext = isPdf(mime) ? ".pdf" : mime.startsWith("image/") ? `.${mime.split("/")[1]!.replace("jpeg", "jpg")}` : mime.startsWith("text/") ? ".txt" : "";
  const base = title.toLocaleLowerCase("tr-TR").replace(/[^a-z0-9çğıöşü]+/g, "-").replace(/^-|-$/g, "") || "materyal";
  return base + ext;
}

export default function MaterialView({ item, onClose }: { item: IncomingMaterial; onClose: () => void }) {
  const closeBtn = (
    <button onClick={onClose} className="rounded-md p-1.5 text-muted hover:bg-card hover:text-ink" aria-label="Kapat">
      <X size={18} />
    </button>
  );

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
          <a href={item.url} download={safeName(item.title, item.mime)} className="rounded-md p-1.5 text-muted hover:bg-card hover:text-ink" aria-label="İndir">
            <Download size={18} />
          </a>
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
        <a
          href={item.url}
          download={safeName(item.title, item.mime)}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-accent/60 px-3.5 py-1.5 text-xs font-medium text-accent hover:bg-accent-soft"
        >
          <Download size={14} /> İndir
        </a>
      </div>
    </div>
  );
}
