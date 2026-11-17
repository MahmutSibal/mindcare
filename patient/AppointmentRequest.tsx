// Danışan tarafı: terapiste randevu talebi. Talep yalnızca görüşme sırasında, şifreli veri kanalıyla
// terapistin ekranına gider; hiçbir sunucuya yazılmaz. Randevuyu terapist onaylayıp oluşturur.

import { useState } from "react";
import { CalendarClock } from "lucide-react";
import type { ChannelMessage } from "../src/lib/rtc";
import { t } from "./i18n";

export default function AppointmentRequest({ getCall }: { getCall: () => { sendMessage: (m: ChannelMessage) => boolean } | null }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("10:00");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<"idle" | "sent" | "failed">("idle");
  const today = new Date().toISOString().slice(0, 10);
  const field = "mt-1 w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent";

  const send = () => {
    const ok = getCall()?.sendMessage({ type: "appointment_request", date, time, note: note.trim().slice(0, 300) }) ?? false;
    setStatus(ok ? "sent" : "failed");
    if (ok) setNote("");
  };

  return (
    <div className="mb-4 border-b border-line pb-4">
      <button
        onClick={() => { setOpen(!open); setStatus("idle"); }}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-line bg-card text-sm text-ink hover:bg-line"
      >
        <CalendarClock size={16} /> {t("Randevu talebi gönder")}
      </button>
      {open && (
        <div className="mt-3 space-y-2 text-xs text-muted">
          <div className="grid grid-cols-1 gap-2 min-[380px]:grid-cols-2">
            <label>{t("Tarih")}<input type="date" min={today} className={field} value={date} onChange={(e) => setDate(e.target.value)} /></label>
            <label>{t("Saat")}<input type="time" className={field} value={time} onChange={(e) => setTime(e.target.value)} /></label>
          </div>
          <label className="block">{t("Not (isteğe bağlı)")}<input className={field} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} /></label>
          <button
            onClick={send}
            disabled={!date || !time}
            className="h-10 w-full rounded-xl bg-accent-strong text-sm font-medium text-white disabled:opacity-40"
          >
            {t("Talebi gönder")}
          </button>
          {status === "sent" && <p className="text-ok" role="status">{t("Talebiniz terapistinize iletildi. Onay için kendisi sizinle iletişime geçecek.")}</p>}
          {status === "failed" && <p className="text-danger" role="status">{t("Talep gönderilemedi. Bağlantıyı kontrol edin.")}</p>}
          <p className="text-[11px] leading-relaxed text-faint">{t("Talebiniz yalnızca görüşme sırasında, şifreli bağlantıyla terapistinize gider; hiçbir yerde saklanmaz.")}</p>
        </div>
      )}
    </div>
  );
}
