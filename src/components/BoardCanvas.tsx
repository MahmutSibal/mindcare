import { useCallback, useEffect, useRef, useState } from "react";
import { Eraser, Pencil, Trash2, Type, Undo2 } from "lucide-react";
import { BoardState, COLORS, draw, loadImage, newId, type BoardMessage, type Pt, WIDTHS } from "../lib/board";
import { cx } from "./ui";

type Tool = "pen" | "eraser" | "text";

/** Çizgi parçaları bu aralıkla karşıya gönderilir (canlı görünsün, kanal da boğulmasın). */
const SEND_EVERY_MS = 50;

/**
 * Ortak tuval. Fare, parmak ve kalem aynı "pointer" olaylarıyla çalışır; telefon ve bilgisayar için
 * ayrı kod yoktur. Çizim oranlı koordinatlarla tutulur, 4:3 alana sığdırılır.
 */
export default function BoardCanvas({ board, rev, sessionId, send, onChange, background = "#152629", backdropUrl = null }: {
  board: BoardState;
  /** Uzaktan gelen değişikliklerde artar; tuval yeniden çizilir. */
  rev: number;
  sessionId: string;
  send: (m: BoardMessage) => boolean;
  /** Yerel değişiklikten sonra çağrılır. */
  onChange: () => void;
  background?: string;
  /** Arka plan görseli (gösterilen materyal); iki taraf da üstüne çizer. */
  backdropUrl?: string | null;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState<string>(COLORS[1]);
  const [width, setWidth] = useState<number>(WIDTHS[1]);
  const [textAt, setTextAt] = useState<{ x: number; y: number } | null>(null);
  const [textVal, setTextVal] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const mine = useRef<string[]>([]);
  const active = useRef<{ id: string; color: string; width: number; erase: boolean; pending: Pt[]; timer: ReturnType<typeof setInterval> } | null>(null);
  const raf = useRef(0);
  // Görsel bir kez yüklenir ve oturum boyunca korunur; adres sonradan iptal edilse de çizim bozulmaz.
  const [backdrop, setBackdrop] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!backdropUrl) return;
    let live = true;
    loadImage(backdropUrl).then((i) => live && setBackdrop(i)).catch(() => {});
    return () => {
      live = false;
    };
  }, [backdropUrl]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      let w = r.width;
      let h = (w * 3) / 4;
      if (h > r.height) {
        h = r.height;
        w = (h * 4) / 3;
      }
      setSize({ w: Math.max(0, Math.floor(w)), h: Math.max(0, Math.floor(h)) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const redraw = useCallback(() => {
    const c = cv.current;
    if (!c || !size.w) return;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(size.w * dpr)) {
      c.width = Math.round(size.w * dpr);
      c.height = Math.round(size.h * dpr);
    }
    const ctx = c.getContext("2d")!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    draw(ctx, c.width, c.height, board.elements, background, backdrop);
  }, [board, size, background, backdrop]);

  useEffect(redraw, [redraw, rev]);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  // Hareket sırasında en fazla kare başına bir kez çiz.
  const schedule = () => {
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      redraw();
    });
  };

  const point = (clientX: number, clientY: number): Pt => {
    const r = cv.current!.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (clientY - r.top) / r.height));
    return [x, y];
  };

  const flush = () => {
    const a = active.current;
    if (!a || a.pending.length === 0) return;
    send({ type: "board_stroke", sessionId, id: a.id, color: a.color, width: a.width, erase: a.erase, pts: a.pending });
    a.pending = [];
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    const p = point(e.clientX, e.clientY);
    if (tool === "text") {
      setTextAt({ x: p[0], y: p[1] });
      setTextVal("");
      return;
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* bazı cihazlarda yakalama desteklenmez; çizim yine çalışır */
    }
    const erase = tool === "eraser";
    const id = newId();
    const s = { id, color: erase ? COLORS[0] : color, width, erase };
    board.addStroke({ ...s, pts: [p] });
    mine.current.push(id);
    active.current = { ...s, pending: [p], timer: setInterval(flush, SEND_EVERY_MS) };
    schedule();
  };

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const a = active.current;
    if (!a) return;
    const native = e.nativeEvent as PointerEvent & { getCoalescedEvents?: () => PointerEvent[] };
    const events = native.getCoalescedEvents?.() ?? [native];
    const pts = (events.length ? events : [native]).map((ev) => point(ev.clientX, ev.clientY));
    board.addStroke({ id: a.id, color: a.color, width: a.width, erase: a.erase, pts });
    a.pending.push(...pts);
    schedule();
  };

  const onUp = () => {
    const a = active.current;
    if (!a) return;
    flush();
    clearInterval(a.timer);
    active.current = null;
    onChange();
  };

  const commitText = () => {
    const at = textAt;
    const text = textVal.trim();
    setTextAt(null);
    setTextVal("");
    if (!at || !text) return;
    const el = { id: newId(), kind: "text" as const, color, size: 0.045, x: Math.min(at.x, 0.9), y: Math.min(at.y, 0.93), text: text.slice(0, 300) };
    board.addText(el);
    mine.current.push(el.id);
    send({ type: "board_text", sessionId, el });
    redraw();
    onChange();
  };

  const undo = () => {
    const id = mine.current.pop();
    if (!id) return;
    board.undo(id);
    send({ type: "board_undo", sessionId, id });
    redraw();
    onChange();
  };

  const clear = () => {
    if (!confirmClear) {
      setConfirmClear(true);
      setTimeout(() => setConfirmClear(false), 3000);
      return;
    }
    setConfirmClear(false);
    board.clear();
    mine.current = [];
    send({ type: "board_clear", sessionId });
    redraw();
    onChange();
  };

  const toolBtn = (id: Tool, Icon: typeof Pencil, label: string) => (
    <button
      key={id}
      onClick={() => setTool(id)}
      aria-pressed={tool === id}
      aria-label={label}
      title={label}
      className={cx("flex h-9 w-9 items-center justify-center rounded-lg border", tool === id ? "border-accent bg-accent-soft text-accent" : "border-line bg-card text-ink hover:bg-line")}
    >
      <Icon size={17} />
    </button>
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <div className="flex gap-1">
          {toolBtn("pen", Pencil, "Kalem")}
          {toolBtn("eraser", Eraser, "Silgi")}
          {toolBtn("text", Type, "Yazı")}
        </div>
        <div className="flex items-center gap-1" role="radiogroup" aria-label="Renk">
          {COLORS.map((c) => (
            <button
              key={c}
              role="radio"
              aria-checked={color === c}
              aria-label={`Renk ${c}`}
              onClick={() => {
                setColor(c);
                if (tool === "eraser") setTool("pen");
              }}
              className={cx("h-6 w-6 rounded-full border-2", color === c && tool !== "eraser" ? "border-white" : "border-transparent")}
              style={{ background: c }}
            />
          ))}
        </div>
        <div className="flex items-center gap-1" role="radiogroup" aria-label="Kalınlık">
          {WIDTHS.map((w) => (
            <button
              key={w}
              role="radio"
              aria-checked={width === w}
              aria-label={`Kalınlık ${w}`}
              onClick={() => setWidth(w)}
              className={cx("flex h-8 w-8 items-center justify-center rounded-lg border", width === w ? "border-accent bg-accent-soft" : "border-line bg-card")}
            >
              <span className="rounded-full bg-ink" style={{ width: w + 3, height: w + 3 }} />
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-1">
          <button onClick={undo} aria-label="Geri al" title="Geri al (yalnızca kendi çizdiklerinizi)" className="flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-card text-ink hover:bg-line">
            <Undo2 size={17} />
          </button>
          <button
            onClick={clear}
            aria-label="Hepsini temizle"
            className={cx("flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-xs", confirmClear ? "border-danger bg-danger/20 text-danger" : "border-line bg-card text-ink hover:bg-line")}
          >
            <Trash2 size={15} /> {confirmClear ? "Emin misiniz?" : "Temizle"}
          </button>
        </div>
      </div>

      <div ref={wrap} className="flex min-h-0 flex-1 items-center justify-center">
        <div className="relative" style={{ width: size.w, height: size.h }}>
          <canvas
            ref={cv}
            style={{ width: size.w, height: size.h, touchAction: "none", cursor: tool === "text" ? "text" : "crosshair" }}
            className="block rounded-xl border border-line"
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            role="img"
            aria-label="Ortak çizim tuvali"
          />
          {textAt && (
            <input
              autoFocus
              value={textVal}
              onChange={(e) => setTextVal(e.target.value)}
              onBlur={commitText}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitText();
                if (e.key === "Escape") {
                  setTextAt(null);
                  setTextVal("");
                }
              }}
              maxLength={300}
              placeholder="Yazın, Enter ile ekleyin"
              className="absolute z-10 w-44 rounded-md border border-accent bg-bg px-2 py-1 text-sm text-ink outline-none"
              style={{ left: Math.min(textAt.x * size.w, size.w - 180), top: Math.min(textAt.y * size.h, size.h - 34) }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
