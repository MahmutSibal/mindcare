import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { DEFAULT_PATIENT_APP_URL } from "../../lib/config";
import {
  buildIceServers, Call, type CallState, type CallStats, type ChannelMessage, createInvite, getLocalMedia, type Invite,
} from "../../lib/rtc";

/** Terapist tarafı görüşme durumu: yerel medya, davet, bağlantı ve ekran paylaşımı. */
export function useCall() {
  const [local, setLocal] = useState<MediaStream | null>(null);
  const [remote, setRemote] = useState<MediaStream | null>(null);
  const [state, setState] = useState<CallState>("idle");
  const [stats, setStats] = useState<CallStats | null>(null);
  const [invite, setInvite] = useState<Invite | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [screen, setScreen] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [turnWarning, setTurnWarning] = useState<string | null>(null);
  const callRef = useRef<Call | null>(null);
  const localRef = useRef<MediaStream | null>(null);
  localRef.current = local;
  // Danışandan gelen veri kanalı mesajlarını dinleyen bileşenler (ör. test cevapları).
  const listeners = useRef(new Set<(m: ChannelMessage) => void>());
  const onMessage = useCallback((fn: (m: ChannelMessage) => void) => {
    listeners.current.add(fn);
    return () => {
      listeners.current.delete(fn);
    };
  }, []);

  const ensureLocal = useCallback(async () => {
    if (localRef.current) return localRef.current;
    const s = await getLocalMedia();
    setLocal(s);
    setMicOn(s.getAudioTracks().some((t) => t.enabled));
    setCamOn(s.getVideoTracks().some((t) => t.enabled));
    return s;
  }, []);

  const start = useCallback(async () => {
    setError(null);
    try {
      const media = await ensureLocal();
      const settings = await api.getSettings();
      const ttl = Number(settings.invite_ttl_minutes ?? 30) || 30;
      const inv = await createInvite(settings.patient_app_url || DEFAULT_PATIENT_APP_URL, ttl);
      // Öncelik Cloudflare TURN (her görüşme için geçici kimlik bilgisi); yoksa elle girilmiş
      // TURN; o da yoksa yalnızca STUN. Cloudflare'e ulaşılamazsa görüşme yine başlar.
      let ice = buildIceServers({
        url: settings.turn_url ?? "",
        username: settings.turn_username ?? "",
        credential: settings.turn_credential ?? "",
      });
      setTurnWarning(null);
      try {
        const cf = await api.generateTurnServers();
        if (cf?.length) ice = cf;
      } catch (e) {
        setTurnWarning(
          `TURN sunucusu alınamadı (${e instanceof Error ? e.message : String(e)}). Görüşme yalnızca doğrudan bağlantıyla denenecek; bazı ağlarda bağlanamayabilir.`,
        );
      }
      const call = new Call("host", inv.room, media, {
        onState: setState,
        onRemoteStream: setRemote,
        onStats: setStats,
        onMessage: (m) => listeners.current.forEach((fn) => fn(m)),
      }, ice);
      callRef.current = call;
      setInvite(inv);
      await call.start();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState("failed");
      callRef.current = null;
    }
  }, [ensureLocal]);

  const stopScreen = useCallback(() => {
    screen?.getTracks().forEach((t) => t.stop());
    setScreen(null);
    const cam = localRef.current?.getVideoTracks()[0] ?? null;
    callRef.current?.replaceTrack("video", cam);
    callRef.current?.setVideoProfile("camera");
  }, [screen]);

  // ── Materyal videosu: bilgisayarda oynatılır, görüntüsü kameranın, sesi (terapistin
  //    mikrofonuyla karıştırılarak) mikrofonun yerine danışana gider. Dosya gönderilmez.
  const [videoShare, setVideoShare] = useState<VideoShare | null>(null);
  const [videoPaused, setVideoPaused] = useState(false);
  const videoRef = useRef<VideoShare | null>(null);
  videoRef.current = videoShare;

  const stopVideo = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.el.pause();
    v.el.removeAttribute("src");
    v.ctx.close().catch(() => {});
    URL.revokeObjectURL(v.url);
    videoRef.current = null;
    setVideoShare(null);
    callRef.current?.replaceTrack("video", localRef.current?.getVideoTracks()[0] ?? null);
    callRef.current?.replaceTrack("audio", localRef.current?.getAudioTracks()[0] ?? null);
  }, []);

  const showVideo = async (bytes: ArrayBuffer, mime: string, title: string) => {
    if (screen) stopScreen();
    stopVideo();
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    const el = document.createElement("video");
    el.src = url;
    el.playsInline = true;
    const ctx = new AudioContext();
    const fail = (msg: string) => {
      ctx.close().catch(() => {});
      URL.revokeObjectURL(url);
      return new Error(msg);
    };
    const mixed = ctx.createMediaStreamDestination();
    const source = ctx.createMediaElementSource(el);
    source.connect(ctx.destination); // terapist de duysun
    source.connect(mixed);
    const mic = localRef.current?.getAudioTracks()[0];
    if (mic) ctx.createMediaStreamSource(new MediaStream([mic])).connect(mixed);
    try {
      await el.play();
    } catch {
      throw fail("Video oynatılamadı. Dosya biçimi desteklenmiyor olabilir; MP4 veya WebM kullanın.");
    }
    const vtrack = (el as HTMLVideoElement & { captureStream(): MediaStream }).captureStream().getVideoTracks()[0];
    if (!vtrack) throw fail("Videodan görüntü alınamadı.");
    el.onplay = () => setVideoPaused(false);
    el.onpause = () => setVideoPaused(true);
    callRef.current?.replaceTrack("video", vtrack);
    callRef.current?.replaceTrack("audio", mixed.stream.getAudioTracks()[0] ?? null);
    callRef.current?.setVideoProfile("camera");
    setVideoPaused(false);
    setVideoShare({ el, stream: new MediaStream([vtrack]), ctx, url, title });
  };

  const hangup = useCallback(async () => {
    stopVideo();
    const call = callRef.current;
    callRef.current = null;
    await call?.hangup();
    screen?.getTracks().forEach((t) => t.stop());
    setScreen(null);
    localRef.current?.getTracks().forEach((t) => t.stop());
    setLocal(null);
    setRemote(null);
    setInvite(null);
    setStats(null);
    setState("idle");
  }, [screen, stopVideo]);

  const toggleMic = () => {
    const next = !micOn;
    localRef.current?.getAudioTracks().forEach((t) => (t.enabled = next));
    setMicOn(next);
  };

  const toggleCam = async () => {
    if (!localRef.current) {
      try {
        await ensureLocal();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
      return;
    }
    const next = !camOn;
    localRef.current.getVideoTracks().forEach((t) => (t.enabled = next));
    setCamOn(next);
  };

  const shareScreen = async () => {
    if (screen) return stopScreen();
    stopVideo();
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 15, max: 30 } },
        audio: false,
      });
      const track = s.getVideoTracks()[0]!;
      // Kodlayıcıya içeriğin metin/ayrıntı olduğunu söyler: netlik akıcılıktan önce gelir.
      track.contentHint = "detail";
      track.onended = () => {
        setScreen(null);
        callRef.current?.replaceTrack("video", localRef.current?.getVideoTracks()[0] ?? null);
        callRef.current?.setVideoProfile("camera");
      };
      callRef.current?.replaceTrack("video", track);
      callRef.current?.setVideoProfile("screen");
      setScreen(s);
    } catch {
      /* kullanıcı vazgeçti */
    }
  };

  /** Danışana mesaj gönderir; görüşme yoksa veya kanal açık değilse `false` döner. */
  const sendMessage = (m: ChannelMessage): boolean => callRef.current?.sendMessage(m) ?? false;
  /** Büyük aktarımlar için kanal tamponunu bekleyerek gönderir. */
  const sendBuffered = (m: ChannelMessage): Promise<boolean> =>
    callRef.current?.sendBuffered(m) ?? Promise.resolve(false);

  // Bileşen kaldırılırsa (uygulama kapanırken) bağlantıyı ve cihazları kapat.
  useEffect(() => () => {
    callRef.current?.hangup();
    localRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  return {
    local, remote, state, stats, invite, micOn, camOn, screen, error, turnWarning, videoShare, videoPaused,
    inCall: callRef.current !== null || (state !== "idle" && state !== "ended" && state !== "failed"),
    start, hangup, toggleMic, toggleCam, shareScreen, stopScreen, sendMessage, sendBuffered, onMessage, ensureLocal,
    showVideo, stopVideo,
    clearError: () => setError(null),
  };
}

export type CallApi = ReturnType<typeof useCall>;

/** Danışana yayınlanan materyal videosu. */
export interface VideoShare {
  el: HTMLVideoElement;
  /** Önizleme için yalnızca görüntü izi. */
  stream: MediaStream;
  ctx: AudioContext;
  url: string;
  title: string;
}
