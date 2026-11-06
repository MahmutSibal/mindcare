import { useEffect, useRef, useState } from "react";
import {
  Check, Copy, Info, Lock, Mic, MicOff, MonitorUp, PhoneOff, Signal, Video, VideoOff, Wifi, WifiOff, Waves,
} from "lucide-react";
import type { Patient } from "../../lib/api";
import { initials } from "../../lib/format";
import { useActiveSession } from "../../lib/session";
import { Avatar, Button, cx, Modal } from "../ui";
import type { CallApi } from "./useCall";

function VideoEl({ stream, muted, mirrored, className }: {
  stream: MediaStream | null;
  muted?: boolean;
  mirrored?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted={muted}
      className={cx("h-full w-full object-cover", mirrored && "-scale-x-100", className)}
    />
  );
}

export default function CallPanel({ call, patient }: { call: CallApi; patient: Patient | null }) {
  const active = useActiveSession();
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [busy, setBusy] = useState(false);

  const begin = async () => {
    if (!patient) return;
    setBusy(true);
    try {
      if (!active.session) await active.start(patient.id);
      else if (active.session.patient_id !== patient.id) return;
      await call.start();
    } finally {
      setBusy(false);
    }
  };

  const end = async (finishSession: boolean) => {
    setConfirmEnd(false);
    await call.hangup();
    if (finishSession) await active.finish();
  };

  const otherPatientInSession = active.session && patient && active.session.patient_id !== patient.id;

  return (
    <div className="flex min-h-0 flex-col gap-3 rounded-xl border border-line bg-panel p-3">
      <ConnectionStatusHeader call={call} />

      {/* VideoGrid */}
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl bg-bg">
        {call.remote ? (
          <VideoEl stream={call.remote} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
            {patient && <Avatar text={initials(patient.full_name)} size={96} />}
            {call.state === "idle" || call.state === "ended" || call.state === "failed" ? (
              <>
                <p className="max-w-sm text-sm text-muted">
                  {otherPatientInSession
                    ? `${active.session!.patient_name} ile bir seans sürüyor. Önce o seansı bitirin.`
                    : "Görüntülü görüşme için bir davet bağlantısı oluşturun. Danışan bağlantıya tarayıcıdan katılır, uygulama kurması gerekmez."}
                </p>
                <Button onClick={begin} disabled={!patient || busy || !!otherPatientInSession}>
                  <Video size={16} /> {busy ? "Hazırlanıyor…" : "Görüntülü Görüşme Başlat"}
                </Button>
              </>
            ) : (
              <WaitingForPatient call={call} name={patient?.full_name ?? ""} />
            )}
            {call.error && (
              <p className="max-w-md rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{call.error}</p>
            )}
            {call.turnWarning && (
              <p className="max-w-md rounded-lg bg-warn/10 px-3 py-2 text-xs text-warn">{call.turnWarning}</p>
            )}
          </div>
        )}

        {/* Terapist önizlemesi */}
        {call.local && (
          <div className="absolute bottom-4 right-4 aspect-[4/3] w-[clamp(140px,22%,210px)] overflow-hidden rounded-lg border border-line bg-card shadow-xl">
            {call.camOn && call.local.getVideoTracks().length ? (
              <VideoEl stream={call.local} muted mirrored />
            ) : (
              <div className="flex h-full items-center justify-center text-faint"><VideoOff size={26} /></div>
            )}
            {!call.micOn && (
              <span className="absolute left-2 top-2 rounded-full bg-danger p-1 text-white"><MicOff size={12} /></span>
            )}
          </div>
        )}
      </div>

      {/* CallControlsBar */}
      <div className="flex items-center justify-center gap-8 pb-1 pt-1">
        <Control on={call.micOn} onClick={call.toggleMic} icon={call.micOn ? Mic : MicOff} label={call.micOn ? "Mikrofon Açık" : "Mikrofon Kapalı"} />
        <Control on={call.camOn} onClick={call.toggleCam} icon={call.camOn ? Video : VideoOff} label={call.camOn ? "Kamera Açık" : "Kamera Kapalı"} />
        <Control
          on={!call.screen}
          onClick={call.shareScreen}
          icon={MonitorUp}
          label={call.screen ? "Paylaşılıyor" : "Ekran Paylaş"}
          disabled={!call.inCall}
          highlight={!!call.screen}
        />
        <span className="h-12 w-px bg-line" />
        <button
          onClick={() => setConfirmEnd(true)}
          disabled={!call.inCall && !active.session}
          className="flex flex-col items-center gap-1.5 disabled:opacity-40"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-danger text-white hover:bg-danger/80">
            <PhoneOff size={20} />
          </span>
          <span className="text-xs text-ink">Görüşmeyi Sonlandır</span>
        </button>
      </div>

      {confirmEnd && (
        <Modal title="Görüşmeyi sonlandır" onClose={() => setConfirmEnd(false)}>
          <p className="text-sm text-muted">Bağlantı kapatılacak ve davet bağlantısı geçersiz olacak.</p>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmEnd(false)}>Vazgeç</Button>
            {call.inCall && <Button variant="subtle" onClick={() => end(false)}>Yalnızca görüşmeyi kapat</Button>}
            {active.session && <Button variant="danger" onClick={() => end(true)}>Seansı da bitir</Button>}
          </div>
        </Modal>
      )}
    </div>
  );
}

function Control({ on, onClick, icon: Icon, label, disabled, highlight }: {
  on: boolean;
  onClick: () => void;
  icon: typeof Mic;
  label: string;
  disabled?: boolean;
  highlight?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={disabled} className="flex w-20 flex-col items-center gap-1.5 disabled:opacity-40">
      <span
        className={cx(
          "flex h-12 w-12 items-center justify-center rounded-full border transition-colors",
          highlight ? "border-accent bg-accent-soft text-accent" : on ? "border-line bg-card text-ink hover:bg-line" : "border-danger/50 bg-danger/15 text-danger",
        )}
      >
        <Icon size={20} />
      </span>
      <span className="text-center text-xs leading-tight text-ink">{label}</span>
    </button>
  );
}

// ───────────────────────────── Bağlantı durumu ─────────────────────────────

function ConnectionStatusHeader({ call }: { call: CallApi }) {
  const [info, setInfo] = useState(false);
  const st = call.state;
  const s = call.stats;
  const label: Record<string, string> = {
    idle: "Görüşme yok",
    waiting: "Danışan bekleniyor",
    connecting: "Bağlanıyor…",
    connected: s?.route === "turn" ? "TURN Üzerinden Bağlı" : "P2P Bağlantı Aktif",
    reconnecting: "Yeniden bağlanıyor…",
    ended: "Görüşme bitti",
    failed: "Bağlantı kurulamadı",
  };
  const tone = st === "connected" ? "ok" : st === "failed" ? "bad" : st === "idle" || st === "ended" ? "idle" : "warn";
  const quality = s?.rttMs == null ? 0 : s.rttMs < 80 ? 4 : s.rttMs < 150 ? 3 : s.rttMs < 300 ? 2 : 1;

  return (
    <div className="flex items-center gap-2 text-[13px]">
      <span
        className={cx(
          "flex items-center gap-2 rounded-lg border px-3 py-1.5 font-medium",
          tone === "ok" && "border-ok/40 bg-ok/10 text-ok",
          tone === "warn" && "border-warn/40 bg-warn/10 text-warn",
          tone === "bad" && "border-danger/40 bg-danger/10 text-danger",
          tone === "idle" && "border-line bg-card text-muted",
        )}
      >
        {tone === "idle" || tone === "bad" ? <WifiOff size={14} /> : <Wifi size={14} />}
        {label[st]}
      </span>
      {st === "connected" && (
        <>
          <span className="flex items-center gap-2 rounded-lg bg-card px-3 py-1.5 text-ink"><Lock size={14} /> Uçtan Uca Şifreli</span>
          <span className="flex items-center gap-2 px-2 text-ink">
            <Signal size={15} className={quality >= 3 ? "text-ok" : quality === 2 ? "text-warn" : "text-danger"} />
            Gecikme: {s?.rttMs != null ? `${s.rttMs} ms` : "—"}
          </span>
          <span className="flex items-center gap-2 px-2 text-ink">
            <Waves size={15} className="text-muted" />
            Paket Kaybı: %{s?.packetLossPct != null ? s.packetLossPct.toFixed(1).replace(".", ",") : "—"}
          </span>
        </>
      )}
      <button onClick={() => setInfo(true)} className="ml-auto rounded-full p-1 text-muted hover:bg-card hover:text-ink" title="Bağlantı bilgisi">
        <Info size={18} />
      </button>
      {info && (
        <Modal title="Bağlantı ve gizlilik" onClose={() => setInfo(false)}>
          <ul className="space-y-3 text-sm text-muted">
            <li>Ses ve görüntü WebRTC ile DTLS-SRTP şifrelenerek aktarılır.</li>
            <li>Uygun ağlarda medya doğrudan iki cihaz arasında (P2P) akar. Doğrudan bağlantı kurulamazsa TURN sunucusu paketleri iletir; şifreli içeriği okuyamaz.</li>
            <li>Supabase yalnızca bağlantı kurulumu (SDP/ICE) için kullanılır. Danışan adı, notlar ve seans kayıtları sunucuya gönderilmez.</li>
            <li>Davet bağlantıları süreli ve tek kullanımlıktır; görüşme sonlandırıldığında kanal kapanır.</li>
          </ul>
        </Modal>
      )}
    </div>
  );
}

function WaitingForPatient({ call, name }: { call: CallApi; name: string }) {
  const [copied, setCopied] = useState(false);
  if (!call.invite) return <p className="text-sm text-muted">Hazırlanıyor…</p>;
  const copy = async () => {
    await navigator.clipboard.writeText(call.invite!.link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  const exp = call.invite.expiresAt.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
  return (
    <div className="w-full max-w-lg space-y-3">
      <p className="text-sm text-muted">
        {call.state === "connecting" ? "Danışan katıldı, bağlantı kuruluyor…" : `${name} bekleniyor. Davet bağlantısını danışanla güvenli bir kanaldan paylaşın.`}
      </p>
      <div className="flex items-center gap-2 rounded-lg border border-line bg-card p-2">
        <code className="min-w-0 flex-1 truncate text-left text-xs text-muted">{call.invite.link}</code>
        <Button variant="subtle" className="px-2.5 py-1.5 text-xs" onClick={copy}>
          {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Kopyalandı" : "Kopyala"}
        </Button>
      </div>
      <p className="text-xs text-faint">Tek kullanımlık • {exp}'e kadar geçerli</p>
    </div>
  );
}
