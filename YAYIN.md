# Mavi Ruh – Yayın rehberi

Bu dosya, uygulamanın Google Play'e ve Windows'a yayınlanması için gereken adımları ve mağazaya
girilecek hazır metinleri içerir.

## Durum özeti

| Konu | Durum |
|---|---|
| Android sürüm derlemesi (16 KB sayfa hizalı, arm64) | Hazır |
| Uygulama verisinin buluta yedeklenmesi | Kapatıldı (veritabanı ve anahtarı yedeklemeye girmez) |
| Gizlilik politikası sayfası | Hazır: `https://mindcare-gorusme.onrender.com/gizlilik.html` (yayınlanınca). Köşeli parantezli alanlar doldurulmalı |
| Play Store yükleme anahtarı | **Karar bekliyor** (aşağıya bakın) |
| Uygulama kimliği (applicationId) | **Karar bekliyor**: şu an `com.mindcare.desktop`; ilk yüklemeden sonra değiştirilemez |
| AAB paketi | Anahtar ve kimlik kararından sonra üretilecek |
| Windows kurulum dosyası | Hazır olduğunda `npm run tauri build` ile üretilir; imzasız (SmartScreen uyarısı verir) |
| Masaüstü ↔ telefon veri senkronu | Yok (telefon kendi şifreli veritabanıyla ayrı çalışır) |

## Play Console adımları

1. **Geliştirici hesabı** (25 USD, tek seferlik). Kliniğin adına, mümkünse **kuruluş** hesabı olarak açın:
   - Kişisel hesaplarda yayına çıkmadan önce **en az 12 test kullanıcısıyla 14 gün kapalı test** zorunludur.
   - Sağlık uygulamalarında Google kuruluş hesabı isteyebilir.
2. **Uygulama oluştur**: ad "Mavi Ruh", varsayılan dil Türkçe, tür "Uygulama", ücretsiz.
3. **Play App Signing**: açık bırakın. Biz yükleme anahtarıyla imzalarız, Google son imzayı kendisi atar.
4. **Uygulama içeriği** bölümü (aşağıdaki cevaplar hazır):
   - Gizlilik politikası URL'si
   - Uygulama erişimi: giriş gerektirmez (ilk açılışta kurtarma anahtarı gösterilir)
   - Reklam yok
   - İçerik derecelendirmesi anketi
   - Hedef kitle: 18 yaş ve üzeri
   - Veri güvenliği formu
   - Sağlık uygulamaları beyanı
5. **Kapalı test** sürümü oluşturup AAB'yi yükleyin, test kullanıcılarını ekleyin.
6. Test süresi dolunca **üretim** sürümüne alın.

## Mağaza metinleri

**Uygulama adı (30 karakter):** Mavi Ruh – Terapist

**Kısa açıklama (80 karakter):**
Terapistler için şifreli danışan dosyası, seans notu ve güvenli görüntülü görüşme.

**Tam açıklama:**

Mavi Ruh, psikolog ve psikoterapistler için geliştirilmiş bir seans ve danışan yönetim uygulamasıdır.
Danışan bilgileri yalnızca sizin cihazınızda, AES-256 ile şifrelenmiş olarak saklanır; hiçbir sunucuya gönderilmez.

• Güvenli görüntülü görüşme: Danışanınıza tek kullanımlık bir bağlantı gönderin, danışan uygulama kurmadan
  tarayıcıdan katılsın. Görüşmeler uçtan uca şifrelidir ve kaydedilmez.
• Danışan dosyası: başvuru nedeni, kullanılan ilaç ve maddeler, seans notları, seans geçmişi.
• Testler ve ödevler: görüşme sırasında danışana test gönderin, puanı otomatik hesaplansın; ödev verin.
• Materyal gösterimi: görsel, belge, alıntı ve YouTube videolarını danışanın ekranında gösterin.
• Ortak çizim: aynı tuvale birlikte çizin, istediğiniz görselin üzerine çalışın.
• Grup terapisi: en fazla 6 danışanla grup görüşmesi, grup notu ve üye notları.
• Terapist asistanı: meslek içi sorularınıza kaynaklı yanıtlar (danışan bilgisi gönderilmez).
• Şifreli yedek ve kurtarma anahtarı.

Mavi Ruh bir acil yardım hizmeti değildir. Acil durumlarda 112'yi arayın.

**Kategori:** Sağlık ve Fitness (ya da Tıp)
**İletişim e-postası:** [KLİNİK E-POSTASI]

## Veri güvenliği formu (önerilen cevaplar)

- **Veri toplanıyor mu?** Uygulama, danışan verilerini cihaz dışına göndermez. Görüşme kurmak için teknik veriler
  (anonim oturum kimliği, IP adresi) sinyalleşme sunucusuna gider.
- **Paylaşılan veri:** Yok (üçüncü taraflarla reklam/analiz için paylaşım yok).
- **Toplanan veri türleri:**
  - Uygulama etkinliği / cihaz kimlikleri: Hayır
  - Ses ve görüntü: Görüşme sırasında iletilir, toplanmaz/saklanmaz ("geçici işlenir")
  - Sağlık bilgileri: Yalnızca cihazda saklanır, toplanmaz
- **Aktarım şifreli mi?** Evet
- **Kullanıcı verisinin silinmesini isteyebilir mi?** Evet: veriler cihazdadır; uygulama silinince silinir.

## İzin gerekçeleri

- **Kamera ve mikrofon:** Danışanla görüntülü görüşme.
- **İnternet ve ağ durumu:** Görüşme bağlantısı ve bağlantı kalitesinin izlenmesi.

## Yükleme anahtarı (bir kez yapılır, çok önemli)

Anahtar kaybolursa uygulamaya **bir daha güncelleme yüklenemez.** Oluşturulduktan sonra:

- `.jks` dosyası ve şifresi **depoya girmez** (`.gitignore`'da), en az iki ayrı güvenli yerde yedeklenir
  (örneğin şifreli USB bellek ve parola yöneticisi).
- `src-tauri/gen/android/keystore.properties` dosyası şu biçimde oluşturulur:

```
storeFile=C:/Users/asus/maviruh-anahtar/maviruh-upload.jks
storePassword=...
keyAlias=maviruh
keyPassword=...
```

Bu dosya varsa sürüm derlemesi otomatik olarak yükleme anahtarıyla imzalanır; yoksa deneme anahtarı kullanılır.

## Derleme komutları

Android (AAB, Play Store için):

```
npx tauri android build --target aarch64 --aab
```

Android (APK, telefona doğrudan kurulum):

```
npx tauri android build --target aarch64 --apk
```

Windows kurulum dosyası:

```
npm run tauri build
```

Android derlemesi için gereken ortam değişkenleri (ANDROID_HOME, NDK_HOME, JAVA_HOME, OpenSSL dizinleri) ve
Android için OpenSSL'in WSL'de derlenmesi README'de anlatılmıştır.

## Otomatik güncelleme (Windows)

Kurulu uygulama açılışta ve 6 saatte bir `https://github.com/MahmutSibal/mindcare/releases/latest/download/latest.json`
adresini denetler; yeni sürüm varsa köşede bildirim çıkar, kullanıcı "Şimdi güncelle" der (seans sürerken yüklenmez).
Paket imzalıdır; imza `tauri.conf.json` içindeki genel anahtarla doğrulanır. Android'de güncellemeyi Play Store yapar.

**Yeni sürüm yayınlama:**

1. `npm run build:win "Bu sürümde neler değişti"`: sürümü +1 yapar, imzalı kurulum dosyasını derler ve
   `src-tauri/target/release/bundle/nsis/latest.json` üretir.
2. GitHub'da `v<sürüm>` etiketiyle yeni bir **Release** açın (depo herkese açık olmalı; özel depoda kullanıcılar `latest.json`'a erişemez).
3. Release'e iki dosya yükleyin: kurulum dosyası (`Mavi Ruh_<sürüm>_x64-setup.exe`) ve `latest.json`.
   Etiketi ve dosyaları yayınlayınca tüm kurulu uygulamalar bir sonraki denetimde güncellemeyi görür.

**İmza anahtarı:** `C:\Users\Mahmu\maviruh-updater\updater.key` (parolasız). Gizli tutun, depoya koymayın.
**Kaybolursa mevcut kullanıcılara bir daha güncelleme gönderilemez** (yeni anahtarla yeniden elle kurulum gerekir).
Genel anahtar `src-tauri/tauri.conf.json > plugins.updater.pubkey` içindedir. Anahtar yolu `TAURI_SIGNING_PRIVATE_KEY_PATH` ile değiştirilir.
İlk sürümü (otomatik güncellemeyi içeren) kullanıcılar elle kurar; sonrakiler kendiliğinden güncellenir.
