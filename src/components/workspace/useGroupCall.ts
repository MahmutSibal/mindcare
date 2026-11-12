// Terapist tarafı: grup görüşmesi. Oda ve üye başına davetler oluşturulur, GroupCall yönetilir.

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { DEFAULT_PATIENT_APP_URL } from "../../lib/config";
import {
  addGroupInvite, createGroupRoom, GroupCall, MAX_GROUP_GUESTS, type GroupInvite, type GroupPeer,
} from "../../lib/groupRtc";
import { buildIceServers, type CallState, type ChannelMessage, getLocalMedia } from "../../lib/rtc";

export function useGroupCall() {
  const [state, setState] = useState<CallState>("idle");
  const [peers, setPeers] = useState<GroupPeer[]>([]);
  const [local, setLocal] = useState<MediaStream | null>(null);
  const [screen, setScreen] = useState<MediaStream | null>(null);
  const [invites, setInvites] = useState<GroupInvite[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const callRef = useRef<GroupCall | null>(null);
  const localRef = useRef<MediaStream | null>(null);
  localRef.current = local;
  const listeners = useRef(new Set<(m: ChannelMessage, from: string) => void>());

  const onMessage = useCallback((fn: (m: ChannelMessage, from: string) => void) => {
    listeners.current.add(fn);
    return () => {
      listeners.current.delete(fn);
    };
  }, []);

  const start = useCallback(async (members: { id: string; name: string }[]) => {
    setError(null);
    if (members.length === 0) return setError("Grupta danışan yok. Önce üye ekleyin.");
    if (members.length > MAX_GROUP_GUESTS) return setError(`Bir grup görüşmesine en fazla ${MAX_GROUP_GUESTS} danışan katılabilir.`);
    try {
      const media = localRef.current ?? (await getLocalMedia());
      setLocal(media);
      setMicOn(media.getAudioTracks().some((t) => t.enabled));
      setCamOn(media.getVideoTracks().some((t) => t.enabled));
      const settings = await api.getSettings();
      const ttl = Math.max(Number(settings.invite_ttl_minutes ?? 30) || 30, 30);
      const url = settings.patient_app_url || DEFAULT_PATIENT_APP_URL;
      let ice = buildIceServers({ url: settings.turn_url ?? "", username: settings.turn_username ?? "", credential: settings.turn_credential ?? "" });
      try {
        const cf = await api.generateTurnServers();
        if (cf?.length) ice = cf;
      } catch {
        /* TURN yoksa yalnızca doğrudan bağlantı denenir */
      }
      const room = await createGroupRoom(Math.max(members.length, 1));
      const made = await Promise.all(members.map((m) => addGroupInvite(url, room, ttl, m)));
      setInvites(made);
      const call = new GroupCall("host", room, media, { name: "Terapist", member: null }, {
        onState: setState,
        onPeers: setPeers,
        onMessage: (m, from) => listeners.current.forEach((fn) => fn(m, from)),
      }, ice, members.length);
      callRef.current = call;
      await call.start();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState("failed");
      callRef.current = null;
    }
  }, []);

  const stopScreen = useCallback(() => {
    screen?.getTracks().forEach((t) => t.stop());
    setScreen(null);
    callRef.current?.replaceTrack("video", localRef.current?.getVideoTracks()[0] ?? null);
    void callRef.current?.setVideoProfile("camera");
  }, [screen]);

  const shareScreen = async () => {
    if (screen) return stopScreen();
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 30 } }, audio: false });
      s.getVideoTracks()[0]!.onended = () => stopScreen();
      setScreen(s);
      callRef.current?.replaceTrack("video", s.getVideoTracks()[0]!);
      await callRef.current?.setVideoProfile("screen");
    } catch {
      /* kullanıcı vazgeçti */
    }
  };

  const hangup = useCallback(async () => {
    screen?.getTracks().forEach((t) => t.stop());
    setScreen(null);
    await callRef.current?.hangup();
    callRef.current = null;
    localRef.current?.getTracks().forEach((t) => t.stop());
    setLocal(null);
    setPeers([]);
    setInvites([]);
    setState("idle");
  }, [screen]);

  const toggleMic = () => {
    const next = !micOn;
    localRef.current?.getAudioTracks().forEach((t) => (t.enabled = next));
    setMicOn(next);
  };
  const toggleCam = () => {
    const next = !camOn;
    localRef.current?.getVideoTracks().forEach((t) => (t.enabled = next));
    setCamOn(next);
  };

  // Pencere kapanırken oda kapatılır.
  useEffect(() => {
    const bye = () => void callRef.current?.hangup();
    window.addEventListener("pagehide", bye);
    return () => window.removeEventListener("pagehide", bye);
  }, []);

  const inCall = state !== "idle" && state !== "ended" && state !== "failed";
  return {
    state, peers, local, screen, invites, error, micOn, camOn, inCall,
    start, hangup, toggleMic, toggleCam, shareScreen, onMessage,
    sendMessage: (m: ChannelMessage, to?: string) => callRef.current?.sendMessage(m, to) ?? false,
  };
}

export type GroupCallApi = ReturnType<typeof useGroupCall>;
