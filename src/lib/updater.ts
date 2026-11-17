// Otomatik güncelleme (yalnızca masaüstü). Android'de güncellemeyi Play Store yapar.
// Güncelleme paketi imzalıdır; imza tauri.conf.json içindeki genel anahtarla doğrulanır.
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type { Update };

export function updatesSupported(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window && !/android/i.test(navigator.userAgent);
}

/** Yeni sürüm varsa döndürür, yoksa `null`. Hata fırlatır (arayüz isterse gösterir). */
export async function checkForUpdate(): Promise<Update | null> {
  if (!updatesSupported()) return null;
  return await check();
}

/** Sessiz denetim: ağ yoksa ya da yayın yoksa sorun çıkarmaz. */
export async function checkQuietly(): Promise<Update | null> {
  try {
    return await checkForUpdate();
  } catch {
    return null;
  }
}

/** İndirir, kurar ve uygulamayı yeniden başlatır. İlerleme 0–1 arasında bildirilir. */
export async function installUpdate(update: Update, onProgress?: (p: number | null) => void): Promise<void> {
  let total = 0;
  let got = 0;
  await update.downloadAndInstall((e) => {
    if (e.event === "Started") total = e.data.contentLength ?? 0;
    else if (e.event === "Progress") {
      got += e.data.chunkLength;
      onProgress?.(total ? Math.min(1, got / total) : null);
    } else if (e.event === "Finished") onProgress?.(1);
  });
  await relaunch();
}
