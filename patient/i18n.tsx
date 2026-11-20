// Danışan sayfası dil desteği (Türkçe / İngilizce). Anahtar, Türkçe metnin kendisidir;
// çevirisi yoksa Türkçe gösterilir. Dil tarayıcıdan seçilir, localStorage'da hatırlanır.
// Görüşme sırasında dil değişince sayfa yenilenmez (bağlantı kopmaz): bileşenler `useLang()` ile yeniden çizilir.

import { useSyncExternalStore } from "react";

export type Lang = "tr" | "en";
const KEY = "mavi-ruh-lang";

function initial(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "tr" || saved === "en") return saved;
  } catch {
    /* depolama kapalı */
  }
  return typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("tr") ? "tr" : "en";
}

let lang: Lang = initial();
const listeners = new Set<() => void>();

export function setLang(l: Lang) {
  lang = l;
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* yok say */
  }
  document.documentElement.lang = l;
  listeners.forEach((f) => f());
}

export function useLang(): Lang {
  return useSyncExternalStore(
    (f) => {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    () => lang,
  );
}

/** Çeviri: `t("Türkçe metin")`. `{ad}` yer tutucuları `vars` ile doldurulur. */
export function t(tr: string, vars?: Record<string, string | number>): string {
  let s = lang === "en" ? (EN[tr] ?? tr) : tr;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

export function LangSwitch({ className = "" }: { className?: string }) {
  const l = useLang();
  const btn = (code: Lang, label: string) => (
    <button
      type="button"
      onClick={() => setLang(code)}
      aria-pressed={l === code}
      className={`px-2 py-0.5 text-xs ${l === code ? "rounded bg-accent-soft font-semibold text-ink" : "text-muted hover:text-ink"}`}
    >
      {label}
    </button>
  );
  return (
    <div className={`inline-flex items-center gap-0.5 rounded-md border border-line ${className}`} role="group" aria-label="Language">
      {btn("tr", "TR")}
      {btn("en", "EN")}
    </div>
  );
}

const EN: Record<string, string> = {
  // Katılma ekranı
  "Görüşmeye katıl": "Join the session",
  "Görüşme uçtan uca şifrelenir; siz ayrıca izin vermedikçe kaydedilmez. Katılmak için kamera ve mikrofon izni vermeniz gerekir.":
    "The session is end-to-end encrypted and is not recorded unless you separately give permission. You need to allow camera and microphone access to join.",
  "Kamera ve mikrofonu aç": "Turn on camera and microphone",
  "Kamera": "Camera",
  "Sesi aç": "Turn sound on",
  "Karşılama videosu": "Welcome video",
  "Kamerayı çevir": "Flip camera",
  "Görüşmenin görüntülü ve sesli olarak çevrim içi yapılmasını, görüşme sırasında terapistimin gönderdiği test ve ödevlere verdiğim yanıtların terapistime iletilmesini kabul ediyorum. Görüşme, ben ayrıca izin vermedikçe kaydedilmez. Görüşme süresince yalnız ve rahat konuşabileceğim bir yerde olacağım.":
    "I agree to hold the session online by video and audio, and to my answers to tests and homework sent by my therapist during the session being passed to my therapist. The session is not recorded unless I separately give permission. I will be in a place where I can talk alone and comfortably during the session.",
  "Katılınıyor…": "Joining…",
  "Görüşmeye Katıl": "Join the session",
  "Bağlantımı test et (kamera, mikrofon, internet)": "Test my connection (camera, microphone, internet)",
  "Bu bağlantı size özeldir ve tek kullanımlıktır; başkalarıyla paylaşmayın. Bağlantı bilgileri yalnızca görüşmeyi kurmak için kullanılır. Terapistinizin gönderdiği test cevapları şifreli görüşme bağlantısıyla doğrudan terapistinize iletilir; bu sayfada veya bir sunucuda saklanmaz.":
    "This link is private to you and single-use; do not share it. Connection details are used only to set up the session. Test answers are sent directly to your therapist over the encrypted session connection; they are not stored on this page or on a server.",
  "Gizlilik politikası ve aydınlatma metni": "Privacy policy and notice",
  "Bu görüşme acil yardım hattı değildir. Kendinize veya bir başkasına zarar verme düşünceniz varsa ya da acil bir durumdaysanız": "This session is not an emergency line. If you have thoughts of harming yourself or someone else, or you are in an emergency, call",
  "'yi arayın.": " (emergency number in Türkiye) or your local emergency number.",
  // Durumlar ve hatalar
  "Bu davet bağlantısı geçersiz.": "This invitation link is not valid.",
  "Bu davet bağlantısının süresi dolmuş. Terapistinizden yeni bir bağlantı isteyin.": "This invitation link has expired. Ask your therapist for a new one.",
  "Bu davet bağlantısı başka bir cihazda kullanıldı. Davetler tek kullanımlıktır.": "This invitation link was used on another device. Invitations are single-use.",
  "Bu görüşme sona erdi.": "This session has ended.",
  "Bu bağlantı terapist hesabıyla açılmış. Lütfen danışan cihazından açın.": "This link was opened with the therapist account. Please open it on the client's device.",
  "Görüşmeye katılınamadı.": "Could not join the session.",
  "Arka kamera açılamadı.": "Could not open the rear camera.",
  "Ön kamera açılamadı.": "Could not open the front camera.",
  "Bağlantı eksik veya hatalı. Lütfen terapistinizin gönderdiği bağlantıyı eksiksiz açın.": "The link is incomplete or wrong. Please open the full link your therapist sent.",
  "Görüşme sona erdi. Bu pencereyi kapatabilirsiniz.": "The session has ended. You can close this window.",
  "Bağlantı koptu, yeniden bağlanılıyor…": "Connection lost, reconnecting…",
  "Bağlanıyor": "Connecting",
  "Bağlantınız zayıf; görüntü donabilir": "Your connection is weak; video may freeze",
  "Şifreli görüşme": "Encrypted session",
  // Görüşme ekranı
  "Görüşmeden ayrılmak için kırmızı düğmeye basın": "Press the red button to leave the session",
  "Daha büyük görmek için telefonu yan çevirin": "Rotate your phone sideways to see it larger",
  "Terapistiniz bir materyal paylaştı:": "Your therapist shared material:",
  "Çizime dön": "Back to drawing",
  "Ödevlerim": "My homework",
  "Ayarları kapat": "Close settings",
  "Bu ayar yalnızca sizin kameranızdan giden görüntüyü etkiler. Görüntü donuyor ya da ses kesiliyorsa \"Veri tasarrufu\"nu deneyin.":
    "This setting only affects the video sent from your camera. If video freezes or audio cuts out, try \"Data saver\".",
  "Mikrofonu kapat": "Turn microphone off",
  "Mikrofonu aç": "Turn microphone on",
  "Kamerayı kapat": "Turn camera off",
  "Kamerayı aç": "Turn camera on",
  "Arka kameraya geç": "Switch to rear camera",
  "Ön kameraya geç": "Switch to front camera",
  "Görüşmeden ayrıl": "Leave the session",
  "Ayarlar": "Settings",
  // Bekleme odası
  "Buraya gelmek için zaman ayırdınız; bu, kendiniz için attığınız bir adım.": "You made time to be here; this is a step you are taking for yourself.",
  "Şu an yapmanız gereken hiçbir şey yok. Yalnızca nefesinizi fark edin.": "There is nothing you need to do right now. Just notice your breath.",
  "Hissettiğiniz her şey geçerli. Burada yargılanmadan konuşabilirsiniz.": "Whatever you feel is valid. You can speak here without being judged.",
  "Omuzlarınızı gevşetin, çenenizi bırakın, ayaklarınızın yere bastığını hissedin.": "Relax your shoulders, soften your jaw, feel your feet on the floor.",
  "Küçük adımlar da ilerlemedir.": "Small steps are progress too.",
  "Bugün nasıl hissettiğinizi düşünmek için bu birkaç dakikayı kullanabilirsiniz.": "You can use these few minutes to think about how you feel today.",
  "Bir yakınınıza göstereceğiniz şefkati bugün kendinize gösterin.": "Show yourself today the kindness you would show someone close to you.",
  "Aklınıza gelen düşünceleri itmeye çalışmayın; gelip geçmelerine izin verin.": "Do not try to push thoughts away; let them come and go.",
  "Bağlantı yeniden kuruluyor…": "Reconnecting…",
  "Terapistiniz birazdan burada olacak": "Your therapist will be here shortly",
  "Beklerken birlikte birkaç nefes alalım.": "Let us take a few breaths together while we wait.",
  "Görüşme şifrelidir; izniniz olmadan kaydedilmez.": "The session is encrypted and is not recorded without your permission.",
  "Görüşme kaydediliyor": "Session is being recorded",
  "Ses ve görüntü": "Sound and video",
  "Sayfa": "Page",
  "Mikrofon": "Microphone",
  "Hoparlör / kulaklık": "Speaker / headphones",
  "Sesi dene": "Test sound",
  "Cihaz bulunamadı": "No device found",
  "Bu cihazda hoparlör seçimi desteklenmiyor; sesi sistem ayarlarından seçebilirsiniz.": "Speaker selection is not supported on this device; choose the sound output in your system settings.",
  "Ses 48 kHz ve yüksek bit hızıyla, görüntü bağlantı elverdiğince Full HD'ye kadar gönderilir. Kulaklık kullanmak yankıyı ve gürültüyü azaltır.": "Audio is sent at 48 kHz and a high bitrate, video up to Full HD as your connection allows. Headphones reduce echo and noise.",
  "Kaydı durdur": "Stop recording",
  "Kayıt izni": "Recording permission",
  "Terapistiniz bu görüşmeyi (görüntü, ses ve varsa ortak çizim) kaydetmek istiyor. Kayıt yalnızca terapistinizin şifreli bilgisayarında saklanır, başka kimseyle paylaşılmaz. İzin vermek zorunda değilsiniz; reddederseniz görüşme aynen devam eder. Kayıt sürerken ekranda gösterge çıkar ve istediğiniz an durdurabilirsiniz.": "Your therapist would like to record this session (video, audio and the shared drawing if used). The recording is stored only on your therapist's encrypted computer and is not shared with anyone else. You do not have to agree; if you decline, the session continues as normal. An indicator is shown while recording and you can stop it at any time.",
  "İzin vermiyorum": "I do not agree",
  "Kabul ediyorum": "I agree",
  "Kulaklık kullanmak sesi daha net yapar.": "Using headphones makes the sound clearer.",
  // Test
  "Bağlantı şu an kurulu değil. Birkaç saniye sonra tekrar deneyin.": "The connection is not ready right now. Try again in a few seconds.",
  "Teşekkürler": "Thank you",
  "Cevaplarınız terapistinize iletildi.": "Your answers were sent to your therapist.",
  "Terapistiniz bir test gönderdi": "Your therapist sent you a test",
  "İsteğe bağlı": "Optional",
  "Tüm sorular cevaplandı": "All questions answered",
  "{n} / {total} cevaplandı": "{n} / {total} answered",
  "Gönder": "Send",
  // Ödev
  "Ödevleriniz": "Your homework",
  "İndir": "Download",
  "Kopyalandı": "Copied",
  "Kopyala": "Copy",
  "Bu sayfa görüşme bitince kapanır. Ödevinizi kaybetmemek için indirin veya kopyalayıp notlarınıza ekleyin.":
    "This page closes when the session ends. To keep your homework, download it or copy it into your notes.",
  // Dosya gönderme
  "Görüşme bağlı değil.": "The session is not connected.",
  "Bu dosya türü gönderilemez. Fotoğraf, PDF, metin, Word belgesi veya ses dosyası seçin.": "This file type cannot be sent. Choose a photo, PDF, text, Word document or audio file.",
  "Dosya boş.": "The file is empty.",
  "Bağlantı kesildi; dosya gönderilemedi.": "Connection lost; the file could not be sent.",
  "Terapist dosyayı alamadı.": "The therapist could not receive the file.",
  "Terapiste dosya gönder": "Send a file to your therapist",
  "Terapistin onayı bekleniyor…": "Waiting for the therapist to confirm…",
  "Terapiste ulaştı.": "Delivered to your therapist.",
  "Tamam": "OK",
  "Gönderiliyor…": "Sending…",
  // Randevu talebi
  "Randevu talebi gönder": "Request an appointment",
  "Tarih": "Date",
  "Saat": "Time",
  "Not (isteğe bağlı)": "Note (optional)",
  "Talebi gönder": "Send request",
  "Talebiniz terapistinize iletildi. Onay için kendisi sizinle iletişime geçecek.": "Your request was sent to your therapist. They will contact you to confirm.",
  "Talep gönderilemedi. Bağlantıyı kontrol edin.": "The request could not be sent. Check your connection.",
  "Talebiniz yalnızca görüşme sırasında, şifreli bağlantıyla terapistinize gider; hiçbir yerde saklanmaz.": "Your request goes to your therapist only during the session, over the encrypted connection; it is not stored anywhere.",

  // Grup görüşmesi
  "Grup görüşmesine katıl": "Join the group session",
  "Bu bir grup görüşmesidir; terapistin yanında gruptaki diğer katılımcılar da sizi görür ve duyar. Görüşme uçtan uca şifrelenir ve kaydedilmez.":
    "This is a group session; besides the therapist, the other participants in the group can also see and hear you. The session is end-to-end encrypted and is not recorded.",
  "Görüşmenin çevrim içi, görüntülü ve sesli bir grup görüşmesi olarak yapılmasını, diğer katılımcıların beni görüp duyacağını kabul ediyorum. Gruptaki diğer kişilerin paylaştıklarını gizli tutacağım. Görüşme kaydedilmez.":
    "I agree to the session being held online by video and audio as a group session, and that the other participants will see and hear me. I will keep what others in the group share confidential. The session is not recorded.",
  "Bu bağlantı size özeldir ve tek kullanımlıktır; başkalarıyla paylaşmayın.": "This link is private to you and single-use; do not share it.",
  "Grup görüşmesi sona erdi. Bu pencereyi kapatabilirsiniz.": "The group session has ended. You can close this window.",
  "Şifreli grup görüşmesi": "Encrypted group session",
  "Yeniden bağlanılıyor…": "Reconnecting…",
  "Bağlanıyor…": "Connecting…",
  "bağlanıyor": "connecting",
  "Menüyü kapat": "Close menu",
  "Gönderdiğiniz dosyayı yalnızca terapistiniz görür; gruptaki diğer kişilere gitmez.": "Only your therapist sees the file you send; it does not go to others in the group.",
  // Materyal
  "Video başlatılmadı": "Video not started",
  "Oynatılıyor": "Playing",
  "Duraklatıldı": "Paused",
  "Yükleniyor…": "Loading…",
  "Video bitti": "Video ended",
  "Videoyu başlat": "Start video",
  "Terapistiniz bir bağlantı paylaştı:": "Your therapist shared a link:",
  "Bağlantıyı yeni sekmede aç": "Open link in a new tab",
  "Terapistiniz bir materyal paylaşıyor:": "Your therapist is sharing material:",
  "Terapistiniz bir belge paylaştı": "Your therapist shared a document",
  "Aç": "Open",
  // Çizim
  "Ortak çizim": "Shared drawing",
  "Görüntüye dön (çizim kapanmaz)": "Back to video (the drawing stays open)",
  "Küçült": "Minimize",
  // Bağlantı testi
  "Bağlantı testi": "Connection test",
  "Kapat": "Close",
  "Görüşmeden önce kameranızı, mikrofonunuzu ve internetinizi kontrol eder. Yaklaşık yarım dakika sürer; hiçbir kayıt tutulmaz.":
    "Checks your camera, microphone and internet before the session. Takes about half a minute; nothing is recorded.",
  "Tarayıcı desteği": "Browser support",
  "Kamera ve mikrofon": "Camera and microphone",
  "Doğrudan bağlantı": "Direct connection",
  "Gecikme": "Latency",
  "İndirme hızı": "Download speed",
  "Gönderme hızı (görüntünüz için)": "Upload speed (for your video)",
  "yüksek": "high",
  "düşük": "low",
  "Destekleniyor.": "Supported.",
  "Bu tarayıcı görüntülü görüşmeyi desteklemiyor.": "This browser does not support video calls.",
  "Telefonda Chrome (Android) veya Safari (iPhone), bilgisayarda Chrome, Edge ya da Safari kullanın. Uygulama içi tarayıcılardan (Instagram, WhatsApp vb.) açmayın.":
    "Use Chrome (Android) or Safari (iPhone) on a phone, or Chrome, Edge or Safari on a computer. Do not open it from in-app browsers (Instagram, WhatsApp, etc.).",
  "İzin isteniyor…": "Asking for permission…",
  "Birkaç kelime konuşun…": "Say a few words…",
  "Mikrofondan ses algılanmadı.": "No sound detected from the microphone.",
  "Mikrofonunuz ses almıyor: cihazın sessize alınmadığını, mikrofonun başka bir uygulamada kullanılmadığını ve tarayıcıda mikrofon izninin açık olduğunu kontrol edin.":
    "Your microphone is not picking up sound: check that the device is not muted, the microphone is not used by another app, and microphone permission is on in the browser.",
  "Kamera açıldı, mikrofon sesinizi alıyor.": "Camera is on, the microphone is picking up your voice.",
  "Kamera/mikrofon izni verilmedi.": "Camera/microphone permission was not granted.",
  "Kamera veya mikrofon açılamadı.": "Could not open the camera or microphone.",
  "Tarayıcının adres çubuğundaki kilit simgesinden kamera ve mikrofon iznini açıp testi yeniden çalıştırın.":
    "Allow camera and microphone from the lock icon in the browser address bar, then run the test again.",
  "Ağınız doğrudan bağlantıya uygun.": "Your network supports a direct connection.",
  "Ağınız doğrudan bağlantıyı kısıtlıyor; görüşme yedek yoldan kurulacak.": "Your network restricts direct connections; the session will use a relay.",
  "Ağınız doğrudan bağlantıyı engelliyor. Görüşme yine kurulur ama kalite biraz düşebilir. VPN veya şirket/okul ağı kullanıyorsanız kapatıp kendi Wi-Fi'nize ya da mobil verinize geçin.":
    "Your network blocks direct connections. The session will still work but quality may drop a little. If you use a VPN or a work/school network, switch to your own Wi-Fi or mobile data.",
  "Gecikme yüksek; görüntüde ve seste biraz geç gelme olabilir. Konuşurken birbirinizin sözünü kesmemek için kısa duraklamalar yapın.":
    "Latency is high; video and audio may arrive a little late. Pause briefly between turns so you do not talk over each other.",
  "İndirme hızınız düşük; karşıdaki görüntü kısık gelebilir. Mümkünse Wi-Fi'ye yaklaşın.": "Your download speed is low; the incoming video may look degraded. Move closer to Wi-Fi if you can.",
  "Gönderme hızınız düşük; görüntünüz terapiste kötü ulaşabilir. Görüşmede ⋮ menüsünden \"Veri tasarrufu\"nu seçin, mümkünse Wi-Fi'ye geçin ya da kamerayı kapatıp yalnızca sesle devam edin.":
    "Your upload speed is low; your video may reach the therapist poorly. In the session choose \"Data saver\" from the ⋮ menu, switch to Wi-Fi if possible, or turn the camera off and continue with audio only.",
  "Ölçülemedi.": "Could not be measured.",
  "İnternet hızı ölçülemedi. Bağlantınız kesilmiş olabilir ya da bir engelleyici (VPN, reklam engelleyici) ölçümü durduruyor.":
    "Internet speed could not be measured. Your connection may have dropped or a blocker (VPN, ad blocker) is stopping the measurement.",
  "Her şey yolunda, görüşmeye hazırsınız.": "Everything looks good, you are ready for the session.",
  "Görüşme yapılabilir, ancak dikkat edilmesi gerekenler var.": "The session can go ahead, but there are things to watch out for.",
  "Görüşme için çözülmesi gereken bir sorun var.": "There is a problem to fix before the session.",
  "Test sürüyor…": "Test running…",
  "Testi yeniden çalıştır": "Run the test again",
  "Testi başlat": "Start the test",
  "Hız ölçümü için Cloudflare'in herkese açık hız test sunucusu kullanılır; yalnızca rastgele veri gönderilip alınır, kişisel bilginiz paylaşılmaz.":
    "Cloudflare's public speed test server is used for measuring speed; only random data is sent and received, and no personal information is shared.",
};
