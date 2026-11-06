// Danışan tarafı: terapistin verdiği ödevler. Bu sayfa görüşme bitince kapandığı için
// danışan ödevi indirip (metin dosyası) veya kopyalayıp saklar; hiçbir yerde tutulmaz.

import { useState } from "react";
import { Check, Copy, Download, FileSignature, X } from "lucide-react";
import type { ChannelMessage } from "../src/lib/rtc";
import { Button } from "../src/components/ui";

export type HomeworkMessage = Extract<ChannelMessage, { type: "homework" }>;

function fmtDay(iso: string): string {
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${d}.${m}.${y}` : iso;
}

function asText(h: HomeworkMessage): string {
  const lines = [
    "MindCare – Ödev",
    "",
    h.title,
    `Verilme tarihi: ${new Date().toLocaleDateString("tr-TR")}`,
    ...(h.due ? [`Son tarih: ${fmtDay(h.due)}`] : []),
    "",
    h.description ?? "",
  ];
  return lines.join("\n").trimEnd() + "\n";
}

function download(h: HomeworkMessage) {
  const blob = new Blob([asText(h)], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `odev-${h.title.toLocaleLowerCase("tr-TR").replace(/[^a-z0-9çğıöşü]+/g, "-").replace(/^-|-$/g, "") || "mindcare"}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function HomeworkView({ items, onClose }: { items: HomeworkMessage[]; onClose: () => void }) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (h: HomeworkMessage) => {
    try {
      await navigator.clipboard.writeText(asText(h));
      setCopied(h.id);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      /* pano izni yok */
    }
  };

  return (
    <div className="absolute inset-x-3 top-14 z-20 max-h-[70%] overflow-y-auto rounded-2xl border border-line bg-panel/95 p-4 shadow-2xl backdrop-blur sm:inset-x-auto sm:right-4 sm:w-[420px]">
      <div className="mb-3 flex items-center gap-2">
        <FileSignature size={18} className="text-accent" />
        <span className="flex-1 font-semibold">Ödevleriniz</span>
        <button onClick={onClose} className="rounded-md p-1 text-muted hover:bg-card hover:text-ink" aria-label="Kapat">
          <X size={18} />
        </button>
      </div>
      <ul className="space-y-3">
        {items.map((h) => (
          <li key={h.id} className="rounded-xl bg-card p-3">
            <div className="font-medium">{h.title}</div>
            {h.due && <div className="mt-0.5 text-xs text-warn">Son tarih: {fmtDay(h.due)}</div>}
            {h.description && <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-muted">{h.description}</p>}
            <div className="mt-3 flex gap-2">
              <Button variant="outline" className="flex-1 py-1.5 text-xs" onClick={() => download(h)}>
                <Download size={14} /> İndir
              </Button>
              <Button variant="outline" className="flex-1 py-1.5 text-xs" onClick={() => copy(h)}>
                {copied === h.id ? <Check size={14} /> : <Copy size={14} />} {copied === h.id ? "Kopyalandı" : "Kopyala"}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[11px] leading-relaxed text-faint">
        Bu sayfa görüşme bitince kapanır. Ödevinizi kaybetmemek için indirin veya kopyalayıp notlarınıza ekleyin.
      </p>
    </div>
  );
}
