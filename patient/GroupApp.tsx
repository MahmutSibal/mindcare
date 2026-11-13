// Danışan web istemcisi: grup görüşmesi. Bağlantıdaki `g` (oda), `t` (üyeye özel anahtar),
// `n` (ad) ve `m` (üye kimliği) alanlarıyla katılır. Görüntü ve ses diğer katılımcılarla
// doğrudan bağlanır; terapistin yerel veritabanına erişim yoktur.

import { useCallback, useEffect, useRef, useState } from "react";
import { FileSignature, HeartHandshake, Lock, Mic, MicOff, MoreVertical, Pencil, PhoneOff, Video, VideoOff } from "lucide-react";
import { Button, cx } from "../src/components/ui";
import { GroupCall, joinGroupRoom, type GroupPeer } from "../src/lib/groupRtc";
import { getLocalMedia, type CallState, type JoinResult } from "../src/lib/rtc";
import ConnectionTest from "./ConnectionTest";
import HomeworkView, { type HomeworkMessage } from "./HomeworkView";
import MaterialView, { useIncomingMaterial } from "./MaterialView";
import TestForm from "./TestForm";
import BoardOverlay from "./BoardOverlay";
import { UploadSection, useUpload } from "./Upload";
import { useBoard } from "../src/lib/useBoard";
import type { ChannelMessage } from "../src/lib/rtc";

type Phase = "invalid" | "consent" | "joining" | "rejected" | "call" | "left";

interface GroupInviteInfo {
  room: string;
  token: string;
  name: string;
  member: string | null;
}

export function hasGroupInvite(): boolean {
  const hash = new URLSearchParams(window.location.hash.slice(1));
  if (hash.has("r")) return false; // yeni bir birebir görüşme bağlantısı
  if (hash.has("g")) return true;
  try {
    return !!sessionStorage.getItem("mindcare-group-invite");
  } catch {
    return false;
  }
}

function readInvite(): GroupInviteInfo | null {
  const p = new URLSearchParams(window.location.hash.slice(1));
  let info: GroupInviteInfo | null = null;
  if (p.get("g") && p.get("t")) {
    info = { room: p.get("g")!, token: p.get("t")!, name: p.get("n") ?? "", member: p.get("m") };
  } else {
    try {
      info = JSON.parse(sessionStorage.getItem("mindcare-group-invite") ?? "null");
    } catch {
      /* depolama yok */
    }
  }
  if (!info || !/^[A-Za-z0-9_-]{22,64}$/.test(info.room) || !info.token) return null;
  try {
    sessionStorage.setItem("mindcare-group-invite", JSON.stringify(info));
  } catch {
    /* depolama yok */
  }
  return info;
}

const REJECT_TEXT: Partial<Record<JoinResult, string>> = {
  not_found: "Bu davet bağlantısı geçersiz.",
  expired: "Bu davet bağlantısının süresi dolmuş. Terapistinizden yeni bir bağlantı isteyin.",
  used: "Bu davet bağlantısı başka bir cihazda kullanıldı. Davetler kişiye özel ve tek kullanımlıktır.",
  ended: "Bu görüşme sona erdi.",
  host: "Bu bağlantı terapist hesabıyla açılmış. Lütfen danışan cihazından açın.",
};

function Tile({ stream, name, muted, mirrored, off, big, state, fit = "cover" }: {
  fit?: "cover" | "contain";
  stream: MediaStream | null;
  name: string;
  muted?: boolean;
  mirrored?: boolean;
  off?: boolean;
  big?: boolean;
  state?: GroupPeer["state"];
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream, off]);
  return (
    <div className={cx("relative overflow-hidden rounded-xl border border-line bg-bg", big ? "col-span-full aspect-video max-h-[46vh] justify-self-center" : "aspect-[4/3]")}
      style={big ? { width: "min(100%, 70vh)" } : undefined}>
      {stream ? (
        <video ref={ref} autoPlay playsInline muted={muted} className={cx("h-full w-full", fit === "contain" ? "object-contain" : "object-cover", mirrored && "-scale-x-100", off && "opacity-0")} />
      ) : null}
      {(!stream || off) && <div className="absolute inset-0 flex items-center justify-center text-faint"><VideoOff size={26} /></div>}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2.5 pb-1.5 pt-5 text-xs text-white">
        {name}
        {state && state !== "connected" && <span className="ml-1.5 rounded bg-warn/80 px-1 text-[10px] text-black">bağlanıyor</span>}
      </div>
    </div>
  );
}

function HostThumb({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return <video ref={ref} autoPlay playsInline muted className="h-full w-full object-cover" />;
}

function Round({ on, onClick, icon: Icon, label }: { on: boolean; onClick: () => void; icon: typeof Mic; label: string }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cx(
        "flex h-12 w-12 shrink-0 items-center justify-center rounded-full border",
        on ? "border-line bg-card text-ink hover:bg-line" : "border-danger/50 bg-danger/15 text-danger",
      )}
    >
      <Icon size={20} />
    </button>
  );
}

export default function GroupApp() {
  const invite = useRef(readInvite()).current;
  const [phase, setPhase] = useState<Phase>(invite ? "consent" : "invalid");
  const [error, setError] = useState<string | null>(null);
  const [local, setLocal] = useState<MediaStream | null>(null);
  const [peers, setPeers] = useState<GroupPeer[]>([]);
  const [state, setState] = useState<CallState>("idle");
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [consented, setConsented] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const [homework, setHomework] = useState<HomeworkMessage[]>([]);
  const [homeworkOpen, setHomeworkOpen] = useState(false);
  const callRef = useRef<GroupCall | null>(null);
  const [menu, setMenu] = useState(false);
  const [contentShare, setContentShare] = useState(false);
  const [test, setTest] = useState<Extract<ChannelMessage, { type: "test" }> | null>(null);
  const upload = useUpload(() => callRef.current);
  const uploadRef = useRef(upload);
  uploadRef.current = upload;
  // Ortak çizim: terapist başlatır; gösterilen görsel arka plan olabilir.
  const [boardVisible, setBoardVisible] = useState(true);
  const [backdropUrl, setBackdropUrl] = useState<string | null>(null);
  const board = useBoard("guest", (m) => callRef.current?.sendMessage(m) ?? false, state === "connected");
  useEffect(() => {
    setBoardVisible(true);
    setBackdropUrl(null);
  }, [board.session?.id]);
  const material = useIncomingMaterial(useCallback((id: string) => callRef.current?.sendMessage({ type: "material_received", id }) ?? false, []));
  useEffect(() => {
    const id = board.session?.backdropId;
    const cur = material.current;
    if (id && cur && cur.id === id && cur.url) setBackdropUrl(cur.url);
  }, [board.session?.backdropId, material.current?.id, material.current?.url]); // eslint-disable-line react-hooks/exhaustive-deps
  const consentSent = useRef(false);

  // Davet anahtarını adres çubuğundan ve geçmişten kaldır.
  useEffect(() => {
    if (invite) history.replaceState(null, "", window.location.pathname);
  }, [invite]);

  useEffect(() => {
    const bye = () => void callRef.current?.hangup();
    window.addEventListener("pagehide", bye);
    return () => window.removeEventListener("pagehide", bye);
  }, []);

  // Terapistle bağlanınca onam bildirilir.
  useEffect(() => {
    const host = peers.find((p) => p.id === "host");
    if (host?.state === "connected" && !consentSent.current) {
      consentSent.current = callRef.current?.sendMessage({ type: "consent" }) ?? false;
    }
  }, [peers]);

  const prepareMedia = async () => {
    setError(null);
    try {
      const s = await getLocalMedia();
      setLocal(s);
      setMicOn(s.getAudioTracks().some((t) => t.enabled));
      setCamOn(s.getVideoTracks().some((t) => t.enabled));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const toggle = (kind: "audio" | "video") => {
    const tracks = kind === "audio" ? local?.getAudioTracks() : local?.getVideoTracks();
    const next = !(kind === "audio" ? micOn : camOn);
    tracks?.forEach((t) => (t.enabled = next));
    if (kind === "audio") setMicOn(next);
    else setCamOn(next);
  };

  const join = async () => {
    if (!invite || !local) return;
    setPhase("joining");
    setError(null);
    try {
      const result = await joinGroupRoom(invite.room, invite.token);
      if (result !== "ok") {
        setError(REJECT_TEXT[result] ?? "Görüşmeye katılınamadı.");
        setPhase("rejected");
        return;
      }
      const call = new GroupCall("guest", invite.room, local, { name: invite.name || "Katılımcı", member: invite.member }, {
        onState: (s) => {
          setState(s);
          if (s === "ended") {
            local.getTracks().forEach((t) => t.stop());
            setPhase("left");
          }
        },
        onPeers: setPeers,
        onMessage: (m, from) => {
          // Tuval, materyal, test ve ödev yalnızca terapistten (tuval diğer üyelerinkini de terapist iletir) kabul edilir.
          if (from !== "host") return;
          if (uploadRef.current.handle(m)) return;
          if (board.handle(m)) return;
          if (material.handle(m)) return;
          if (m.type === "content_share") {
            setContentShare(!!m.active);
            return;
          }
          if (m.type === "test") {
            if (Array.isArray(m.definition?.questions)) {
              setTest(m);
              callRef.current?.sendMessage({ type: "test_received", requestId: m.requestId });
            }
            return;
          }
          if (m.type === "test_cancel") {
            setTest((t) => (t?.requestId === m.requestId ? null : t));
            return;
          }
          if (m.type === "homework" && typeof m.id === "string" && typeof m.title === "string") {
            setHomework((list) => [m, ...list.filter((h) => h.id !== m.id)]);
            setHomeworkOpen(true);
            callRef.current?.sendMessage({ type: "homework_received", id: m.id });
          }
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
    local?.getTracks().forEach((t) => t.stop());
    setPhase("left");
  };

  if (phase === "call") {
    const host = peers.find((p) => p.id === "host");
    const others = peers.filter((p) => p.id !== "host");
    return (
      <div className="relative flex h-full flex-col bg-bg">
        <div className="relative min-h-0 flex-1">
          <div className="h-full overflow-y-auto p-2.5">
            <div className="mb-2 flex items-center gap-2 text-xs text-muted">
              <Lock size={12} /> Şifreli grup görüşmesi
              {state !== "connected" && <span className="rounded bg-warn/90 px-1.5 py-0.5 text-black">{state === "reconnecting" ? "Yeniden bağlanılıyor…" : "Bağlanıyor…"}</span>}
              {homework.length > 0 && !homeworkOpen && (
                <button
                  onClick={() => setHomeworkOpen(true)}
                  className="ml-auto flex items-center gap-1.5 rounded-lg border border-line bg-card px-2.5 py-1 text-ink hover:bg-line"
                >
                  <FileSignature size={13} /> Ödevlerim ({homework.length})
                </button>
              )}
            </div>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2">
              <Tile big fit={contentShare ? "contain" : "cover"} stream={host?.stream ?? null} name="Terapist" state={host?.state ?? "connecting"} />
              {others.map((p) => (
                <Tile key={p.id} stream={p.stream} name={p.name} state={p.state} />
              ))}
              <Tile stream={local} name="Siz" muted mirrored off={!camOn} />
            </div>
          </div>

          {board.session && boardVisible && (
            <BoardOverlay
              boardApi={board}
              backdropUrl={backdropUrl}
              onMinimize={() => setBoardVisible(false)}
              video={host?.stream ? <HostThumb stream={host.stream} /> : null}
            />
          )}
          {board.session && !boardVisible && (
            <button
              onClick={() => setBoardVisible(true)}
              className="absolute left-3 top-10 z-20 flex items-center gap-1.5 rounded-lg bg-accent-strong px-3 py-1.5 text-xs font-medium text-white shadow-lg"
            >
              <Pencil size={14} /> Çizime dön
            </button>
          )}
          {material.current && <MaterialView item={material.current} onClose={material.clear} control={material.control} />}
          {homework.length > 0 && homeworkOpen && <HomeworkView items={homework} onClose={() => setHomeworkOpen(false)} />}
          {test && (
            <TestForm
              key={test.requestId}
              test={test}
              onSubmit={(answers) => callRef.current?.sendMessage({ type: "test_answers", requestId: test.requestId, answers }) ?? false}
              onDone={() => setTest(null)}
            />
          )}
        </div>
        <div className="relative flex shrink-0 items-center justify-center gap-4 border-t border-line bg-panel px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {menu && (
            <>
              <button className="fixed inset-0 z-30 cursor-default" aria-label="Menüyü kapat" onClick={() => setMenu(false)} />
              <div className="absolute bottom-full left-1/2 z-40 mb-2 w-[min(92vw,340px)] -translate-x-1/2 rounded-2xl border border-line bg-panel p-4 shadow-2xl">
                <UploadSection upload={upload} />
                <p className="text-[11px] leading-relaxed text-faint">
                  Gönderdiğiniz dosyayı yalnızca terapistiniz görür; gruptaki diğer kişilere gitmez.
                </p>
              </div>
            </>
          )}
          <Round on={micOn} onClick={() => toggle("audio")} icon={micOn ? Mic : MicOff} label={micOn ? "Mikrofonu kapat" : "Mikrofonu aç"} />
          <Round on={camOn} onClick={() => toggle("video")} icon={camOn ? Video : VideoOff} label={camOn ? "Kamerayı kapat" : "Kamerayı aç"} />
          <Round on onClick={() => setMenu(!menu)} icon={MoreVertical} label="Daha fazla" />
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
        {phase === "left" && <p className="text-sm text-muted">Grup görüşmesi sona erdi. Bu pencereyi kapatabilirsiniz.</p>}
        {phase === "rejected" && <p className="text-sm text-danger">{error}</p>}
        {testOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/70 p-4">
            <ConnectionTest onClose={() => setTestOpen(false)} />
          </div>
        )}
        {(phase === "consent" || phase === "joining") && (
          <>
            <h1 className="text-xl font-semibold">Grup görüşmesine katıl</h1>
            <p className="mt-2 text-sm text-muted">
              Bu bir grup görüşmesidir; terapistin yanında gruptaki diğer katılımcılar da sizi görür ve duyar. Görüşme
              uçtan uca şifrelenir ve kaydedilmez.
            </p>
            <div className="mt-5 aspect-video overflow-hidden rounded-xl border border-line bg-bg">
              {local ? (
                <Tile stream={local} name={invite?.name || "Siz"} muted mirrored off={!camOn} />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <Button variant="subtle" onClick={prepareMedia}><Video size={16} /> Kamera ve mikrofonu aç</Button>
                </div>
              )}
            </div>
            {local && (
              <div className="mt-3 flex justify-center gap-3">
                <Round on={micOn} onClick={() => toggle("audio")} icon={micOn ? Mic : MicOff} label="Mikrofon" />
                <Round on={camOn} onClick={() => toggle("video")} icon={camOn ? Video : VideoOff} label="Kamera" />
              </div>
            )}
            {error && <p className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
            <label className="mt-4 flex cursor-pointer items-start gap-2.5 rounded-lg border border-line bg-card/60 p-3 text-xs leading-relaxed text-muted">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-accent)]"
                checked={consented}
                onChange={(e) => setConsented(e.target.checked)}
              />
              <span>
                Görüşmenin çevrim içi, görüntülü ve sesli bir <b>grup</b> görüşmesi olarak yapılmasını, diğer katılımcıların beni
                görüp duyacağını kabul ediyorum. Gruptaki diğer kişilerin paylaştıklarını gizli tutacağım. Görüşme kaydedilmez.
              </span>
            </label>
            <Button className="mt-4 w-full py-2.5" onClick={join} disabled={!local || !consented || phase === "joining"}>
              {phase === "joining" ? "Katılınıyor…" : "Görüşmeye Katıl"}
            </Button>
            <button onClick={() => setTestOpen(true)} className="mt-3 w-full text-center text-xs text-muted underline hover:text-ink">
              Bağlantımı test et (kamera, mikrofon, internet)
            </button>
            <p className="mt-4 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-xs leading-relaxed text-warn">
              Bu görüşme acil yardım hattı değildir. Kendinize veya bir başkasına zarar verme düşünceniz varsa ya da acil bir
              durumdaysanız <b>112</b>'yi arayın.
            </p>
            <p className="mt-3 text-xs leading-relaxed text-faint">
              Bu bağlantı size özeldir ve tek kullanımlıktır; başkalarıyla paylaşmayın.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
