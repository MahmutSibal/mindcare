// Danışan tarafı: terapistin başlattığı ortak çizim tuvali. Ses ve görüntü açık kalır;
// alttaki mikrofon, kamera ve çıkış düğmeleri her zaman erişilebilir.

import { Minimize2, Pencil } from "lucide-react";
import BoardCanvas from "../src/components/BoardCanvas";
import type { BoardApi } from "../src/lib/useBoard";

export default function BoardOverlay({ boardApi, video, onMinimize, backdropUrl }: {
  boardApi: BoardApi;
  /** Arka plan görseli (terapistin gösterdiği materyal). */
  backdropUrl: string | null;
  /** Terapistin küçük görüntüsü (tuvalin üstünde). */
  video: React.ReactNode;
  onMinimize: () => void;
}) {
  const session = boardApi.session!;
  return (
    <div className="absolute inset-0 z-30 flex flex-col gap-2 bg-bg p-2 sm:p-3">
      <div className="flex shrink-0 items-center gap-2">
        {video && <div className="h-14 w-20 shrink-0 overflow-hidden rounded-lg border border-line bg-black">{video}</div>}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-sm font-medium">
            <Pencil size={14} className="text-accent" /> Ortak çizim
          </div>
          {session.prompt && <p className="text-xs leading-snug text-muted">{session.prompt}</p>}
        </div>
        <button
          onClick={onMinimize}
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-line bg-card px-3 text-xs text-ink hover:bg-line"
          title="Görüntüye dön (çizim kapanmaz)"
        >
          <Minimize2 size={14} /> Küçült
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <BoardCanvas board={boardApi.board} rev={boardApi.rev} sessionId={session.id} send={boardApi.send} onChange={boardApi.bump} backdropUrl={backdropUrl} />
      </div>
    </div>
  );
}
