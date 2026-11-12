// Ortak çizim tahtası: terapist ve danışan istemcisinin ortak mantığı (Tauri'ye bağımlı değil).
// Çizgiler oranlı koordinatlarla (0–1) tutulur; farklı boyuttaki ekranlarda aynı yerde görünür.
// Karşı taraftan gelen veri güvenilmez kabul edilir: her şey `sanitize*` ile doğrulanır.

export type Pt = [number, number];

export type Element =
  | { id: string; kind: "stroke"; color: string; width: number; erase: boolean; pts: Pt[] }
  | { id: string; kind: "text"; color: string; size: number; x: number; y: number; text: string };

/** Kanal mesajları (ChannelMessage'e `board_*` olarak eklenir). */
export type BoardMessage =
  // Terapist → danışan: tahta açıldı; yönerge isteğe bağlı.
  // `backdropId`: tuvalin arka planı olan, daha önce gösterilen görselin kimliği (yoksa boş tuval).
  | { type: "board_open"; sessionId: string; prompt: string | null; backdropId: string | null }
  | { type: "board_close"; sessionId: string }
  // İki yön: çizgi parçaları (canlı) ve tamamlanan öğeler.
  | { type: "board_stroke"; sessionId: string; id: string; color: string; width: number; erase: boolean; pts: Pt[] }
  | { type: "board_text"; sessionId: string; el: Extract<Element, { kind: "text" }> }
  | { type: "board_undo"; sessionId: string; id: string }
  | { type: "board_clear"; sessionId: string }
  // Yeniden bağlanınca iki taraf da tam durumunu gönderir; alıcı birleştirir. `removed`: geri alınan/silinen kimlikler.
  | { type: "board_sync"; sessionId: string; elements: Element[]; removed: string[] };

export const COLORS = ["#e6f0ee", "#4fb3a5", "#e5675f", "#e8b04b", "#6aa8f0", "#b58cf0", "#5cc28a", "#101a1c"] as const;
export const WIDTHS = [2, 5, 10] as const;

const MAX_PTS_PER_STROKE = 6000;
const MAX_ELEMENTS = 2000;
const MAX_TEXT = 300;
const HEX = /^#[0-9a-fA-F]{6}$/;

const clamp01 = (n: unknown): number | null => (typeof n === "number" && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : null);
const safeId = (s: unknown): string | null => (typeof s === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(s) ? s : null);

function cleanPts(pts: unknown): Pt[] | null {
  if (!Array.isArray(pts) || pts.length > MAX_PTS_PER_STROKE) return null;
  const out: Pt[] = [];
  for (const p of pts) {
    if (!Array.isArray(p) || p.length !== 2) return null;
    const x = clamp01(p[0]);
    const y = clamp01(p[1]);
    if (x === null || y === null) return null;
    out.push([x, y]);
  }
  return out;
}

export function sanitizeColor(c: unknown): string {
  return typeof c === "string" && HEX.test(c) ? c : COLORS[0];
}

/** Gelen çizgi parçasını doğrular; geçersizse `null`. */
export function sanitizeStroke(m: { id?: unknown; color?: unknown; width?: unknown; erase?: unknown; pts?: unknown }) {
  const id = safeId(m.id);
  const pts = cleanPts(m.pts);
  if (!id || !pts) return null;
  const width = typeof m.width === "number" && Number.isFinite(m.width) ? Math.min(40, Math.max(1, m.width)) : 4;
  return { id, color: sanitizeColor(m.color), width, erase: m.erase === true, pts };
}

export function sanitizeText(el: unknown): Extract<Element, { kind: "text" }> | null {
  if (!el || typeof el !== "object") return null;
  const e = el as Record<string, unknown>;
  const id = safeId(e.id);
  const x = clamp01(e.x);
  const y = clamp01(e.y);
  if (!id || x === null || y === null || typeof e.text !== "string") return null;
  const text = e.text.slice(0, MAX_TEXT);
  if (!text.trim()) return null;
  const size = typeof e.size === "number" && Number.isFinite(e.size) ? Math.min(0.2, Math.max(0.015, e.size)) : 0.04;
  return { id, kind: "text", color: sanitizeColor(e.color), size, x, y, text };
}

export function sanitizeElements(list: unknown): Element[] {
  if (!Array.isArray(list)) return [];
  const out: Element[] = [];
  for (const e of list.slice(0, MAX_ELEMENTS)) {
    if (e && typeof e === "object" && (e as { kind?: unknown }).kind === "text") {
      const t = sanitizeText(e);
      if (t) out.push(t);
    } else if (e && typeof e === "object") {
      const s = sanitizeStroke(e as Record<string, unknown>);
      if (s) out.push({ ...s, kind: "stroke" });
    }
  }
  return out;
}

/** Tahtanın durumu: öğe listesi ve canlı çizgiye parça ekleme. */
export class BoardState {
  elements: Element[] = [];
  /** Geri alınan veya temizlenen öğelerin kimlikleri; yeniden bağlanınca geri gelmesin diye hatırlanır. */
  removed = new Set<string>();

  addStroke(s: { id: string; color: string; width: number; erase: boolean; pts: Pt[] }): void {
    if (this.removed.has(s.id)) return;
    const existing = this.elements.find((e) => e.id === s.id && e.kind === "stroke");
    if (existing && existing.kind === "stroke") {
      if (existing.pts.length + s.pts.length <= MAX_PTS_PER_STROKE) existing.pts.push(...s.pts);
    } else if (this.elements.length < MAX_ELEMENTS) {
      this.elements.push({ id: s.id, kind: "stroke", color: s.color, width: s.width, erase: s.erase, pts: [...s.pts] });
    }
  }

  addText(t: Extract<Element, { kind: "text" }>): void {
    if (this.removed.has(t.id)) return;
    if (this.elements.length < MAX_ELEMENTS && !this.elements.some((e) => e.id === t.id)) this.elements.push(t);
  }

  undo(id: string): void {
    this.removed.add(id);
    this.elements = this.elements.filter((e) => e.id !== id);
  }

  clear(): void {
    for (const e of this.elements) this.removed.add(e.id);
    this.elements = [];
  }

  /** Yeni oturum: her şey sıfırlanır. */
  reset(): void {
    this.elements = [];
    this.removed = new Set();
  }

  /** Karşı tarafın tam durumunu birleştirir: eksik öğeler eklenir, daha uzun çizgi kısa olanın yerini alır. */
  merge(list: Element[], removed: string[]): void {
    for (const id of removed) {
      if (safeId(id)) this.undo(id);
    }
    for (const e of list) {
      if (this.removed.has(e.id)) continue;
      const mine = this.elements.find((x) => x.id === e.id);
      if (!mine) {
        if (this.elements.length < MAX_ELEMENTS) this.elements.push(e);
      } else if (mine.kind === "stroke" && e.kind === "stroke" && e.pts.length > mine.pts.length) {
        mine.pts = e.pts;
      }
    }
  }
}

/** Tüm öğeleri tuvale çizer. Silgi çizgileri, altındaki çizimi siler. */
export function draw(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  elements: Element[],
  background: string,
  backdrop?: HTMLImageElement | null,
) {
  ctx.save();
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, w, h);
  if (backdrop && backdrop.naturalWidth > 0) {
    // Arka plan görseli oranı bozulmadan ortalanır; çizim ve silgi yalnızca üstteki katmanı etkiler.
    const k = Math.min(w / backdrop.naturalWidth, h / backdrop.naturalHeight);
    const bw = backdrop.naturalWidth * k;
    const bh = backdrop.naturalHeight * k;
    ctx.drawImage(backdrop, (w - bw) / 2, (h - bh) / 2, bw, bh);
  }
  // Silgi için ayrı bir katman: çizimler orada birleşir, silgi o katmanda "destination-out" ile siler.
  const layer = document.createElement("canvas");
  layer.width = w;
  layer.height = h;
  const lc = layer.getContext("2d")!;
  lc.lineCap = "round";
  lc.lineJoin = "round";
  const scale = Math.min(w, h);
  for (const e of elements) {
    if (e.kind === "text") {
      lc.globalCompositeOperation = "source-over";
      lc.fillStyle = e.color;
      lc.font = `${Math.round(e.size * h)}px "Segoe UI", system-ui, sans-serif`;
      lc.textBaseline = "top";
      e.text.split("\n").forEach((line, i) => lc.fillText(line, e.x * w, e.y * h + i * e.size * h * 1.2));
      continue;
    }
    lc.globalCompositeOperation = e.erase ? "destination-out" : "source-over";
    lc.strokeStyle = e.erase ? "#000" : e.color;
    lc.fillStyle = lc.strokeStyle;
    lc.lineWidth = (e.erase ? e.width * 3 : e.width) * (scale / 800);
    const [first, ...rest] = e.pts;
    if (!first) continue;
    if (rest.length === 0) {
      lc.beginPath();
      lc.arc(first[0] * w, first[1] * h, lc.lineWidth / 2, 0, Math.PI * 2);
      lc.fill();
      continue;
    }
    lc.beginPath();
    lc.moveTo(first[0] * w, first[1] * h);
    for (const [x, y] of rest) lc.lineTo(x * w, y * h);
    lc.stroke();
  }
  ctx.drawImage(layer, 0, 0);
  ctx.restore();
}

/** Öğeleri PNG olarak (base64, başlıksız) verir; danışan dosyasına kaydetmek için. */
export function renderPngBase64(
  elements: Element[],
  background: string,
  backdrop: HTMLImageElement | null = null,
  width = 1200,
  height = 900,
): string {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  draw(c.getContext("2d")!, width, height, elements, background, backdrop);
  return c.toDataURL("image/png").replace(/^data:image\/png;base64,/, "");
}

/** Görseli yükler (blob veya data adresi). */
export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Görsel yüklenemedi"));
    img.src = url;
  });
}

export const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 16);
