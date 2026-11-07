// Danışan tarafı: terapist bağlanana kadar sakinleştirici bekleme ekranı.
// Nefes egzersizi (4 sn al, 4 sn tut, 6 sn ver) ve sırayla değişen destekleyici cümleler.
// Cümleler bu uygulama için yazıldı; alıntı değildir.

import { useEffect, useState } from "react";
import { Headphones, Lock } from "lucide-react";

const PHASES = [
  { label: "Nefes al", seconds: 4, scale: 1 },
  { label: "Tut", seconds: 4, scale: 1 },
  { label: "Nefes ver", seconds: 6, scale: 0.55 },
] as const;

const SENTENCES = [
  "Buraya gelmek için zaman ayırdınız; bu, kendiniz için attığınız bir adım.",
  "Şu an yapmanız gereken hiçbir şey yok. Yalnızca nefesinizi fark edin.",
  "Hissettiğiniz her şey geçerli. Burada yargılanmadan konuşabilirsiniz.",
  "Omuzlarınızı gevşetin, çenenizi bırakın, ayaklarınızın yere bastığını hissedin.",
  "Küçük adımlar da ilerlemedir.",
  "Bugün nasıl hissettiğinizi düşünmek için bu birkaç dakikayı kullanabilirsiniz.",
  "Bir yakınınıza göstereceğiniz şefkati bugün kendinize gösterin.",
  "Aklınıza gelen düşünceleri itmeye çalışmayın; gelip geçmelerine izin verin.",
];

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

export default function WaitingRoom({ reconnecting }: { reconnecting: boolean }) {
  const [phase, setPhase] = useState(0);
  const [sentence, setSentence] = useState(() => Math.floor(Math.random() * SENTENCES.length));
  const [visible, setVisible] = useState(true);
  const still = reducedMotion();

  useEffect(() => {
    const t = setTimeout(() => setPhase((p) => (p + 1) % PHASES.length), PHASES[phase]!.seconds * 1000);
    return () => clearTimeout(t);
  }, [phase]);

  useEffect(() => {
    const t = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setSentence((s) => (s + 1) % SENTENCES.length);
        setVisible(true);
      }, 600);
    }, 9000);
    return () => clearInterval(t);
  }, []);

  const p = PHASES[phase]!;

  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 bg-gradient-to-b from-panel via-bg to-accent-soft/60 px-6 pb-40 pt-16 text-center sm:pb-16">
      <div>
        <p className="text-lg font-medium text-ink">
          {reconnecting ? "Bağlantı yeniden kuruluyor…" : "Terapistiniz birazdan burada olacak"}
        </p>
        <p className="mt-1 text-sm text-muted">Beklerken birlikte birkaç nefes alalım.</p>
      </div>

      <div className="relative flex h-44 w-44 items-center justify-center" aria-hidden="true">
        <div
          className="absolute inset-0 rounded-full bg-accent/25 blur-xl"
          style={{ transform: `scale(${still ? 0.8 : p.scale})`, transition: still ? "none" : `transform ${p.seconds}s ease-in-out` }}
        />
        <div
          className="absolute inset-4 rounded-full border border-accent/50 bg-accent/15"
          style={{ transform: `scale(${still ? 0.8 : p.scale})`, transition: still ? "none" : `transform ${p.seconds}s ease-in-out` }}
        />
        <span className="relative text-base font-medium text-ink">{p.label}</span>
      </div>
      <p className="sr-only" aria-live="polite">{p.label}</p>

      <p
        className="min-h-[3.5rem] max-w-sm text-[15px] leading-relaxed text-ink/90 transition-opacity duration-500"
        style={{ opacity: visible ? 1 : 0 }}
      >
        {SENTENCES[sentence]}
      </p>

      <div className="space-y-1.5 text-xs text-faint">
        <p className="flex items-center justify-center gap-1.5"><Lock size={12} /> Görüşme şifrelidir ve kaydedilmez.</p>
        <p className="flex items-center justify-center gap-1.5"><Headphones size={12} /> Kulaklık kullanmak sesi daha net yapar.</p>
      </div>
    </div>
  );
}
