// Supabase yalnızca görüntülü görüşme sinyalleşmesi (SDP/ICE) için kullanılır.
// Bu değerler herkese açık "publishable" anahtarlardır; yetki, sunucu tarafındaki
// RLS kuralları ve tek kullanımlık davet anahtarlarıyla sağlanır.
export const SUPABASE_URL: string =
  import.meta.env.VITE_SUPABASE_URL ?? "https://tckgvtuvwyvnxabmdjas.supabase.co";
export const SUPABASE_KEY: string =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_J3iJbcsKZmqfV1-jExgdqg_0Qa2UT-T";

// Danışan web istemcisi Render'da yayında (GitHub main dalına her gönderimde otomatik güncellenir).
export const DEFAULT_PATIENT_APP_URL = "https://mavi-ruh.onrender.com";

/** Eski adres: daha önce ayarlara kaydedilmiş olabilir; yeni varsayılana çevrilir (özel adresler korunur). */
const LEGACY_PATIENT_APP_URL = "https://mindcare-gorusme.onrender.com";

/** Ayarlarda kayıtlı adresi çözer: boşsa ya da eski varsayılansa yeni adres kullanılır. */
export function resolvePatientAppUrl(saved?: string | null): string {
  const v = (saved ?? "").trim().replace(/\/+$/, "");
  return !v || v === LEGACY_PATIENT_APP_URL ? DEFAULT_PATIENT_APP_URL : v;
}

export const DEFAULT_STUN = ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"];
