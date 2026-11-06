# MindCare

Terapistler için masaüstü seans ve danışan yönetim sistemi.

- **Masaüstü (terapist):** Tauri 2 + React + TypeScript + Tailwind. Danışan, seans, klinik not, randevu ve materyal kayıtları
  yalnızca cihazda, SQLCipher ile şifreli SQLite veritabanında tutulur. Anahtar Windows Credential Manager'dadır.
  Anahtarın elle yazılabilir biçimi (**kurtarma anahtarı**, 55 karakter, sağlamalı) ilk açılışta terapiste gösterilir
  ve doğrulatılır; bilgisayar değişirse yedekler bu anahtarla geri yüklenir (`src-tauri/src/recovery.rs`).
- **Danışan web istemcisi (`patient/`):** Davet bağlantısıyla tarayıcıdan görüşmeye katılım.
- **Görüntülü görüşme:** WebRTC (P2P, gerekirse TURN). Supabase Realtime yalnızca SDP/ICE sinyalleşmesi için kullanılır;
  klinik veri sunucuya gönderilmez. Davetler süreli ve tek kullanımlıktır, kanal erişimi RLS ile sınırlıdır.

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
