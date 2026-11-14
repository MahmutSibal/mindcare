import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Maximize2 } from "lucide-react";

/**
 * Görüşme ekranından başka yere (Seans, Danışan, başka sayfa) geçildiğinde karşı tarafın görüntüsünü
 * küçük, sürüklenebilir bir pencerede gösterir. Dokununca görüşme ekranına döner.
 * Ses görüşme ekranındaki öğeden çalmaya devam eder; burası sessizdir (çift ses olmasın).
 */
export default function FloatingVideo({ stream, label, onOpen }: { stream: MediaStream; label: string; onOpen: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const box = useRef<HTMLDivElement>(null);
  // Konum ekranın sağ altından uzaklık olarak tutulur; ekran dönünce de köşede kalır.
  const [pos, setPos] = useState({ right: 12, bottom: 84 });
  const drag = useRef<{ x: number; y: number; right: number; bottom: number; moved: boolean } | null>(null);

  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);

  const onDown = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, right: pos.right, bottom: pos.bottom, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 6) d.moved = true;
    const w = box.current?.offsetWidth ?? 160;
    const h = box.current?.offsetHeight ?? 120;
    setPos({
      right: Math.min(Math.max(4, d.right - dx), window.innerWidth - w - 4),
      bottom: Math.min(Math.max(4, d.bottom - dy), window.innerHeight - h - 4),
    });
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved) onOpen();
  };

  return createPortal(
    <div
      ref={box}
      role="button"
      aria-label="Görüşme ekranına dön"
      title="Görüşmeye dön (sürükleyerek taşıyabilirsiniz)"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={() => (drag.current = null)}
      className="fixed z-[60] aspect-[4/3] w-40 cursor-pointer touch-none overflow-hidden rounded-xl border border-line bg-black shadow-2xl sm:w-48"
      style={{ right: pos.right, bottom: pos.bottom }}
    >
      <video ref={ref} autoPlay playsInline muted className="pointer-events-none h-full w-full object-cover" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/70 to-transparent px-2 pb-1 pt-4 text-[11px] text-white">
        <span className="truncate">{label}</span>
        <Maximize2 size={12} />
      </div>
    </div>,
    document.body,
  );
}
