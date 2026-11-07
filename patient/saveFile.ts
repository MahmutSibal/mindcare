// Danışan tarafında dosya kaydetme. Görüşme sayfası, sayfa değişince (pagehide) görüşmeden
// ayrılır; bu yüzden kaydetme işlemi görüşme sayfasını ASLA aynı sekmede başka bir yere götürmemeli.
// iPhone ve bazı Android tarayıcıları "download" bağlantısıyla metin/PDF dosyasını indirmek yerine
// aynı sekmede açar ve görüşme biter.

const isTouchDevice = () => window.matchMedia?.("(pointer: coarse)").matches ?? false;

/**
 * Telefonda telefonun paylaş/kaydet menüsünü açar (Dosyalar'a kaydet, Notlar vb.); bu menü
 * yoksa veya masaüstündeyse dosyayı yeni sekmede indirir. Görüşme sayfası yerinde kalır.
 */
export async function saveFile(blob: Blob, name: string): Promise<void> {
  if (isTouchDevice() && typeof navigator.canShare === "function") {
    const file = new File([blob], name, { type: blob.type || "application/octet-stream" });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: name });
        return;
      } catch (e) {
        if ((e as DOMException)?.name === "AbortError") return; // kullanıcı vazgeçti
        // Paylaşım başarısızsa aşağıdaki yönteme geç.
      }
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  // Tarayıcı indirmek yerine açmayı seçerse yeni sekmede açsın; görüşme sekmesi değişmesin.
  a.target = "_blank";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
