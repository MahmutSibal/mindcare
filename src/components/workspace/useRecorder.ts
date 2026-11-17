// Seans kaydı (terapist tarafı). Görüntü: danışan + terapist kameraları ve açıksa ortak çizim tek bir
// tuvalde birleştirilir; ses: iki mikrofon karıştırılır. Parçalar 4 sn'de bir şifreli veritabanına yazılır.
// Kayıt YALNIZCA danışan görüşme sırasında açıkça kabul ederse başlar; danışan istediği an durdurabilir.

import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorText } from "../../lib/api";
import { draw, loadImage } from "../../lib/board";
import type { CallApi } from "./useCall";
import type { BoardApi } from "../../lib/useBoard";

const W = 960;
const H = 540;
const BG = "#0f1b1d";
const BOARD_BG = "#152629";
const ASK_TIMEOUT_MS = 60_000;

export type RecStatus = "idle" | "asking" | "recording" | "saving";

function pickMime(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  return ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m)) ?? null;
}

function drawContain(ctx: CanvasRenderingContext2D, v: HTMLVideoElement, x: number, y: number, w: number, h: number) {
  if (!v.videoWidth || !v.videoHeight) return;
  const k = Math.min(w / v.videoWidth, h / v.videoHeight);
  const dw = v.videoWidth * k;
  const dh = v.videoHeight * k;
  ctx.drawImage(v, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

function videoEl(stream: MediaStream | null): HTMLVideoElement {
  const v = document.createElement("video");
  v.muted = true; // ses AudioContext üzerinden alınır, hoparlöre ikinci kez çıkmaz
  v.playsInline = true;
  v.srcObject = stream;
  void v.play().catch(() => {});
  return v;
}

interface Composer {
  stream: MediaStream;
  stop: () => void;
}

/** Kameraları ve (açıksa) ortak çizimi tek tuvalde birleştirir; sesleri karıştırır. */
function createComposer(opts: {
  remote: MediaStream | null;
  local: MediaStream | null;
  getBoard: () => { active: boolean; elements: Parameters<typeof draw>[3] };
  getBackdropUrl: () => string | null;
}): Composer {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const board = document.createElement("canvas");
  board.width = 720;
  board.height = 540;
  const bctx = board.getContext("2d")!;
  const rv = videoEl(opts.remote);
  const lv = videoEl(opts.local);
  let backdrop: HTMLImageElement | null = null;
  let backdropUrl: string | null = null;

  const render = () => {
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);
    const b = opts.getBoard();
    const url = opts.getBackdropUrl();
    if (url !== backdropUrl) {
      backdropUrl = url;
      backdrop = null;
      if (url) loadImage(url).then((i) => (backdrop = i)).catch(() => {});
    }
    if (b.active) {
      // Solda ortak çizim (4:3), sağda iki kamera alt alta.
      draw(bctx, board.width, board.height, b.elements, BOARD_BG, backdrop);
      ctx.drawImage(board, 0, 0, 720, 540);
      const x = 728;
      const cw = W - x - 8;
      const ch = (H - 24) / 2;
      drawContain(ctx, rv, x, 8, cw, ch);
      drawContain(ctx, lv, x, 16 + ch, cw, ch);
    } else {
      drawContain(ctx, rv, 0, 0, W, H);
      // Terapistin kendi görüntüsü sağ altta küçük
      const pw = 240;
      const ph = 135;
      ctx.save();
      ctx.fillStyle = "#000";
      ctx.fillRect(W - pw - 14, H - ph - 14, pw + 4, ph + 4);
      ctx.restore();
      drawContain(ctx, lv, W - pw - 12, H - ph - 12, pw, ph);
    }
  };
  render();
  const timer = setInterval(render, 50);

  // Ses: terapist mikrofonu + danışan sesi tek akışta.
  const ac = new AudioContext();
  const dest = ac.createMediaStreamDestination();
  for (const s of [opts.local, opts.remote]) {
    const tracks = s?.getAudioTracks() ?? [];
    if (tracks.length) ac.createMediaStreamSource(new MediaStream(tracks)).connect(dest);
  }
  void ac.resume().catch(() => {});

  const stream = canvas.captureStream(20);
  dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
  return {
    stream,
    stop: () => {
      clearInterval(timer);
      stream.getTracks().forEach((t) => t.stop());
      rv.srcObject = null;
      lv.srcObject = null;
      void ac.close().catch(() => {});
    },
  };
}

export function useRecorder(opts: {
  call: CallApi;
  boardApi: BoardApi;
  backdropUrl: string | null;
  patientId: string | null;
  sessionId: string | null;
}) {
  const { call } = opts;
  const [status, setStatus] = useState<RecStatus>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const o = useRef(opts);
  o.current = opts;
  const statusRef = useRef<RecStatus>("idle");
  statusRef.current = status;
  const run = useRef<{ id: string; rec: MediaRecorder; composer: Composer; started: number; queue: Promise<void>; seq: number; failed: boolean } | null>(null);
  const askTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const consentAt = useRef<string>("");

  const finish = useCallback(async () => {
    const r = run.current;
    if (!r) return;
    run.current = null;
    setStatus("saving");
    call.sendMessage({ type: "record_state", active: false });
    await new Promise<void>((res) => {
      r.rec.onstop = () => res();
      try {
        if (r.rec.state !== "inactive") r.rec.stop();
        else res();
      } catch {
        res();
      }
    });
    r.composer.stop();
    await r.queue;
    try {
      await api.finishRecording(r.id, Math.round((Date.now() - r.started) / 1000));
      setNotice(r.failed ? "Kayıt tamamlandı ancak bazı parçalar kaydedilemedi." : "Kayıt danışan dosyasına kaydedildi (Çalışmalar sekmesi).");
    } catch (e) {
      setNotice(`Kayıt tamamlanamadı: ${errorText(e)}`);
    }
    setElapsed(0);
    setStatus("idle");
  }, [call]);

  const begin = useCallback(async () => {
    const cur = o.current;
    const mime = pickMime();
    if (!mime || !cur.patientId) {
      setStatus("idle");
      setNotice("Bu cihaz kayıt almayı desteklemiyor.");
      return;
    }
    try {
      const id = await api.startRecording(cur.patientId, cur.sessionId, mime, consentAt.current);
      const composer = createComposer({
        remote: cur.call.remote,
        local: cur.call.local,
        getBoard: () => ({ active: !!o.current.boardApi.session, elements: o.current.boardApi.board.elements }),
        getBackdropUrl: () => o.current.backdropUrl,
      });
      const rec = new MediaRecorder(composer.stream, { mimeType: mime, videoBitsPerSecond: 900_000, audioBitsPerSecond: 64_000 });
      const r = { id, rec, composer, started: Date.now(), queue: Promise.resolve(), seq: 0, failed: false };
      rec.ondataavailable = (e) => {
        if (!e.data.size) return;
        const seq = r.seq++;
        r.queue = r.queue
          .then(async () => api.appendRecordingChunk(id, seq, new Uint8Array(await e.data.arrayBuffer())))
          .catch(() => {
            r.failed = true;
          });
      };
      rec.onerror = () => void finish();
      run.current = r;
      rec.start(4000);
      setElapsed(0);
      setStatus("recording");
      setNotice(null);
      call.sendMessage({ type: "record_state", active: true });
    } catch (e) {
      setStatus("idle");
      setNotice(`Kayıt başlatılamadı: ${errorText(e)}`);
    }
  }, [call, finish]);

  /** Danışandan kayıt izni ister. Kayıt, danışan kabul edene kadar başlamaz. */
  const request = useCallback(() => {
    if (statusRef.current !== "idle") return;
    if (!o.current.patientId || call.state !== "connected") {
      setNotice("Kayıt için görüşmenin bağlı olması gerekir.");
      return;
    }
    if (!pickMime()) {
      setNotice("Bu cihaz kayıt almayı desteklemiyor.");
      return;
    }
    if (!call.sendMessage({ type: "record_request" })) {
      setNotice("Danışana ulaşılamadı. Bağlantıyı kontrol edin.");
      return;
    }
    setNotice(null);
    setStatus("asking");
    askTimer.current = setTimeout(() => {
      if (statusRef.current === "asking") {
        setStatus("idle");
        setNotice("Danışan yanıt vermedi; kayıt başlatılmadı.");
      }
    }, ASK_TIMEOUT_MS);
  }, [call]);

  const cancelAsk = useCallback(() => {
    if (askTimer.current) clearTimeout(askTimer.current);
    setStatus("idle");
  }, []);

  // Danışanın yanıtı ve danışanın durdurma isteği.
  const { onMessage } = call;
  useEffect(
    () =>
      onMessage((m) => {
        if (m.type === "record_response" && statusRef.current === "asking") {
          if (askTimer.current) clearTimeout(askTimer.current);
          if (m.accepted === true) {
            consentAt.current = new Date().toISOString();
            void begin();
          } else {
            setStatus("idle");
            setNotice("Danışan kaydı kabul etmedi; kayıt yapılmadı.");
          }
        }
        if (m.type === "record_stop" && run.current) void finish();
      }),
    [onMessage, begin, finish],
  );

  // Süre sayacı
  useEffect(() => {
    if (status !== "recording") return;
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [status]);

  // Görüşme bitince kayıt da biter; bileşen kapanırken de.
  useEffect(() => {
    if (!call.inCall && run.current) void finish();
    if (!call.inCall && statusRef.current === "asking") cancelAsk();
  }, [call.inCall, finish, cancelAsk]);
  useEffect(
    () => () => {
      if (run.current) void finish();
    },
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  return { status, elapsed, notice, request, cancelAsk, stop: finish, clearNotice: () => setNotice(null), supported: pickMime() !== null };
}
