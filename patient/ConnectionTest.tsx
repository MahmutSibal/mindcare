// Danışan için bağlantı testi: kamera ve mikrofon, doğrudan bağlantı imkânı, gecikme ve internet hızı.
// Görüşmeden önce çalıştırılır; sonuçta sorun varsa ne yapılacağı söylenir. Hiçbir veri kaydedilmez.
// Hız ölçümü için Cloudflare'in herkese açık hız test sunucusu kullanılır (yalnızca rastgele bayt).

import { useRef, useState } from "react";
import { Check, CircleAlert, HeartHandshake, Loader2, TriangleAlert, X } from "lucide-react";
import { Button, cx } from "../src/components/ui";
import { DEFAULT_STUN } from "../src/lib/config";

type Status = "idle" | "run" | "ok" | "warn" | "fail";
interface Step {
  id: "support" | "media" | "network" | "latency" | "down" | "up";
  label: string;
  status: Status;
  detail: string;
}

const INITIAL: Step[] = [
  { id: "support", label: "Tarayıcı desteği", status: "idle", detail: "" },
  { id: "media", label: "Kamera ve mikrofon", status: "idle", detail: "" },
  { id: "network", label: "Doğrudan bağlantı", status: "idle", detail: "" },
  { id: "latency", label: "Gecikme", status: "idle", detail: "" },
  { id: "down", label: "İndirme hızı", status: "idle", detail: "" },
  { id: "up", label: "Gönderme hızı (görüntünüz için)", status: "idle", detail: "" },
];

const SPEED = "https://speed.cloudflare.com";
const nocache = () => `r=${Math.random().toString(36).slice(2)}`;

async function measureLatency(): Promise<number> {
  const times: number[] = [];
  for (let i = 0; i < 5; i++) {
    const t = performance.now();
    await fetch(`${SPEED}/__down?bytes=0&${nocache()}`, { cache: "no-store" });
    times.push(performance.now() - t);
  }
  return Math.round(Math.min(...times));
}

async function measureDown(): Promise<number> {
  const t = performance.now();
  const r = await fetch(`${SPEED}/__down?bytes=3000000&${nocache()}`, { cache: "no-store" });
  const buf = await r.arrayBuffer();
  return (buf.byteLength * 8) / 1e6 / ((performance.now() - t) / 1000);
}

async function measureUp(): Promise<number> {
  const body = new Blob([new Uint8Array(1_500_000)]);
  const t = performance.now();
  await fetch(`${SPEED}/__up?${nocache()}`, { method: "POST", body, cache: "no-store" });
  return (body.size * 8) / 1e6 / ((performance.now() - t) / 1000);
}

/** STUN ile dış adres alınabiliyor mu? Alınabiliyorsa çoğu ağda doğrudan bağlantı kurulur. */
function checkDirect(): Promise<"direct" | "local-only" | "none"> {
  return new Promise((resolve) => {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: DEFAULT_STUN }] });
    let srflx = false;
    let host = false;
    const done = () => {
      pc.close();
      resolve(srflx ? "direct" : host ? "local-only" : "none");
    };
    const timer = setTimeout(done, 5000);
    pc.createDataChannel("t");
    pc.onicecandidate = (e) => {
      if (!e.candidate) {
        clearTimeout(timer);
        done();
        return;
      }
      if (e.candidate.type === "srflx") {
        srflx = true;
        clearTimeout(timer);
        done();
      } else if (e.candidate.type === "host") host = true;
    };
    pc.createOffer().then((o) => pc.setLocalDescription(o)).catch(done);
  });
}

/** Mikrofonu 4 sn dinler; en yüksek seviyeyi (0–1) döndürür. */
async function listen(stream: MediaStream, onLevel: (v: number) => void): Promise<number> {
  const ctx = new AudioContext();
  const an = ctx.createAnalyser();
  an.fftSize = 512;
  ctx.createMediaStreamSource(stream).connect(an);
  const buf = new Uint8Array(an.fftSize);
  let peak = 0;
  const end = performance.now() + 4000;
  while (performance.now() < end) {
    an.getByteTimeDomainData(buf);
    let p = 0;
    for (const v of buf) p = Math.max(p, Math.abs(v - 128));
    const level = Math.min(1, p / 64);
    peak = Math.max(peak, level);
    onLevel(level);
    await new Promise((r) => setTimeout(r, 80));
  }
  void ctx.close();
  return peak;
}

const ICON: Record<Status, React.ReactNode> = {
  idle: <span className="h-4 w-4 rounded-full border border-line" />,
  run: <Loader2 size={16} className="animate-spin text-accent" />,
  ok: <Check size={16} className="text-ok" />,
  warn: <TriangleAlert size={16} className="text-warn" />,
  fail: <X size={16} className="text-danger" />,
};

export default function ConnectionTest({ onClose }: { onClose?: () => void }) {
  const [steps, setSteps] = useState<Step[]>(INITIAL);
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const [advice, setAdvice] = useState<string[]>([]);
  const [level, setLevel] = useState(0);
  const preview = useRef<HTMLVideoElement>(null);

  const set = (id: Step["id"], status: Status, detail = "") =>
    setSteps((s) => s.map((x) => (x.id === id ? { ...x, status, detail } : x)));

  const run = async () => {
    setRunning(true);
    setFinished(false);
    setAdvice([]);
    setSteps(INITIAL);
    const tips: string[] = [];
    let stream: MediaStream | null = null;
    try {
      // 1) Tarayıcı
      set("support", "run");
      if (!window.RTCPeerConnection || !navigator.mediaDevices?.getUserMedia) {
        set("support", "fail", "Bu tarayıcı görüntülü görüşmeyi desteklemiyor.");
        tips.push("Telefonda Chrome (Android) veya Safari (iPhone), bilgisayarda Chrome, Edge ya da Safari kullanın. Uygulama içi tarayıcılardan (Instagram, WhatsApp vb.) açmayın.");
        return;
      }
      set("support", "ok", "Destekleniyor.");

      // 2) Kamera ve mikrofon
      set("media", "run", "İzin isteniyor…");
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: true });
        if (preview.current) preview.current.srcObject = stream;
        set("media", "run", "Birkaç kelime konuşun…");
        const peak = await listen(stream, setLevel);
        if (peak < 0.05) {
          set("media", "warn", "Mikrofondan ses algılanmadı.");
          tips.push("Mikrofonunuz ses almıyor: cihazın sessize alınmadığını, mikrofonun başka bir uygulamada kullanılmadığını ve tarayıcıda mikrofon izninin açık olduğunu kontrol edin.");
        } else {
          set("media", "ok", "Kamera açıldı, mikrofon sesinizi alıyor.");
        }
      } catch (e) {
        const name = (e as { name?: string })?.name;
        set("media", "fail", name === "NotAllowedError" ? "Kamera/mikrofon izni verilmedi." : "Kamera veya mikrofon açılamadı.");
        tips.push("Tarayıcının adres çubuğundaki kilit simgesinden kamera ve mikrofon iznini açıp testi yeniden çalıştırın.");
      }

      // 3) Doğrudan bağlantı
      set("network", "run");
      try {
        const r = await checkDirect();
        if (r === "direct") set("network", "ok", "Ağınız doğrudan bağlantıya uygun.");
        else {
          set("network", "warn", "Ağınız doğrudan bağlantıyı kısıtlıyor; görüşme yedek yoldan kurulacak.");
          tips.push("Ağınız doğrudan bağlantıyı engelliyor. Görüşme yine kurulur ama kalite biraz düşebilir. VPN veya şirket/okul ağı kullanıyorsanız kapatıp kendi Wi-Fi'nize ya da mobil verinize geçin.");
        }
      } catch {
        set("network", "warn", "Denetlenemedi.");
      }

      // 4–6) Hız
      try {
        set("latency", "run");
        const ms = await measureLatency();
        if (ms > 300) {
          set("latency", "warn", `${ms} ms (yüksek)`);
          tips.push("Gecikme yüksek; görüntüde ve seste biraz geç gelme olabilir. Konuşurken birbirinizin sözünü kesmemek için kısa duraklamalar yapın.");
        } else set("latency", "ok", `${ms} ms`);

        set("down", "run");
        const down = await measureDown();
        set("down", down < 1.5 ? "warn" : "ok", `${down.toFixed(1)} Mbit/sn`);
        if (down < 1.5) tips.push("İndirme hızınız düşük; karşıdaki görüntü kısık gelebilir. Mümkünse Wi-Fi'ye yaklaşın.");

        set("up", "run");
        const up = await measureUp();
        if (up < 0.6) {
          set("up", "warn", `${up.toFixed(1)} Mbit/sn (düşük)`);
          tips.push("Gönderme hızınız düşük; görüntünüz terapiste kötü ulaşabilir. Görüşmede ⋮ menüsünden \"Veri tasarrufu\"nu seçin, mümkünse Wi-Fi'ye geçin ya da kamerayı kapatıp yalnızca sesle devam edin.");
        } else set("up", "ok", `${up.toFixed(1)} Mbit/sn`);
      } catch {
        for (const id of ["latency", "down", "up"] as const) {
          setSteps((s) => s.map((x) => (x.id === id && (x.status === "idle" || x.status === "run") ? { ...x, status: "warn", detail: "Ölçülemedi." } : x)));
        }
        tips.push("İnternet hızı ölçülemedi. Bağlantınız kesilmiş olabilir ya da bir engelleyici (VPN, reklam engelleyici) ölçümü durduruyor.");
      }
    } finally {
      stream?.getTracks().forEach((t) => t.stop());
      if (preview.current) preview.current.srcObject = null;
      setLevel(0);
      setAdvice(tips);
      setRunning(false);
      setFinished(true);
    }
  };

  const worst: Status = steps.some((s) => s.status === "fail") ? "fail" : steps.some((s) => s.status === "warn") ? "warn" : "ok";

  return (
    <div className="w-full max-w-md rounded-2xl border border-line bg-panel p-6 sm:p-8">
      <div className="mb-4 flex items-center gap-2">
        <HeartHandshake className="text-accent" size={26} />
        <span className="text-lg font-semibold">Bağlantı testi</span>
        {onClose && (
          <button onClick={onClose} className="ml-auto rounded-md p-1 text-muted hover:text-ink" aria-label="Kapat">
            <X size={18} />
          </button>
        )}
      </div>
      <p className="text-sm text-muted">
        Görüşmeden önce kameranızı, mikrofonunuzu ve internetinizi kontrol eder. Yaklaşık yarım dakika sürer; hiçbir kayıt tutulmaz.
      </p>

      <div className="mt-4 aspect-video overflow-hidden rounded-xl border border-line bg-bg">
        <video ref={preview} autoPlay playsInline muted className="h-full w-full -scale-x-100 object-cover" />
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line" aria-hidden>
        <div className="h-full bg-ok transition-[width] duration-100" style={{ width: `${Math.round(level * 100)}%` }} />
      </div>

      <ul className="mt-4 space-y-2.5">
        {steps.map((s) => (
          <li key={s.id} className="flex items-start gap-2.5 text-sm">
            <span className="mt-0.5 shrink-0">{ICON[s.status]}</span>
            <span className="min-w-0">
              <span className={cx(s.status === "idle" && "text-faint")}>{s.label}</span>
              {s.detail && <span className="block text-xs text-muted">{s.detail}</span>}
            </span>
          </li>
        ))}
      </ul>

      {finished && (
        <div
          className={cx(
            "mt-4 rounded-lg border px-3 py-2.5 text-sm",
            worst === "ok" ? "border-ok/40 bg-ok/10 text-ok" : worst === "warn" ? "border-warn/40 bg-warn/10 text-warn" : "border-danger/40 bg-danger/10 text-danger",
          )}
          role="status"
        >
          <div className="flex items-center gap-1.5 font-medium">
            {worst === "ok" ? <Check size={15} /> : <CircleAlert size={15} />}
            {worst === "ok" ? "Her şey yolunda, görüşmeye hazırsınız." : worst === "warn" ? "Görüşme yapılabilir, ancak dikkat edilmesi gerekenler var." : "Görüşme için çözülmesi gereken bir sorun var."}
          </div>
          {advice.length > 0 && (
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-xs leading-relaxed">
              {advice.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Button className="mt-5 w-full py-2.5" onClick={run} disabled={running}>
        {running ? "Test sürüyor…" : finished ? "Testi yeniden çalıştır" : "Testi başlat"}
      </Button>
      <p className="mt-3 text-[11px] leading-relaxed text-faint">
        Hız ölçümü için Cloudflare'in herkese açık hız test sunucusu kullanılır; yalnızca rastgele veri gönderilip alınır, kişisel bilginiz paylaşılmaz.
      </p>
    </div>
  );
}

/** Bağlantı testi tek başına bir sayfa olarak da açılır (`/#test`). */
export function ConnectionTestPage() {
  return (
    <div className="flex h-full items-center justify-center overflow-y-auto p-4">
      <ConnectionTest />
    </div>
  );
}
