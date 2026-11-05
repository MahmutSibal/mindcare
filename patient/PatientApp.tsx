// Danışan web istemcisi: davet bağlantısıyla tarayıcıdan görüşmeye katılım.
// Terapistin yerel veritabanına hiçbir erişimi yoktur; yalnızca görüşme medyası
// ve terapistin paylaştığı kısa bildirimler alınır.

import { useEffect, useRef, useState } from "react";
import { FileText, HeartHandshake, Lock, Mic, MicOff, PhoneOff, Video, VideoOff } from "lucide-react";
import { Call, type CallState, type ChannelMessage, getLocalMedia, joinRoom, type JoinResult } from "../src/lib/rtc";
import { Button, cx } from "../src/components/ui";

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

function VideoEl({ stream, muted, mirrored }: { stream: MediaStream | null; muted?: boolean; mirrored?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return <video ref={ref} autoPlay playsInline muted={muted} className={cx("h-full w-full object-cover", mirrored && "-scale-x-100")} />;
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
  const callRef = useRef<Call | null>(null);

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
        onMessage: (m) => {
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

  if (phase === "call") {
    return (
      <div className="relative flex h-full flex-col bg-bg">
        <div className="relative min-h-0 flex-1">
          {remote ? (
            <VideoEl stream={remote} />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-muted">
              <HeartHandshake size={44} className="text-accent" />
              <p>{state === "reconnecting" ? "Bağlantı yeniden kuruluyor…" : "Terapistiniz bekleniyor…"}</p>
            </div>
          )}
          <div className="absolute bottom-4 right-4 aspect-[3/4] w-28 overflow-hidden rounded-xl border border-line bg-card shadow-xl sm:aspect-[4/3] sm:w-48">
            {camOn ? <VideoEl stream={local} muted mirrored /> : <div className="flex h-full items-center justify-center text-faint"><VideoOff /></div>}
          </div>
          <div className="absolute left-4 top-4 flex items-center gap-2 rounded-lg bg-black/50 px-3 py-1.5 text-xs text-white backdrop-blur">
            <Lock size={12} /> {state === "connected" ? "Şifreli görüşme" : "Bağlanıyor"}
          </div>
          {notice?.type === "material" && (
            <div className="absolute left-1/2 top-4 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-line bg-panel px-4 py-3 text-sm shadow-xl">
              <FileText size={18} className="text-accent" /> Terapistiniz bir materyal paylaştı: <b>{notice.title}</b>
            </div>
          )}
        </div>
        <div className="flex items-center justify-center gap-5 border-t border-line bg-panel py-4">
          <Round on={micOn} onClick={() => toggle("audio")} icon={micOn ? Mic : MicOff} label={micOn ? "Mikrofonu kapat" : "Mikrofonu aç"} />
          <Round on={camOn} onClick={() => toggle("video")} icon={camOn ? Video : VideoOff} label={camOn ? "Kamerayı kapat" : "Kamerayı aç"} />
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
                camOn ? <VideoEl stream={local} muted mirrored /> : <div className="flex h-full items-center justify-center text-faint"><VideoOff /></div>
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
              </div>
            )}
            {error && <p className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
            <Button className="mt-5 w-full py-2.5" onClick={join} disabled={!local || phase === "joining"}>
              {phase === "joining" ? "Katılınıyor…" : "Görüşmeye Katıl"}
            </Button>
            <p className="mt-4 text-xs leading-relaxed text-faint">
              Bu bağlantı size özeldir ve tek kullanımlıktır; başkalarıyla paylaşmayın. Bağlantı bilgileri yalnızca görüşmeyi
              kurmak için kullanılır, sağlık bilgileriniz bu sayfa üzerinden aktarılmaz.
            </p>
          </>
        )}
      </div>
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
