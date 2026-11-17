// Danışan tarafı: terapist seansı kaydetmek isterse açık onay sorulur. Onay verilmeden kayıt başlamaz;
// kayıt sürerken görünür bir gösterge vardır ve danışan istediği an durdurabilir.

import { Circle, ShieldCheck } from "lucide-react";
import { t } from "./i18n";

export default function RecordingNotice({ ask, active, onAnswer, onStop }: {
  ask: boolean;
  active: boolean;
  onAnswer: (accepted: boolean) => void;
  onStop: () => void;
}) {
  return (
    <>
      {active && (
        <div className="absolute left-4 top-14 z-20 flex items-center gap-2 rounded-lg bg-danger/90 py-1 pl-3 pr-1 text-xs font-medium text-white shadow-lg" role="status">
          <Circle size={9} className="animate-pulse fill-white" /> {t("Görüşme kaydediliyor")}
          <button onClick={onStop} className="rounded-md bg-black/25 px-2 py-1 hover:bg-black/40">{t("Kaydı durdur")}</button>
        </div>
      )}
      {ask && (
        <div className="absolute inset-0 z-40 flex items-end justify-center bg-black/70 p-3 sm:items-center">
          <div className="w-full max-w-md rounded-2xl border border-line bg-panel p-5 shadow-2xl" role="alertdialog" aria-modal="true" aria-label={t("Kayıt izni")}>
            <div className="mb-2 flex items-center gap-2 text-base font-semibold"><ShieldCheck size={18} className="text-accent" /> {t("Kayıt izni")}</div>
            <p className="text-sm leading-relaxed text-muted">
              {t("Terapistiniz bu görüşmeyi (görüntü, ses ve varsa ortak çizim) kaydetmek istiyor. Kayıt yalnızca terapistinizin şifreli bilgisayarında saklanır, başka kimseyle paylaşılmaz. İzin vermek zorunda değilsiniz; reddederseniz görüşme aynen devam eder. Kayıt sürerken ekranda gösterge çıkar ve istediğiniz an durdurabilirsiniz.")}
            </p>
            <div className="mt-5 flex gap-2">
              <button onClick={() => onAnswer(false)} className="h-11 flex-1 rounded-xl border border-line bg-card text-sm font-medium text-ink hover:bg-line">{t("İzin vermiyorum")}</button>
              <button onClick={() => onAnswer(true)} className="h-11 flex-1 rounded-xl bg-accent-strong text-sm font-medium text-white hover:bg-accent">{t("Kabul ediyorum")}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
