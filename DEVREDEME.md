# Mavi Ruh – Geliştirici devir teslim belgesi

Bu belge projeye yeni katılan geliştirici içindir. Önce bunu, sonra `README.md`, `YAYIN.md` ve `supabase/README.md`
dosyalarını okuyun. Müşteri: psikolog ve kliniği ("Mavi Ruh"). Son güncelleme: 17 Kasım 2026.

## 1. Ürün nedir?

Terapistin kullandığı, **danışan verisini yalnızca kendi cihazında şifreli tutan** seans yönetimi ve güvenli görüntülü
görüşme uygulaması.

| Parça | Ne | Nerede çalışır |
|---|---|---|
| **Terapist uygulaması** | Tauri 2 (Rust) + React 19 + TypeScript + Tailwind v4. Danışan, seans, not, test, ödev, materyal, grup, asistan | Windows (kurulum dosyası) ve Android (APK/AAB) |
| **Danışan sayfası** (`patient/`) | Davet bağlantısıyla açılan web sayfası; görüşme, test, ödev, çizim, dosya | Tarayıcı; Render'da statik olarak yayında |
| **Sinyalleşme** | Supabase Realtime + 3 SQL geçişi (`supabase/`) | Bulut (Frankfurt) |
| **Görüşme aktarımı** | WebRTC, doğrudan; olmazsa Cloudflare TURN | – |

**Temel ilke (KVKK):** Sağlık verisi sunucuya gitmez. Supabase'te ad, not ya da içerik tutulmaz; yalnızca rastgele oda
kimliği ve davet anahtarının özeti. Görüşme içeriği (test, ödev, tuval, dosya) WebRTC veri kanalıyla doğrudan akar.
Bu ilkeyi bozacak bir değişiklik yapmadan önce müşteriyle konuşun.

## 2. Hızlı başlangıç (Windows)

Gerekenler: Node 20+, Rust (rustup, MSVC), **Strawberry Perl** (`C:\Strawberry`, SQLCipher/OpenSSL derlemesi için),
Visual Studio Build Tools. **Proje yolunda Türkçe karakter olmamalı** (OpenSSL araçları bozulur).

```
npm install
npm run tauri dev          # masaüstü uygulaması
npm run patient:dev        # danışan sayfası (http://localhost:5174)
npx tsc --noEmit           # tip denetimi
cd src-tauri && cargo test # Rust testleri (39)
npm run build:win          # sürümü +1 yükseltir, Windows kurulum dosyasını üretir (src-tauri/target/release/bundle/nsis)
npm run build:android      # sürümü +1 yükseltir, Android APK üretir
npm run bump [minor|major|x.y.z]  # yalnızca sürümü yükseltir (6 dosyada birlikte)
```

## 3. Klasör haritası

```
src/                    Terapist arayüzü (React)
  pages/                Sayfalar: Workspace (ana ekran), Groups, Patients, Appointments, Sessions, Materials, Tests, Settings
  components/workspace/ Seans ekranı parçaları (görüşme, notlar, araçlar, grup seansı, kayan görüntü)
  lib/                  api.ts (Tauri komutları), rtc.ts (1:1 görüşme), groupRtc.ts (grup), board.ts (ortak tuval),
                        backStack.ts (geri tuşu), privacy.ts (asistana giden metin denetimi), brand.ts (marka adı)
patient/                Danışan web sayfası (PatientApp = 1:1, GroupApp = grup, ConnectionTest, public/gizlilik.html)
src-tauri/src/          Rust: commands.rs (tüm komutlar), db.rs (şifreli SQLite + geçişler), assistant.rs (Gemini),
                        keystore.rs, clinical.rs (test puanlama), recovery.rs (kurtarma anahtarı), turn.rs
src-tauri/knowledge/    Asistanın yerleşik bilgi notları (7 .md dosyası)
src-tauri/gen/android/  Android projesi (Tauri üretti, depoda tutulur)
supabase/migrations/    Sinyalleşme tabloları ve kuralları (3 dosya)
scripts/                Android ortamı ve OpenSSL derleme betikleri
logo/                   Müşterinin logosu (logo.jpeg) ve türetilen kare simge
```

`patient/dev-harness.html|ts`: tek sayfada iki tarafı birbirine bağlayan geliştirici test aracı; üretimde kullanılmaz.

## 4. Mimari notları

- **Veritabanı:** SQLCipher (AES-256), `db.rs` içindeki `MIGRATIONS` dizisi sırayla uygulanır (şu an 8 geçiş). **Mevcut
  geçişleri değiştirmeyin**, yenisini ekleyin. Anahtar: Windows'ta Credential Manager, Android'de uygulamaya özel
  dizinde dosya (`keystore.rs`).
- **Kurtarma anahtarı:** İlk açılışta gösterilir; yedekler yalnızca onunla açılır (`recovery.rs`).
- **Görüşme:** `rtc.ts` `Call` sınıfı (terapist=host, danışan=guest); iki veri kanalı: `control` (genel, dosya) ve `live`
  (çizim, gecikmesiz). Kopmada ICE yeniden başlatma. Dosya aktarımı hız sınırlıdır (ses/görüntü ezilmesin).
- **Grup:** `groupRtc.ts` `GroupCall`: danışanlar arası tam ağ (mesh), veri kanalı yalnızca terapist ↔ üye. En fazla 6 üye
  (bant genişliği). Üye başına tek kullanımlık davet (`group_invites`).
- **Tuval:** oranlı koordinatlar, eşzamanlama `board.ts` + `useBoard.ts`; gelen her veri temizlenir (`sanitize*`).
- **Asistan:** Rust'ta Gemini çağrısı (anahtar arayüze verilmez), Google Search ile kaynaklı yanıt, yerleşik not
  parçaları (`retrieve`), danışan adı/kimlik/telefon/e-posta içeren soru gönderilmez. Model adı Ayarlar'dan değişir;
  boşsa Google'dan uygun model keşfedilir.
- **Düzen:** `xl` (1280 px) altında üç sütun yerine sekmeler; 768 px altında alt gezinme; `md` ile `xl` arası simge şeridi.

## 5. Hesaplar ve gizli bilgiler (depoda YOK, ayrıca teslim edilir)

| Ne | Nerede | Not |
|---|---|---|
| GitHub deposu | `MahmutSibal/mindcare` (main dalı Render'a otomatik yayınlanır) | |
| Supabase projesi | `tckgvtuvwyvnxabmdjas`, `eu-central-1` | Anonim girişler açık olmalı. Geçişleri SQL Editor'de sırayla çalıştırın. Ücretsiz planda proje 1 hafta kullanılmazsa duraklar (Pro: 25 USD/ay) |
| Render | `mindcare-gorusme.onrender.com` (GitHub `main` dalına her gönderimde yayınlanır) | Danışan sayfasını (`npm run patient:build` çıktısı, `dist-patient/`) sunar. Render panelindeki derleme ayarlarına bakın |
| Cloudflare TURN | Anahtar kimliği ve API belirteci **uygulama içinde Ayarlar'a** girilir (şifreli veritabanında durur) | Ücretsiz plan: ayda 1000 GB |
| Gemini API anahtarı | Ayarlar > Yapay zekâ asistanı | `AQ.` ile başlayan yeni biçim sorun değil. Ücretsiz planda Google metni ürün geliştirmede kullanabilir |
| **Play yükleme anahtarı** | `C:\Users\asus\maviruh-anahtar\maviruh-upload.jks` + `SIFRE-VE-BILGI.txt` | **Kaybolursa Play'e bir daha güncelleme yüklenemez.** Güvenli kanaldan (şifreli USB) aktarın, e-posta/WhatsApp ile göndermeyin. Zip'e girmez |

`src-tauri/gen/android/keystore.properties` dosyası (anahtar yolu ve şifre) yerelde oluşturulur, `.gitignore`'dadır.
Biçimi için `YAYIN.md` bölümüne bakın. Supabase `publishable` anahtarı `config.ts`'te açıkta durur; bu tasarım gereği
herkese açıktır, yetki RLS ve davet anahtarlarındadır.

## 6. Android derlemesi

```
. .\scripts\android-env.ps1                                   # SDK/NDK/JDK ve OpenSSL ortamı
npx tauri android build --target aarch64 --apk                # APK (telefona kurulur)
npx tauri android build --target aarch64 --aab                # AAB (Play Store)
```

Bir kez yapılacak hazırlık: `rustup target add aarch64-linux-android`; Android için OpenSSL'i **WSL'de**
`bash scripts/build-openssl-android.sh` ile derleyin (Windows'ta derlenemez; neden betiğin başında yazıyor).
`keystore.properties` varsa sürüm yükleme anahtarıyla, yoksa deneme anahtarıyla imzalanır.
Uygulama kimliği `com.maviruh.terapist` (Play'e yüklendikten sonra değiştirilemez); Kotlin paket adı `com.mindcare.desktop`
olarak kaldı, bilerek (yeniden adlandırma gereksiz risk).

## 7. Karşılaşılan tuzaklar (zaman kaybettirmesin)

- **Simge:** `npx tauri icon logo/mavi-ruh-simge-1024.png` ile üretilir. `build.rs` `icons` klasörünü izler; yine de eski
  simge kalırsa `src-tauri/build.rs` dosyasına dokunup yeniden derleyin. Windows görev çubuğu eski kısayolun simgesini önbelleğe alır.
- **Marka adı** `src/lib/brand.ts`'te. `com.mindcare.desktop` kimliği, `mindcare.db` ve anahtar deposu adı **değiştirilmemeli**:
  uygulama mevcut şifreli veritabanını bulamaz.
- **Android WebView:** `navigator.clipboard` çalışmaz (`lib/clipboard.ts` yedek yöntem kullanır); geri tuşu sayfayı terk ettirir
  (`lib/backStack.ts`); Android 15 kenardan kenara çizer (`MainActivity.kt` boşlukları verir, CSS `env(safe-area-inset-*)`).
- **React:** `useEffect(() => dom.metodu())` gibi değer döndüren kısa yazım, ekranı komple çökertir ("destroy is not a function").
  Süslü parantez kullanın.
- **Windows'ta Android:** OpenSSL için Strawberry Perl yetmez (bkz. betik). NDK arşivi `python zipfile` ile açılırsa clang bozulur.
- **Yeni Tauri izni** eklerken `src-tauri/capabilities/default.json` güncellenmeli (aksi halde çağrı sessizce reddedilir).
- **Danışan sayfası değişince** `main`'e göndermek yeter; Render güncellenir. Açık sekmeler eski sürümde kalır.

## 8. Eksikler ve yapılacaklar (öncelik sırasıyla)

1. **Telefon ↔ bilgisayar veri senkronu yok.** Telefondaki uygulama kendi boş şifreli veritabanıyla çalışır. Tasarım taslağı: uçtan uca
   şifreli senkron (kayıtlar cihazda şifrelenip Supabase'e şifreli gider, anahtar kurtarma anahtarından türer, değişiklik günlüğü +
   birleştirme). KVKK açısından "sunucuda şifreli sağlık verisi" demek olduğundan müşteriyle onaylanmalı.
2. **Android anahtar deposu:** Veritabanı anahtarı uygulama dizinindeki dosyada; Android Keystore'a taşınmalı.
3. **Gerçek cihaz testi:** Kamera/mikrofon izni, telefonda görüşme ve ses kalitesi sistematik denenmedi. Ses sorunu bildirildi,
   nedeni bulunamadı (ayrıntı gerekiyor: kimin kimi duymadığı, yankı, cihaz).
4. **Play Store süreci:** `YAYIN.md` (hesap, kapalı test, gizlilik, veri güvenliği formu). `patient/public/gizlilik.html` içindeki
   köşeli parantezli kurum bilgileri **doldurulmalı**.
5. **Windows kurulum dosyası imzasız** (SmartScreen uyarısı verir). Kod imzalama sertifikası gerekir.
6. **Danışan adresi** `mindcare-gorusme.onrender.com` marka dışı; Render servis adı ya da kliniğin kendi alan adı bağlanmalı.
7. Grup seansında materyal **videosu** desteklenmiyor; iOS yok; danışan sayfası yalnızca Türkçe.
8. Gelecek vizyonu (müşteri): danışanların profil açıp randevu aldığı klinik uygulaması. Bu, "veri yalnızca terapistte" ilkesini
   değiştirir; ayrı mimari karar gerektirir.

## 9. Çalışma düzeni

- Her özellik için dal açıp `main`'e birleştirmek iyi çalıştı; `main` doğrudan yayınlanır, dikkatli olun.
- Göndermeden önce: `npx tsc --noEmit`, `cargo test`, `cargo clippy --all-targets` (şu an temiz).
- Arayüz metinleri Türkçe. Danışana görünen metinlerde açık rıza ve acil durum (112) notlarını koruyun.
