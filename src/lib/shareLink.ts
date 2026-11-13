import { openUrl } from "@tauri-apps/plugin-opener";

/** Metni WhatsApp'ta (uygulama açıksa uygulamada) göndermek üzere açar; kişiyi terapist seçer. */
export async function shareViaWhatsApp(text: string): Promise<void> {
  await openUrl(`https://wa.me/?text=${encodeURIComponent(text)}`);
}
