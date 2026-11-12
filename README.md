# MindCare

Terapistler için masaüstü seans ve danışan yönetim sistemi.

- **Masaüstü (terapist):** Tauri 2 + React + TypeScript + Tailwind. Danışan, seans, klinik not, randevu ve materyal kayıtları
  yalnızca cihazda, SQLCipher ile şifreli SQLite veritabanında tutulur. Anahtar Windows Credential Manager'dadır.
  Anahtarın elle yazılabilir biçimi (**kurtarma anahtarı**, 55 karakter, sağlamalı) ilk açılışta terapiste gösterilir
  ve doğrulatılır; bilgisayar değişirse yedekler bu anahtarla geri yüklenir (`src-tauri/src/recovery.rs`).
- **Danışan web istemcisi (`patient/`):** Davet bağlantısıyla tarayıcıdan görüşmeye katılım.
- **Görüntülü görüşme:** WebRTC (P2P, gerekirse TURN). Supabase Realtime yalnızca SDP/ICE sinyalleşmesi için kullanılır;
  klinik veri sunucuya gönderilmez. Davetler süreli ve tek kullanımlıktır, kanal erişimi RLS ile sınırlıdır.
  Veritabanı şeması ve kurulum adımları: [`supabase/`](supabase/README.md).
- **Klinik kayıt:** Danışan dosyasında başvuru nedeni ile kullanılan ilaç/maddeler ("Klinik" sekmesi).
- **Ortak çizim:** Seans sırasında terapist tuvali açar; iki taraf da (fare, parmak, kalem) aynı tuvale çizer ve yazar,
  çizimler anında karşıda görünür. Terapistin gösterdiği bir görsel ("Çiz" düğmesi) arka plan olarak üzerine çizilebilir.
  Çizimler danışan dosyasına PNG olarak kaydedilir ("Çalışmalar" sekmesi). Tüm trafik şifreli veri kanalındadır.
- **Grup terapisi:** "Gruplar" sayfasında grup ve üyeler tanımlanır (en fazla 6 danışan). Her üyeye özel, tek kullanımlık
  davet bağlantısı üretilir; görüşme herkesin herkesi gördüğü doğrudan (mesh) bağlantıdır, bağlantı sayısına göre
  kalite otomatik düşer. Grup notu ve üye başına not tutulur. Tablolar `supabase/migrations/20261112120000_group_rooms.sql`.
- **Bağlantı testi:** Danışan sayfası `/#test` (ve katılma ekranındaki bağlantı) kamera, mikrofon, doğrudan bağlantı imkânı,
  gecikme ve hızı ölçer, sorun varsa ne yapılacağını söyler.
- **Terapist asistanı (Gemini):** "Asistan" sayfası, Google Search ile kaynaklı yanıt verir (kaynaklar numaralı bağlantılardır).
  API anahtarı Ayarlar'da girilir, yalnızca şifreli veritabanında durur ve istekler Rust tarafından yapılır. Ücretsiz Gemini
  kullanımında metin Google'ca ürün geliştirmede kullanılabildiği için kayıtlı danışan adı ve kimlik/telefon/e-posta
  kalıpları içeren sorular gönderilmez (`src/lib/privacy.ts`); gerçek danışan bilgisiyle çalışmak için ücretli plan gerekir.
- **Danışandan dosya:** Danışan ayarlar menüsünden fotoğraf, PDF, metin, Word veya ses dosyası gönderir (en fazla 25 MB).
  Terapist ekranında bildirim çıkar; dosya şifreli veritabanında danışan dosyasına kaydedilir, uygulama içinde
  görüntülenir (görsel, PDF, metin, ses) ve bilgisayara indirilebilir. Tür listesi hem danışan sayfasında hem
  Rust tarafında (`commands.rs`) denetlenir; içerik bildirilen türle eşleşmiyorsa reddedilir.

## Cloudflare TURN kurulumu

Bazı mobil ve kurumsal ağlarda doğrudan (P2P) bağlantı kurulamaz; o durumda görüntü Cloudflare TURN
üzerinden şifreli olarak aktarılır. Ayda 1.000 GB ücretsizdir.

1. Cloudflare panelinin **Realtime** bölümünde bir TURN anahtarı oluşturun
   ([belgeler](https://developers.cloudflare.com/realtime/turn/generate-credentials/)).
2. Verilen **Key ID** ve **API Token**'ı her terapist bilgisayarında **Ayarlar → Cloudflare TURN** alanlarına girin,
   **Kaydet ve bağlantıyı test et** ile doğrulayın.

API token yalnızca o bilgisayarın şifreli veritabanında durur. Her görüşme için 4 saat geçerli geçici bir
kullanıcı adı/parola üretilir (`src-tauri/src/turn.rs`) ve danışana yalnızca o gönderilir.
Anahtar girilmezse uygulama yalnızca doğrudan bağlantıyla çalışmaya devam eder.

## Geliştirme

Windows'ta SQLCipher için OpenSSL kaynaktan derlenir; [Strawberry Perl](https://strawberryperl.com) gerekir.
Derleme çıktısı `src-tauri/.cargo/config.toml` içindeki ASCII yola alınır.

```bash
npm install
npm run tauri dev          # masaüstü uygulaması
npm run patient:dev        # danışan istemcisi (http://localhost:5174)
cd src-tauri && cargo test # şifreleme ve yedekleme testleri
```

## Dağıtım

```bash
npm run tauri build        # NSIS kurulum sihirbazı (MindCare_x.y.z_x64-setup.exe)
npm run patient:build      # danışan istemcisi → dist-patient/ (HTTPS üzerinden yayınlanmalı)
```
