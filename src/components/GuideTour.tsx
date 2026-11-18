// Görselli kullanım rehberi (Türkçe / İngilizce). İlk açılışta bir kez gösterilir; Ayarlar > Hakkında ve
// yan menüdeki yardım düğmesinden yeniden açılır. Görseller sade SVG çizimlerdir (ekran görüntüsü değil).

import { type ReactNode, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { useBackClose } from "../lib/backStack";
import { Button, cx } from "./ui";

type Lang = "tr" | "en";
const KEY = "mavi-ruh-guide-lang";

function initialLang(): Lang {
  try {
    const s = localStorage.getItem(KEY);
    if (s === "tr" || s === "en") return s;
  } catch {
    /* depolama kapalı */
  }
  return navigator.language?.toLowerCase().startsWith("tr") ? "tr" : "en";
}

interface Step {
  art: () => ReactNode;
  title: Record<Lang, string>;
  points: Record<Lang, string[]>;
}

const C = {
  bg: "var(--color-bg)", panel: "var(--color-panel)", card: "var(--color-card)", line: "var(--color-line)",
  ink: "var(--color-ink)", muted: "var(--color-muted)", accent: "var(--color-accent)", soft: "var(--color-accent-soft)", danger: "var(--color-danger)",
};

const Frame = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 320 180" className="h-full w-full" role="img" aria-hidden="true">
    <rect width="320" height="180" rx="14" fill={C.panel} />
    {children}
  </svg>
);

const ART = {
  welcome: () => (
    <Frame>
      <circle cx="160" cy="80" r="38" fill={C.soft} stroke={C.accent} strokeWidth="2" />
      <rect x="143" y="76" width="34" height="26" rx="5" fill={C.accent} />
      <path d="M150 76v-8a10 10 0 0 1 20 0v8" fill="none" stroke={C.accent} strokeWidth="4" strokeLinecap="round" />
      <circle cx="160" cy="89" r="4" fill={C.bg} />
      <rect x="96" y="138" width="128" height="10" rx="5" fill={C.card} />
      <rect x="116" y="154" width="88" height="8" rx="4" fill={C.line} />
    </Frame>
  ),
  patient: () => (
    <Frame>
      <rect x="24" y="22" width="272" height="136" rx="10" fill={C.card} />
      {[0, 1, 2].map((i) => (
        <g key={i} transform={`translate(0 ${i * 38})`}>
          <circle cx="52" cy="54" r="12" fill={i === 0 ? C.accent : C.line} />
          <rect x="72" y="46" width="90" height="8" rx="4" fill={C.ink} opacity={i === 0 ? 1 : 0.5} />
          <rect x="72" y="60" width="60" height="6" rx="3" fill={C.muted} opacity="0.6" />
          <rect x="240" y="48" width="40" height="14" rx="7" fill={C.soft} />
        </g>
      ))}
      <circle cx="268" cy="36" r="14" fill={C.accent} />
      <path d="M268 29v14M261 36h14" stroke={C.bg} strokeWidth="3" strokeLinecap="round" />
    </Frame>
  ),
  call: () => (
    <Frame>
      <rect x="24" y="22" width="180" height="120" rx="10" fill={C.card} />
      <circle cx="114" cy="72" r="20" fill={C.accent} opacity="0.85" />
      <rect x="86" y="98" width="56" height="24" rx="12" fill={C.accent} opacity="0.5" />
      <rect x="148" y="104" width="48" height="30" rx="6" fill={C.line} />
      <rect x="216" y="22" width="80" height="62" rx="10" fill={C.card} />
      <rect x="226" y="34" width="60" height="8" rx="4" fill={C.accent} />
      <rect x="226" y="50" width="48" height="6" rx="3" fill={C.muted} opacity="0.6" />
      <rect x="226" y="62" width="54" height="6" rx="3" fill={C.muted} opacity="0.6" />
      <path d="M216 100l16-6h52a8 8 0 0 1 8 8v14a8 8 0 0 1-8 8h-52l-16 6z" fill={C.soft} stroke={C.accent} strokeWidth="1.5" />
      <path d="M244 112h36" stroke={C.accent} strokeWidth="3" strokeLinecap="round" />
      {[84, 114, 144].map((x) => (
        <circle key={x} cx={x + 8} cy="160" r="9" fill={C.card} stroke={C.line} />
      ))}
      <circle cx="176" cy="160" r="9" fill={C.danger} />
    </Frame>
  ),
  session: () => (
    <Frame>
      <rect x="20" y="20" width="150" height="140" rx="10" fill={C.card} />
      {[0, 1, 2, 3, 4].map((i) => (
        <rect key={i} x="32" y={34 + i * 20} width={118 - (i % 2) * 28} height="7" rx="3.5" fill={i === 0 ? C.accent : C.muted} opacity={i === 0 ? 1 : 0.5} />
      ))}
      <rect x="182" y="20" width="118" height="40" rx="10" fill={C.card} />
      <rect x="194" y="33" width="14" height="14" rx="3" fill={C.accent} />
      <rect x="216" y="34" width="62" height="6" rx="3" fill={C.ink} opacity="0.8" />
      <rect x="216" y="45" width="44" height="5" rx="2.5" fill={C.muted} opacity="0.6" />
      <rect x="182" y="68" width="118" height="40" rx="10" fill={C.card} />
      <path d="M194 90c6-12 12 8 18-4s10 6 14-2" fill="none" stroke={C.accent} strokeWidth="2.5" strokeLinecap="round" />
      <rect x="236" y="80" width="52" height="6" rx="3" fill={C.ink} opacity="0.8" />
      <rect x="182" y="116" width="118" height="44" rx="10" fill={C.card} />
      <rect x="194" y="130" width="14" height="14" rx="3" fill={C.accent} opacity="0.7" />
      <rect x="216" y="132" width="62" height="6" rx="3" fill={C.ink} opacity="0.8" />
      <rect x="216" y="143" width="40" height="5" rx="2.5" fill={C.muted} opacity="0.6" />
    </Frame>
  ),
  record: () => (
    <Frame>
      <rect x="24" y="22" width="272" height="100" rx="10" fill={C.card} />
      <circle cx="160" cy="72" r="20" fill={C.accent} opacity="0.75" />
      <rect x="124" y="96" width="72" height="14" rx="7" fill={C.accent} opacity="0.4" />
      <rect x="34" y="30" width="62" height="20" rx="10" fill={C.danger} opacity="0.92" />
      <circle cx="46" cy="40" r="4" fill="#fff" />
      <rect x="54" y="37" width="34" height="6" rx="3" fill="#fff" />
      <rect x="24" y="132" width="272" height="30" rx="10" fill={C.soft} stroke={C.accent} strokeWidth="1.5" />
      <path d="M44 147l6 6 12-12" fill="none" stroke={C.accent} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="72" y="143" width="140" height="7" rx="3.5" fill={C.ink} opacity="0.8" />
      <rect x="236" y="140" width="48" height="14" rx="7" fill={C.accent} />
    </Frame>
  ),
  calendar: () => (
    <Frame>
      <rect x="24" y="22" width="150" height="136" rx="10" fill={C.card} />
      <rect x="24" y="22" width="150" height="26" rx="10" fill={C.accent} opacity="0.85" />
      {Array.from({ length: 20 }, (_, i) => (
        <rect key={i} x={36 + (i % 5) * 26} y={58 + Math.floor(i / 5) * 22} width="18" height="14" rx="4" fill={i === 7 || i === 12 ? C.accent : C.line} opacity={i === 7 || i === 12 ? 1 : 0.7} />
      ))}
      <rect x="186" y="22" width="110" height="62" rx="10" fill={C.card} />
      <text x="198" y="50" fontSize="16" fontWeight="700" fill={C.ink} fontFamily="system-ui">1.500 ₺</text>
      <rect x="198" y="58" width="70" height="6" rx="3" fill={C.muted} opacity="0.6" />
      <rect x="198" y="68" width="40" height="6" rx="3" fill={C.accent} />
      <rect x="186" y="96" width="110" height="62" rx="10" fill={C.card} />
      <path d="M198 144l12-10 10 6 14-16 12 8 20-18" fill="none" stroke={C.accent} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </Frame>
  ),
  safe: () => (
    <Frame>
      <path d="M160 30l50 18v34c0 30-20 52-50 66-30-14-50-36-50-66V48z" fill={C.soft} stroke={C.accent} strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M138 84l16 16 28-32" fill="none" stroke={C.accent} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="262" cy="132" r="14" fill="none" stroke={C.accent} strokeWidth="4" />
      <path d="M262 146v16M262 154h8" stroke={C.accent} strokeWidth="4" strokeLinecap="round" />
      <rect x="40" y="128" width="64" height="28" rx="8" fill={C.card} />
      <path d="M52 142h40M52 142l8-6M52 142l8 6" stroke={C.muted} strokeWidth="2.5" strokeLinecap="round" fill="none" />
    </Frame>
  ),
};

const STEPS: Step[] = [
  {
    art: ART.welcome,
    title: { tr: "Mavi Ruh'a hoş geldiniz", en: "Welcome to Mavi Ruh" },
    points: {
      tr: [
        "Danışan kayıtlarınız yalnızca bu bilgisayarda, şifreli saklanır; hiçbir sunucuya gönderilmez.",
        "Aşağıdaki 6 adım, uygulamayı birkaç dakikada tanımanız için. İstediğiniz zaman kapatabilirsiniz.",
      ],
      en: [
        "Your client records are stored only on this computer, encrypted; nothing is sent to a server.",
        "These 6 steps will get you started in a few minutes. You can close this guide at any time.",
      ],
    },
  },
  {
    art: ART.patient,
    title: { tr: "1. Danışan ekleyin", en: "1. Add a client" },
    points: {
      tr: [
        "Soldaki menüden Danışanlar'a gidin ve «Yeni Danışan»a basın.",
        "Ad, iletişim ve acil durum kişisini girin; başvuru nedenini ekleyin.",
        "Danışanı seçtiğinizde Ana Sayfa'da dosyası açılır.",
      ],
      en: [
        "Open Clients from the left menu and press “New client”.",
        "Enter the name, contact details and an emergency contact; add the reason for referral.",
        "Select the client to open their file on the Home page.",
      ],
    },
  },
  {
    art: ART.call,
    title: { tr: "2. Görüntülü görüşme başlatın", en: "2. Start a video session" },
    points: {
      tr: [
        "Ana Sayfa'da «Görüntülü Görüşme Başlat»a basın ve davet bağlantısını WhatsApp ile danışana gönderin.",
        "Danışan bağlantıyı tarayıcıdan açar; uygulama kurması gerekmez. Bağlantı tek kullanımlıktır.",
        "Danışan katılınca görüşme otomatik başlar. Bitirmek için kırmızı düğmeyi kullanın.",
      ],
      en: [
        "On the Home page press “Start video session” and send the invite link to your client via WhatsApp.",
        "The client opens the link in a browser; no app install is needed. The link is single-use.",
        "The session starts as soon as they join. Use the red button to end it.",
      ],
    },
  },
  {
    art: ART.session,
    title: { tr: "3. Seansı yürütün", en: "3. Run the session" },
    points: {
      tr: [
        "Sağdaki alanda seans notlarınızı alın; şablonlardan (SOAP, DAP) yararlanın. Notlar otomatik kaydedilir.",
        "Test gönderin, ödev verin, materyal gösterin ya da «Ortak çizim» ile birlikte çizin.",
        "Testin sonucunu, nota tek tıkla ekleyebilirsiniz.",
      ],
      en: [
        "Take session notes on the right; use the templates (SOAP, DAP). Notes save automatically.",
        "Send a test, give homework, show material or draw together with “Shared drawing”.",
        "A test result can be added to your notes with one click.",
      ],
    },
  },
  {
    art: ART.record,
    title: { tr: "4. Seans kaydı (isteğe bağlı)", en: "4. Session recording (optional)" },
    points: {
      tr: [
        "«Kaydı başlat»a basınca danışandan izin istenir. Danışan kabul etmeden kayıt başlamaz.",
        "Kayıt sürerken iki tarafta gösterge görünür; danışan istediği an durdurabilir.",
        "Kayıtlar danışanın dosyasında, «Dosyalar» sekmesinde saklanır (saatte yaklaşık 400 MB).",
      ],
      en: [
        "Pressing “Start recording” asks your client for permission. Nothing is recorded until they agree.",
        "While recording, both sides see an indicator; the client can stop it at any time.",
        "Recordings are kept in the client's file under “Files” (about 400 MB per hour).",
      ],
    },
  },
  {
    art: ART.calendar,
    title: { tr: "5. Randevu ve ücret takibi", en: "5. Appointments and fees" },
    points: {
      tr: [
        "Takvim bölümünden randevu oluşturun; WhatsApp ile hatırlatın veya takviminize aktarın (.ics).",
        "Randevu saati gelince Ana Sayfa'da «Seansı başlat» bildirimi çıkar.",
        "Danışanlar > Ücretler bölümünde seans ücretini, ödemeleri ve makbuzu yönetin.",
      ],
      en: [
        "Create appointments in Calendar; remind clients on WhatsApp or export them to your calendar (.ics).",
        "When it is time, a “Start session” prompt appears on the Home page.",
        "Manage session fees, payments and receipts under Clients > Fees.",
      ],
    },
  },
  {
    art: ART.safe,
    title: { tr: "6. Verilerinizi güvende tutun", en: "6. Keep your data safe" },
    points: {
      tr: [
        "Ayarlar > Güvenlik ve yedek: düzenli şifreli yedek alın ve kurtarma anahtarınızı güvenli bir yerde saklayın.",
        "Bilgisayarı açık bıraktığınızda başkası görmesin diye uygulama kilidi (PIN) koyabilirsiniz.",
        "Bu rehbere Ayarlar > Hakkında bölümünden ya da yan menüdeki «?» düğmesinden tekrar ulaşabilirsiniz.",
      ],
      en: [
        "Settings > Security and backup: make regular encrypted backups and keep your recovery key somewhere safe.",
        "Set an app lock (PIN) so nobody can see client data if you leave the computer open.",
        "You can reopen this guide from Settings > About or the “?” button in the side menu.",
      ],
    },
  },
];

const UI = {
  tr: { next: "İleri", prev: "Geri", done: "Başla", skip: "Atla", close: "Kapat", step: "Adım" },
  en: { next: "Next", prev: "Back", done: "Get started", skip: "Skip", close: "Close", step: "Step" },
};

export default function GuideTour({ onClose }: { onClose: () => void }) {
  const [i, setI] = useState(0);
  const [lang, setLang] = useState<Lang>(initialLang);
  useBackClose(true, onClose);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, lang);
    } catch {
      /* yok say */
    }
  }, [lang]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setI((n) => Math.min(STEPS.length - 1, n + 1));
      if (e.key === "ArrowLeft") setI((n) => Math.max(0, n - 1));
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const step = STEPS[i]!;
  const last = i === STEPS.length - 1;
  const t = UI[lang];

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/70 sm:items-center sm:p-6" role="dialog" aria-modal="true">
      <div className="flex max-h-[96dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl border border-line bg-bg shadow-2xl sm:rounded-2xl">
        <header className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-3 sm:px-5">
          <span className="text-xs text-muted">{t.step} {i + 1} / {STEPS.length}</span>
          <div className="ml-auto inline-flex rounded-md border border-line" role="group" aria-label="Language">
            {(["tr", "en"] as const).map((l) => (
              <button
                key={l}
                onClick={() => setLang(l)}
                aria-pressed={lang === l}
                className={cx("px-2.5 py-1 text-xs", lang === l ? "rounded bg-accent-soft font-semibold text-ink" : "text-muted hover:text-ink")}
              >
                {l.toUpperCase()}
              </button>
            ))}
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 text-muted hover:bg-card hover:text-ink" aria-label={t.close}>
            <X size={18} />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto p-4 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] sm:items-center sm:p-6">
          <div className="mx-auto aspect-[16/9] w-full max-w-md overflow-hidden rounded-2xl border border-line">{step.art()}</div>
          <div>
            <h2 className="text-xl font-semibold">{step.title[lang]}</h2>
            <ul className="mt-3 space-y-2.5 text-sm leading-relaxed text-muted">
              {step.points[lang].map((p) => (
                <li key={p} className="flex gap-2.5">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <footer className="flex shrink-0 items-center gap-3 border-t border-line px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5">
          {i === 0 ? (
            <Button variant="ghost" onClick={onClose}>{t.skip}</Button>
          ) : (
            <Button variant="ghost" onClick={() => setI(i - 1)}><ArrowLeft size={16} /> {t.prev}</Button>
          )}
          <div className="mx-auto flex gap-1.5" aria-hidden="true">
            {STEPS.map((_, n) => (
              <button key={n} onClick={() => setI(n)} className={cx("h-2 rounded-full transition-all", n === i ? "w-5 bg-accent" : "w-2 bg-line hover:bg-muted")} tabIndex={-1} />
            ))}
          </div>
          {last ? (
            <Button onClick={onClose}>{t.done}</Button>
          ) : (
            <Button onClick={() => setI(i + 1)}>{t.next} <ArrowRight size={16} /></Button>
          )}
        </footer>
      </div>
    </div>
  );
}
