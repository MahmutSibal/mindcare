// Danışan tarafı: terapistin başlattığı ortak çizim tuvali. Ses ve görüntü açık kalır;
// alttaki mikrofon, kamera ve çıkış düğmeleri her zaman erişilebilir.

import { Minimize2, Pencil } from "lucide-react";
import { t } from "./i18n";
import BoardCanvas from "../src/components/BoardCanvas";
import type { BoardApi } from "../src/lib/useBoard";

export default function BoardOverlay({ boardApi, video, selfVideo, onMinimize, backdropUrl }: {
  boardApi: BoardApi;
  /** Arka plan görseli (terapistin gösterdiği materyal). */
  backdropUrl: string | null;
  /** Terapistin küçük görüntüsü (tuvalin üstünde). */
  video: React.ReactNode;
  /** Danışanın kendi küçük görüntüsü (tuval açıkken de kendini görsün). */
  selfVideo?: React.ReactNode;
  onMinimize: () => void;
}) {
  const session = boardApi.session!;
  return (
    <div className="absolute inset-0 z-30 flex flex-col gap-2.5 bg-bg p-2.5 pt-[max(0.625rem,env(safe-area-inset-top))] sm:p-4">
      <div className="flex shrink-0 items-center gap-3">
        {video && <div className="h-14 w-20 shrink-0 overflow-hidden rounded-xl border border-line bg-black shadow-md sm:h-16 sm:w-24">{video}</div>}
        {selfVideo && <div className="h-14 w-20 shrink-0 overflow-hidden rounded-xl border border-line bg-black shadow-md sm:h-16 sm:w-24">{selfVideo}</div>}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-sm font-semibold">
            <Pencil size={14} className="shrink-0 text-accent" /> {t("Ortak çizim")}{session.pdf && <span className="ml-1 rounded-md bg-card px-1.5 py-0.5 text-xs font-normal tabular-nums text-muted">{t("Sayfa")} {session.pdf.page} / {session.pdf.total}</span>}
          </div>
          {session.prompt && <p className="mt-0.5 line-clamp-3 text-xs leading-snug text-muted">{session.prompt}</p>}
        </div>
        <button
          onClick={onMinimize}
          className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl border border-line bg-card px-3.5 text-xs font-medium text-ink transition-colors hover:bg-line"
          title={t("Görüntüye dön (çizim kapanmaz)")}
        >
          <Minimize2 size={15} /> <span>{t("Küçült")}</span>
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <BoardCanvas board={boardApi.board} rev={boardApi.rev} sessionId={session.id} send={boardApi.send} onChange={boardApi.bump} backdropUrl={backdropUrl} aspect={session.aspect} />
      </div>
    </div>
  );
}
