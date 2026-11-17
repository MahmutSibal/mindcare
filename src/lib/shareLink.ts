import { openUrl } from "@tauri-apps/plugin-opener";

/** Telefon numarasını wa.me biçimine çevirir (Türkiye varsayılır); anlaşılamazsa null. */
export function whatsappNumber(phone: string | null | undefined): string | null {
  const d = (phone ?? "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("0")) return "90" + d.slice(1);
  if (d.length === 10 && d.startsWith("5")) return "90" + d;
  if (d.length >= 11 && d.length <= 15) return d;
  return null;
}

/** Metni WhatsApp'ta (uygulama açıksa uygulamada) göndermek üzere açar. Numara verilirse doğrudan o kişiye açılır. */
export async function shareViaWhatsApp(text: string, phone?: string | null): Promise<void> {
  const n = whatsappNumber(phone);
  await openUrl(`https://wa.me/${n ?? ""}?text=${encodeURIComponent(text)}`);
}
