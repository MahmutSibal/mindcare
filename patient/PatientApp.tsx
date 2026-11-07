// Danışan web istemcisi: davet bağlantısıyla tarayıcıdan görüşmeye katılım.
// Terapistin yerel veritabanına hiçbir erişimi yoktur; yalnızca görüşme medyası
// ve terapistin paylaştığı kısa bildirimler alınır.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  FileSignature, FileText, HeartHandshake, Lock, Maximize2, Mic, MicOff, PhoneOff, Smartphone, SwitchCamera, Video, VideoOff,
} from "lucide-react";
import { Call, type CallState, type CallStats, type ChannelMessage, getLocalMedia, joinRoom, type JoinResult } from "../src/lib/rtc";
import { Button, cx } from "../src/components/ui";
import TestForm from "./TestForm";
import HomeworkView, { type HomeworkMessage } from "./HomeworkView";
import MaterialView, { useIncomingMaterial } from "./MaterialView";
import WaitingRoom from "./WaitingRoom";

type Phase = "invalid" | "consent" | "joining" | "rejected" | "call" | "left";

// Anahtar adres çubuğundan silinir; sayfa yenilenirse aynı sekmede tekrar katılabilmek için
// yalnızca bu sekmeye ait sessionStorage'da tutulur (sekme kapanınca silinir).
function readInvite(): { room: string; token: string } | null {
  const p = new URLSearchParams(window.location.hash.slice(1));
  let room = p.get("r");
  let token = p.get("t");
  if (!room || !token) {
    try {
      const saved = JSON.parse(sessionStorage.getItem("mindcare-invite") ?? "null");
      room = saved?.room ?? null;
      token = saved?.token ?? null;
    } catch {
      /* depolama yok */
    }
  }
  if (!room || !token || !/^[A-Za-z0-9_-]{22,64}$/.test(room)) return null;
  try {
    sessionStorage.setItem("mindcare-invite", JSON.stringify({ room, token }));
  } catch {
    /* depolama yok */
  }
  return { room, token };
}

const REJECT_TEXT: Partial<Record<JoinResult, string>> = {
  not_found: "Bu davet bağlantısı geçersiz.",
  expired: "Bu davet bağlantısının süresi dolmuş. Terapistinizden yeni bir bağlantı isteyin.",
  used: "Bu davet bağlantısı başka bir cihazda kullanıldı. Davetler tek kullanımlıktır.",
  ended: "Bu görüşme sona erdi.",
  host: "Bu bağlantı terapist hesabıyla açılmış. Lütfen danışan cihazından açın.",
};

function VideoEl({ stream, muted, mirrored, fit = "cover", videoRef, onClick }: {
  stream: MediaStream | null;
  muted?: boolean;
  mirrored?: boolean;
  /** "contain": kırpmadan sığdır (ekran paylaşımı), "cover": ekranı doldur (kamera). */
  fit?: "cover" | "contain";
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  onClick?: () => void;
}) {
  const own = useRef<HTMLVideoElement>(null);
  const ref = videoRef ?? own;
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream, ref]);
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted={muted}
      onClick={onClick}
      className={cx("h-full w-full", fit === "contain" ? "object-contain" : "object-cover", mirrored && "-scale-x-100")}
    />
  );
}

/** Ekran dikey mi; paylaşılan yatay ekranı büyütmek için telefonu yan çevirme ipucu. */
function usePortrait(): boolean {
  const q = () => window.matchMedia?.("(orientation: portrait)").matches ?? false;
  const [portrait, setPortrait] = useState(q);
  useEffect(() => {
    const m = window.matchMedia?.("(orientation: portrait)");
    if (!m) return;
    const on = () => setPortrait(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return portrait;
}

/** Paylaşılan ekranı tam ekran açar. iPhone'da sistemin video oynatıcısı (yakınlaştırma destekli). */
async function enterFullscreen(video: HTMLVideoElement | null, container: HTMLElement | null) {
  const v = video as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
  try {
    if (container?.requestFullscreen) {
      await container.requestFullscreen();
      await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.("landscape").catch(() => {});
    } else {
      v?.webkitEnterFullscreen?.();
    }
  } catch {
    v?.webkitEnterFullscreen?.();
  }
}

export default function PatientApp() {
  const invite = useRef(readInvite()).current;
  const [phase, setPhase] = useState<Phase>(invite ? "consent" : "invalid");
  const [error, setError] = useState<string | null>(null);
  const [local, setLocal] = useState<MediaStream | null>(null);
  const [remote, setRemote] = useState<MediaStream | null>(null);
  const [state, setState] = useState<CallState>("idle");
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [notice, setNotice] = useState<ChannelMessage | null>(null);
  const [stats, setStats] = useState<CallStats | null>(null);
  // Terapist ekran/video paylaşıyorsa görüntü sığdırılır; danışan dokunarak değiştirebilir.
  const [contentShare, setContentShare] = useState(false);
  const [fitOverride, setFitOverride] = useState<"cover" | "contain" | null>(null);
  const portrait = usePortrait();
  const remoteVideo = useRef<HTMLVideoElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const fit = fitOverride ?? (contentShare ? "contain" : "cover");
  const [test, setTest] = useState<Extract<ChannelMessage, { type: "test" }> | null>(null);
  const [homework, setHomework] = useState<HomeworkMessage[]>([]);
  const [homeworkOpen, setHomeworkOpen] = useState(false);
  const callRef = useRef<Call | null>(null);
  const material = useIncomingMaterial(
    useCallback((id: string) => callRef.current?.sendMessage({ type: "material_received", id }), []),
  );

  // Davet anahtarını adres çubuğundan ve geçmişten kaldır.
  useEffect(() => {
    if (invite) history.replaceState(null, "", window.location.pathname);
  }, [invite]);

  // Sayfa açıkken yeni bir davet bağlantısı açılırsa onu yükle.
  useEffect(() => {
    const onHash = () => {
      if (window.location.hash.includes("r=")) {
        try {
          sessionStorage.removeItem("mindcare-invite");
        } catch {
          /* depolama yok */
        }
        window.location.reload();
      }
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    const bye = () => callRef.current?.hangup();
    window.addEventListener("pagehide", bye);
    return () => window.removeEventListener("pagehide", bye);
  }, []);

  const prepareMedia = async () => {
    setError(null);
    try {
      const s = await getLocalMedia();
      setLocal(s);
      setCamOn(s.getVideoTracks().length > 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const join = async () => {
    if (!invite || !local) return;
    setPhase("joining");
    setError(null);
    try {
      const r = await joinRoom(invite.room, invite.token);
      if (r !== "ok") {
        setError(REJECT_TEXT[r] ?? "Görüşmeye katılınamadı.");
        setPhase("rejected");
        return;
      }
      const call = new Call("guest", invite.room, local, {
        onState: (s) => {
          setState(s);
          if (s === "ended") {
            local.getTracks().forEach((t) => t.stop());
            setPhase("left");
          }
        },
        onRemoteStream: setRemote,
        onStats: setStats,
        onMessage: (m) => {
          if (material.handle(m)) return;
          if (m.type === "content_share") {
            setContentShare(!!m.active);
            setFitOverride(null);
            return;
          }
          if (m.type === "test") {
            if (Array.isArray(m.definition?.questions)) {
              setTest(m);
              call.sendMessage({ type: "test_received", requestId: m.requestId });
            }
            return;
          }
          if (m.type === "homework") {
            if (typeof m.id === "string" && typeof m.title === "string") {
              setHomework((list) => [m, ...list.filter((h) => h.id !== m.id)]);
              setHomeworkOpen(true);
              call.sendMessage({ type: "homework_received", id: m.id });
            }
            return;
          }
          if (m.type === "test_cancel") {
            setTest((t) => (t?.requestId === m.requestId ? null : t));
            return;
          }
          setNotice(m);
          setTimeout(() => setNotice(null), 8000);
        },
      });
      callRef.current = call;
      setPhase("call");
      await call.start();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("rejected");
    }
  };

  const leave = async () => {
    await callRef.current?.hangup();
    callRef.current = null;
    local?.getTracks().forEach((t) => t.stop());
    setPhase("left");
  };

  const toggle = (kind: "audio" | "video") => {
    const tracks = kind === "audio" ? local?.getAudioTracks() : local?.getVideoTracks();
    const next = kind === "audio" ? !micOn : !camOn;
    tracks?.forEach((t) => (t.enabled = next));
    kind === "audio" ? setMicOn(next) : setCamOn(next);
  };

  // Ön/arka kamera. Bazı telefonlar iki kamerayı aynı anda açamaz: önce eskisi kapatılır.
  // Yeni iz aynı yerel akışa konur; böylece bağlantı yeniden kurulsa da seçili kamera kalır.
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const [canFlip, setCanFlip] = useState(false);
  const [flipping, setFlipping] = useState(false);
  useEffect(() => {
    if (!local) return;
    navigator.mediaDevices
      ?.enumerateDevices()
      .then((d) => setCanFlip(d.filter((x) => x.kind === "videoinput").length > 1))
      .catch(() => {});
  }, [local]);

  const flipCamera = async () => {
    if (!local || flipping) return;
    setFlipping(true);
    setError(null);
    const open = async (mode: "user" | "environment", exact: boolean) =>
      (await navigator.mediaDevices.getUserMedia({
        video: { facingMode: exact ? { exact: mode } : mode, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } },
      })).getVideoTracks()[0];
    const next: "user" | "environment" = facing === "user" ? "environment" : "user";
    const old = local.getVideoTracks()[0];
    old?.stop();
    let track: MediaStreamTrack | undefined;
    let now = next;
    try {
      track = await open(next, true);
    } catch {
      setError(next === "environment" ? "Arka kamera açılamadı." : "Ön kamera açılamadı.");
      now = facing;
      track = await open(facing, false).catch(() => undefined);
    }
    if (old) local.removeTrack(old);
    if (track) {
      track.enabled = camOn;
      local.addTrack(track);
    }
    callRef.current?.replaceTrack("video", track ?? null);
    setFacing(now);
    setFlipping(false);
  };

  if (phase === "call") {
    return (
      <div className="relative flex h-full flex-col bg-bg">
        <div ref={stage} className="relative min-h-0 flex-1 bg-black">
          {remote ? (
            <VideoEl
              stream={remote}
              fit={fit}
              videoRef={remoteVideo}
              onClick={() => setFitOverride(fit === "contain" ? "cover" : "contain")}
            />
          ) : (
            <WaitingRoom reconnecting={state === "reconnecting"} />
          )}
          <div className="absolute bottom-4 right-4 aspect-[3/4] w-28 overflow-hidden rounded-xl border border-line bg-card shadow-xl sm:aspect-[4/3] sm:w-48">
            {camOn ? <VideoEl key={facing} stream={local} muted mirrored={facing === "user"} /> : <div className="flex h-full items-center justify-center text-faint"><VideoOff /></div>}
          </div>
          <ConnectionBadge state={state} stats={stats} />
          {remote && contentShare && (
            <div className="absolute inset-x-0 bottom-36 z-10 flex flex-col items-center gap-2 px-4 sm:bottom-6">
              {portrait && (
                <span className="flex items-center gap-1.5 rounded-lg bg-black/60 px-3 py-1.5 text-xs text-white">
                  <Smartphone size={13} className="rotate-90" /> Daha büyük görmek için telefonu yan çevirin
                </span>
              )}
              <button
                onClick={() => enterFullscreen(remoteVideo.current, stage.current)}
                className="flex items-center gap-1.5 rounded-lg bg-accent-strong px-3 py-1.5 text-xs font-medium text-white shadow-lg"
              >
                <Maximize2 size={13} /> Tam ekran
              </button>
            </div>
          )}
          {notice?.type === "material" && (
            <div className="absolute left-1/2 top-4 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-line bg-panel px-4 py-3 text-sm shadow-xl">
              <FileText size={18} className="text-accent" /> Terapistiniz bir materyal paylaştı: <b>{notice.title}</b>
            </div>
          )}
          {material.current && <MaterialView item={material.current} onClose={material.clear} />}
          {homework.length > 0 && !homeworkOpen && (
            <button
              onClick={() => setHomeworkOpen(true)}
              className="absolute right-4 top-4 z-10 flex items-center gap-1.5 rounded-lg bg-accent-strong px-3 py-1.5 text-xs font-medium text-white shadow-lg"
            >
              <FileSignature size={14} /> Ödevlerim ({homework.length})
            </button>
          )}
          {homework.length > 0 && homeworkOpen && <HomeworkView items={homework} onClose={() => setHomeworkOpen(false)} />}
          {test && (
            <TestForm
              key={test.requestId}
              test={test}
              onSubmit={(answers) =>
                callRef.current?.sendMessage({ type: "test_answers", requestId: test.requestId, answers }) ?? false
              }
              onDone={() => setTest(null)}
            />
          )}
        </div>
        <div className="flex items-center justify-center gap-5 border-t border-line bg-panel py-4">
          <Round on={micOn} onClick={() => toggle("audio")} icon={micOn ? Mic : MicOff} label={micOn ? "Mikrofonu kapat" : "Mikrofonu aç"} />
          <Round on={camOn} onClick={() => toggle("video")} icon={camOn ? Video : VideoOff} label={camOn ? "Kamerayı kapat" : "Kamerayı aç"} />
          {canFlip && (
            <Round
              on={!flipping}
              onClick={flipCamera}
              icon={SwitchCamera}
              label={facing === "user" ? "Arka kameraya geç" : "Ön kameraya geç"}
            />
          )}
          <button onClick={leave} className="flex h-12 w-12 items-center justify-center rounded-full bg-danger text-white hover:bg-danger/80" aria-label="Görüşmeden ayrıl">
            <PhoneOff size={20} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto p-4">
      <div className="w-full max-w-md rounded-2xl border border-line bg-panel p-6 sm:p-8">
        <div className="mb-5 flex items-center gap-2">
          <HeartHandshake className="text-accent" size={28} />
          <span className="text-lg font-semibold">MindCare</span>
        </div>

        {phase === "invalid" && <p className="text-sm text-muted">Bağlantı eksik veya hatalı. Lütfen terapistinizin gönderdiği bağlantıyı eksiksiz açın.</p>}
        {phase === "left" && <p className="text-sm text-muted">Görüşme sona erdi. Bu pencereyi kapatabilirsiniz.</p>}
        {phase === "rejected" && <p className="text-sm text-danger">{error}</p>}

        {(phase === "consent" || phase === "joining") && (
          <>
            <h1 className="text-xl font-semibold">Görüşmeye katıl</h1>
            <p className="mt-2 text-sm text-muted">
              Görüşme uçtan uca şifrelenir ve kaydedilmez. Katılmak için kamera ve mikrofon izni vermeniz gerekir.
            </p>
            <div className="mt-5 aspect-video overflow-hidden rounded-xl border border-line bg-bg">
              {local ? (
                camOn ? <VideoEl key={facing} stream={local} muted mirrored={facing === "user"} /> : <div className="flex h-full items-center justify-center text-faint"><VideoOff /></div>
              ) : (
                <div className="flex h-full items-center justify-center">
                  <Button variant="subtle" onClick={prepareMedia}><Video size={16} /> Kamera ve mikrofonu aç</Button>
                </div>
              )}
            </div>
            {local && (
              <div className="mt-3 flex justify-center gap-3">
                <Round on={micOn} onClick={() => toggle("audio")} icon={micOn ? Mic : MicOff} label="Mikrofon" small />
                <Round on={camOn} onClick={() => toggle("video")} icon={camOn ? Video : VideoOff} label="Kamera" small />
                {canFlip && <Round on={!flipping} onClick={flipCamera} icon={SwitchCamera} label="Kamerayı çevir" small />}
              </div>
            )}
            {error && <p className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
            <Button className="mt-5 w-full py-2.5" onClick={join} disabled={!local || phase === "joining"}>
              {phase === "joining" ? "Katılınıyor…" : "Görüşmeye Katıl"}
            </Button>
            <p className="mt-4 text-xs leading-relaxed text-faint">
              Bu bağlantı size özeldir ve tek kullanımlıktır; başkalarıyla paylaşmayın. Bağlantı bilgileri yalnızca görüşmeyi
              kurmak için kullanılır. Terapistinizin gönderdiği test cevapları şifreli görüşme bağlantısıyla doğrudan
              terapistinize iletilir; bu sayfada veya bir sunucuda saklanmaz.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

/** Danışanın kendi bağlantı durumu: zayıf bağlantı ve yeniden bağlanma açıkça gösterilir. */
function ConnectionBadge({ state, stats }: { state: CallState; stats: CallStats | null }) {
  const weak = state === "connected" && stats !== null &&
    ((stats.packetLossPct ?? 0) > 8 || (stats.rttMs ?? 0) > 400);
  const [text, tone] =
    state === "reconnecting" ? ["Bağlantı koptu, yeniden bağlanılıyor…", "bg-warn/90 text-black"]
    : state !== "connected" ? ["Bağlanıyor", "bg-black/50 text-white"]
    : weak ? ["Bağlantınız zayıf; görüntü donabilir", "bg-warn/90 text-black"]
    : ["Şifreli görüşme", "bg-black/50 text-white"];
  return (
    <div className={cx("absolute left-4 top-4 flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs backdrop-blur", tone)} role="status">
      <Lock size={12} /> {text}
    </div>
  );
}

function Round({ on, onClick, icon: Icon, label, small }: { on: boolean; onClick: () => void; icon: typeof Mic; label: string; small?: boolean }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cx(
        "flex items-center justify-center rounded-full border",
        small ? "h-10 w-10" : "h-12 w-12",
        on ? "border-line bg-card text-ink hover:bg-line" : "border-danger/50 bg-danger/15 text-danger",
      )}
    >
      <Icon size={small ? 17 : 20} />
    </button>
  );
}
