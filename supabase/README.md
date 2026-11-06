# Supabase: görüntülü görüşme sinyalleşmesi

Supabase yalnızca iki tarafın birbirini bulması (SDP/ICE sinyalleşmesi) için kullanılır.
Klinik veri, danışan adı veya not **tutulmaz**; görüntü, ses ve test cevapları cihazlar arasında
doğrudan, şifreli akar.

| | |
| --- | --- |
| Proje | `mindcare` (`tckgvtuvwyvnxabmdjas`), MahmutSibal organizasyonu |
| Bölge | `eu-central-1` (Frankfurt) |
| Şema | `migrations/` — canlı projeden birebir alındı (6 Kasım 2026) |

## Yeni bir projeye kurulum

1. `migrations/` içindeki dosyaları sırayla çalıştırın (Supabase CLI: `supabase db push`, ya da SQL Editor).
2. **Authentication → Sign In / Providers → Allow anonymous sign-ins: açık.** Terapist ve danışan
   anonim oturumla bağlanır; yetki davet anahtarı ve aşağıdaki kurallarla sağlanır.
3. **Realtime → Settings → "Allow public access": kapatılması önerilir.** Uygulama yalnızca özel
   kanallar kullanır (`private: true`); bunlarda `realtime.messages` kuralları kanala yalnızca odanın
   iki katılımcısının erişmesine izin verir. Ayarı kapatmak açık kanal kullanımını da engeller.
   (Canlı projedeki değeri SQL ile okunamadığı için doğrulanmadı; panelden kontrol edin.)
4. `src/lib/config.ts` içindeki `SUPABASE_URL` ve publishable anahtarı yeni projeye göre güncelleyin.

## Güvenlik modeli

- `call_rooms` tablosuna doğrudan erişim yoktur (RLS açık, politika yok, yetkiler geri alınmış).
  Tüm işlemler `SECURITY DEFINER` fonksiyonlardan geçer; `search_path` boş bırakılmıştır.
- Davet anahtarının kendisi saklanmaz, yalnızca SHA-256 özeti. Anahtar bağlantının `#` kısmındadır
  ve tarayıcı bu kısmı hiçbir sunucuya göndermez.
- Davet tek kullanımlıktır: ilk katılan danışanın anonim kimliği odaya bağlanır. **Aynı tarayıcıdan**
  sayfa yenilenip tekrar katılınabilir; başka bir cihaz `used` hatası alır.
- Kanal erişimi oda kapatılınca veya 8 saat sonra kendiliğinden sona erer.

Supabase güvenlik denetimi (advisor) üç uyarı gösterir; üçü de bu tasarımın bilinçli sonucudur:
`RLS enabled no policy` (doğrudan erişim bilerek kapalı), `SECURITY DEFINER` fonksiyonların
`authenticated` tarafından çağrılabilmesi (API bu fonksiyonlardır) ve anonim kullanıcılara açık
Realtime kuralları (iki taraf da anonim oturum kullanır).

## Bilinen eksikler

- Publishable anahtarı bilen herkes anonim oturum açıp oda oluşturabilir. Klinik veriye erişim
  sağlamaz, ancak Realtime kotasını tüketebilir. İleride oda oluşturma yalnızca terapist hesabına
  açılmalı.
- Eski odalar silinmez; zamanlanmış bir temizlik (ör. `pg_cron`, 30 günden eski kayıtlar) eklenmeli.
