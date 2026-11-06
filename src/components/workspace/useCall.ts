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
      const ice = buildIceServers({
        url: settings.turn_url ?? "",
        username: settings.turn_username ?? "",
        credential: settings.turn_credential ?? "",
      });
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
  }, [screen]);

  const hangup = useCallback(async () => {
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
  }, [screen]);

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
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const track = s.getVideoTracks()[0]!;
      track.onended = () => {
        setScreen(null);
        callRef.current?.replaceTrack("video", localRef.current?.getVideoTracks()[0] ?? null);
      };
      callRef.current?.replaceTrack("video", track);
      setScreen(s);
    } catch {
      /* kullanıcı vazgeçti */
    }
  };

  /** Danışana mesaj gönderir; görüşme yoksa veya kanal açık değilse `false` döner. */
  const sendMessage = (m: ChannelMessage): boolean => callRef.current?.sendMessage(m) ?? false;

  // Bileşen kaldırılırsa (uygulama kapanırken) bağlantıyı ve cihazları kapat.
  useEffect(() => () => {
    callRef.current?.hangup();
    localRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  return {
    local, remote, state, stats, invite, micOn, camOn, screen, error,
    inCall: callRef.current !== null || (state !== "idle" && state !== "ended" && state !== "failed"),
    start, hangup, toggleMic, toggleCam, shareScreen, stopScreen, sendMessage, onMessage, ensureLocal,
    clearError: () => setError(null),
  };
}

export type CallApi = ReturnType<typeof useCall>;
