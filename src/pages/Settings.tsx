import { useEffect, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { AlertTriangle, ChevronDown, ChevronRight, DatabaseBackup, HardDriveDownload, KeyRound, Save, ShieldCheck } from "lucide-react";
import { api, errorText, RECOVERY_CONFIRMED_KEY, type AppStatus } from "../lib/api";
import { DEFAULT_PATIENT_APP_URL } from "../lib/config";
import { openUrl } from "@tauri-apps/plugin-opener";
import { APP_VERSION, BRAND_NAME } from "../lib/brand";
import { fmtDate } from "../lib/format";
import { notifyDataChanged } from "../lib/session";
import { checkForUpdate, installUpdate, updatesSupported, type Update } from "../lib/updater";
import PageHeader from "../components/PageHeader";
import { RecoveryKeyDialog, RestoreWithRecoveryKey } from "../components/RecoveryKey";
import { Button, Card, Field, inputCls, Modal } from "../components/ui";

const KEYS = [
  "therapist_name", "therapist_title", "patient_app_url", "invite_ttl_minutes",
  "cf_turn_key_id", "cf_turn_api_token", "turn_url", "turn_username", "turn_credential", "gemini_model",
] as const;
type Form = Record<(typeof KEYS)[number], string>;

export default function Settings() {
  const [form, setForm] = useState<Form | null>(null);
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null);
  const [recoveryConfirmedAt, setRecoveryConfirmedAt] = useState<string | null>(null);
  const [showRecovery, setShowRecovery] = useState(false);
  const [restoreOther, setRestoreOther] = useState(false);
  const [geminiKey, setGeminiKey] = useState("");
  const [geminiSet, setGeminiSet] = useState(false);
  const [cfTokenSet, setCfTokenSet] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [upd, setUpd] = useState<{ text: string; update?: Update; busy?: boolean }>({ text: "" });

  const checkUpdate = async () => {
    setUpd({ text: "Denetleniyor…", busy: true });
    try {
      const u = await checkForUpdate();
      setUpd(u ? { text: `Yeni sürüm var: ${u.version}`, update: u } : { text: "Uygulama güncel." });
    } catch (e) {
      setUpd({ text: `Denetlenemedi: ${errorText(e)}` });
    }
  };
  const doUpdate = async () => {
    if (!upd.update) return;
    setUpd({ ...upd, text: "İndiriliyor…", busy: true });
    try {
      await installUpdate(upd.update);
    } catch (e) {
      setUpd({ text: `Güncellenemedi: ${errorText(e)}` });
    }
  };

  const loadRecoveryStatus = () =>
    api.getSettings().then((s) => setRecoveryConfirmedAt(s[RECOVERY_CONFIRMED_KEY] ?? null));

  useEffect(() => {
    loadRecoveryStatus();
    api.getSettings().then((s) =>
      setForm({
        therapist_name: s.therapist_name ?? "",
        therapist_title: s.therapist_title ?? "",
        patient_app_url: s.patient_app_url ?? DEFAULT_PATIENT_APP_URL,
        invite_ttl_minutes: s.invite_ttl_minutes ?? "30",
        cf_turn_key_id: s.cf_turn_key_id ?? "",
        cf_turn_api_token: "",
        turn_url: s.turn_url ?? "",
        turn_username: s.turn_username ?? "",
        turn_credential: s.turn_credential ?? "",
        gemini_model: s.gemini_model ?? "",
      }),
    );
    api.getSettings().then((s) => {
      setGeminiSet(s.gemini_api_key_set === "1");
      setCfTokenSet(s.cf_turn_api_token_set === "1");
    });
    api.appStatus().then(setStatus);
  }, []);

  if (!form) return null;
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const persist = async (): Promise<boolean> => {
    try {
      for (const k of KEYS) {
        // Gizli değer boşsa dokunma: kayıtlı olan korunur.
        if (k === "cf_turn_api_token" && !form[k].trim()) continue;
        await api.setSetting(k, form[k].trim());
      }
      if (form.cf_turn_api_token.trim()) {
        setCfTokenSet(true);
        setForm((f) => (f ? { ...f, cf_turn_api_token: "" } : f));
      }
      notifyDataChanged();
      setMsg({ ok: true, text: "Ayarlar kaydedildi." });
      return true;
    } catch (e) {
      setMsg({ ok: false, text: errorText(e) });
      return false;
    }
  };

  const testTurn = async () => {
    if (!(await persist())) return;
    setMsg({ ok: true, text: "Cloudflare TURN deneniyor…" });
    try {
      const servers = await api.generateTurnServers();
      const turn = servers?.filter((s) => [s.urls].flat().some((u) => u.startsWith("turn"))) ?? [];
      setMsg(
        servers === null
          ? { ok: false, text: "Cloudflare TURN Key ID ve API token girilmedi." }
          : turn.length
            ? { ok: true, text: `Cloudflare TURN çalışıyor: ${[turn[0]!.urls].flat().length} aktarma adresi alındı. Ayarlar kaydedildi.` }
            : { ok: false, text: "Cloudflare yanıt verdi ama TURN adresi göndermedi." },
      );
    } catch (e) {
      setMsg({ ok: false, text: errorText(e) });
    }
  };

  const saveGemini = async () => {
    if (!(await persist())) return;
    try {
      if (geminiKey.trim()) await api.setSetting("gemini_api_key", geminiKey.trim());
      setGeminiKey("");
      setGeminiSet(true);
      notifyDataChanged();
      setMsg({ ok: true, text: "Asistan deneniyor…" });
      await api.checkAssistant();
      setMsg({ ok: true, text: "Asistan çalışıyor: anahtar ve model geçerli. Ayarlar kaydedildi." });
    } catch (e) {
      setMsg({ ok: false, text: errorText(e) });
    }
  };

  const removeGemini = async () => {
    await api.setSetting("gemini_api_key", "");
    setGeminiSet(false);
    notifyDataChanged();
    setMsg({ ok: true, text: "Gemini anahtarı silindi." });
  };

  const backup = async () => {
    const stamp = new Date().toISOString().slice(0, 10);
    const dest = await save({ defaultPath: `maviruh-yedek-${stamp}.mcbak`, filters: [{ name: "Mavi Ruh yedeği", extensions: ["mcbak"] }] });
    if (!dest) return;
    try {
      await api.backupDatabase(dest);
      await api.setSetting("last_backup_at", new Date().toISOString());
      notifyDataChanged();
      setMsg({ ok: true, text: `Şifreli yedek oluşturuldu: ${dest}` });
    } catch (e) {
      setMsg({ ok: false, text: errorText(e) });
    }
  };

  const pickRestore = async () => {
    const src = await open({ multiple: false, filters: [{ name: "Mavi Ruh yedeği", extensions: ["mcbak", "db"] }] });
    if (typeof src === "string") setConfirmRestore(src);
  };

  const restore = async () => {
    const src = confirmRestore!;
    setConfirmRestore(null);
    try {
      await api.restoreDatabase(src);
      notifyDataChanged();
      setMsg({ ok: true, text: "Yedek geri yüklendi." });
    } catch (e) {
      setMsg({ ok: false, text: errorText(e) });
    }
  };

  return (
    <div className="h-full overflow-y-auto p-4 md:p-8">
      <PageHeader title="Ayarlar">
        <Button onClick={() => void persist()}><Save size={16} /> Kaydet</Button>
      </PageHeader>
      {msg && (
        <p className={`mb-4 rounded-lg px-3 py-2 text-sm ${msg.ok ? "bg-ok/10 text-ok" : "bg-danger/10 text-danger"}`}>{msg.text}</p>
      )}

      <div className="grid max-w-5xl grid-cols-1 gap-4 md:grid-cols-2">
        <Card title="Profil">
          <p className="mb-4 text-xs leading-relaxed text-muted">
            Adınız ve unvanınız danışanın görüşme ekranında ve davet mesajında görünür. Başka bir yere gönderilmez.
          </p>
          <div className="space-y-4">
            <Field label="Ad Soyad"><input className={inputCls} value={form.therapist_name} onChange={set("therapist_name")} placeholder="Örn: Ayşe Yılmaz" /></Field>
            <Field label="Unvan"><input className={inputCls} value={form.therapist_title} onChange={set("therapist_title")} placeholder="Psikiyatrist, Klinik Psikolog…" /></Field>
          </div>
        </Card>



        <Card title="Veri Güvenliği ve Yedekleme">
          <ul className="mb-4 space-y-2 text-sm text-muted">
            <li className="flex items-center gap-2"><ShieldCheck size={16} className="text-ok" /> SQLCipher {status?.cipher_version ?? ""} ile şifreli (AES-256)</li>
            <li className="flex items-center gap-2"><KeyRound size={16} className="text-ok" /> Anahtar Windows Credential Manager'da</li>
          </ul>
          <p className="mb-4 break-all rounded-lg bg-bg p-2 font-mono text-[11px] text-faint">{status?.db_path}</p>
          <div className="flex gap-2">
            <Button variant="subtle" onClick={backup}><DatabaseBackup size={16} /> Şifreli Yedek Al</Button>
            <Button variant="subtle" onClick={pickRestore}><HardDriveDownload size={16} /> Geri Yükle</Button>
          </div>
          {recoveryConfirmedAt ? (
            <p className="mt-4 flex items-start gap-2 rounded-lg border border-ok/30 bg-ok/10 p-3 text-xs leading-relaxed text-ok">
              <ShieldCheck size={16} className="shrink-0" />
              Kurtarma anahtarı {fmtDate(recoveryConfirmedAt, true)} tarihinde doğrulandı. Bilgisayar değişirse yedekler
              bu anahtarla geri yüklenebilir.
            </p>
          ) : (
            <p className="mt-4 flex items-start gap-2 rounded-lg border border-warn/30 bg-warn/10 p-3 text-xs leading-relaxed text-warn">
              <AlertTriangle size={16} className="shrink-0" />
              Kurtarma anahtarı henüz kaydedilmedi. Bilgisayar bozulur veya Windows yeniden kurulursa veriler ve yedekler
              geri getirilemez.
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant={recoveryConfirmedAt ? "subtle" : "primary"} onClick={() => setShowRecovery(true)}>
              <KeyRound size={16} /> {recoveryConfirmedAt ? "Kurtarma anahtarını göster" : "Kurtarma anahtarını kaydet"}
            </Button>
            <Button variant="ghost" onClick={() => setRestoreOther(true)}>
              Başka bilgisayarın yedeğini yükle
            </Button>
          </div>
        </Card>

        <AppLockCard />

        <Card title="Yapay zekâ asistanı (Gemini)">
          <p className="mb-3 text-xs leading-relaxed text-muted">
            Terapist için meslek içi bir hatırlatma asistanı. Yanıtları kaynaklarıyla verir. Ücretsiz anahtarı
            aistudio.google.com/apikey adresinden alabilirsiniz. Anahtar yalnızca bu bilgisayarın şifreli veritabanında durur.
          </p>
          <Field label={geminiSet ? "Gemini API anahtarı (kayıtlı; değiştirmek için yenisini yazın)" : "Gemini API anahtarı"}>
            <input
              type="password"
              className={inputCls}
              value={geminiKey}
              onChange={(e) => setGeminiKey(e.target.value)}
              placeholder={geminiSet ? "••••••••••••" : "AIza…"}
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          <Field label="Model (önerilen: boş bırakın)" hint="Boşsa otomatik seçilir. Yazarsanız tam ad: gemini-3.8-flash">
            <input className={inputCls} value={form.gemini_model} onChange={set("gemini_model")} autoComplete="off" spellCheck={false} />
          </Field>
          <p className="mb-3 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-xs leading-relaxed text-warn">
            Ücretsiz Gemini kullanımında Google, gönderilen metni ürünlerini geliştirmek için kullanabilir ve insanlar
            inceleyebilir. Bu yüzden asistana <b>danışan adı, kimlik ya da tanımlayıcı bilgi yazmayın</b>; uygulama bunları
            engellemeye çalışır ama garanti edemez. Gerçek danışan bilgisiyle çalışacaksanız ücretli (verisi eğitimde
            kullanılmayan) Gemini planına geçin.
          </p>
          <div className="flex gap-2">
            <Button variant="subtle" onClick={() => void saveGemini()} disabled={!geminiKey.trim() && !geminiSet}>
              Kaydet ve sına
            </Button>
            {geminiSet && <Button variant="ghost" className="hover:text-danger" onClick={() => void removeGemini()}>Anahtarı sil</Button>}
          </div>
        </Card>


        <Card title="Hakkında">
          <p className="text-sm text-muted">
            {BRAND_NAME} • sürüm {APP_VERSION}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-faint">
            Danışan verileri yalnızca bu cihazda, şifreli olarak saklanır. Görüşmeler uçtan uca şifrelidir ve kaydedilmez.
          </p>
          <Button
            variant="subtle"
            className="mt-3"
            onClick={() => void openUrl(`${(form.patient_app_url || DEFAULT_PATIENT_APP_URL).replace(/\/+$/, "")}/gizlilik.html`)}
          >
            Gizlilik politikası ve aydınlatma metni
          </Button>
          {updatesSupported() && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button variant="subtle" onClick={() => void checkUpdate()} disabled={upd.busy}>Güncellemeleri denetle</Button>
              {upd.update && <Button onClick={() => void doUpdate()} disabled={upd.busy}>Şimdi güncelle</Button>}
              {upd.text && <span className="text-xs text-muted">{upd.text}</span>}
            </div>
          )}
        </Card>

        <div className="md:col-span-2">
          <button
            onClick={() => setAdvanced((v) => !v)}
            className="flex items-center gap-1.5 text-sm text-muted hover:text-ink"
            aria-expanded={advanced}
          >
            {advanced ? <ChevronDown size={16} /> : <ChevronRight size={16} />} Gelişmiş ayarlar
          </button>
          <p className="mt-1 text-xs text-faint">Görüşme bağlantısı ve sunucu ayarları. Sorun yaşamıyorsanız değiştirmenize gerek yok.</p>
        </div>
        {advanced && (
          <>
        <Card title="Görüntülü Görüşme">
          <div className="space-y-4">
            <Field label="Danışan web uygulaması adresi" hint="Davet bağlantıları bu adrese yönlenir.">
              <input className={inputCls} value={form.patient_app_url} onChange={set("patient_app_url")} />
            </Field>
            <Field label="Davet geçerlilik süresi (dakika)">
              <input type="number" min={5} max={240} className={inputCls} value={form.invite_ttl_minutes} onChange={set("invite_ttl_minutes")} />
            </Field>
          </div>
        </Card>
        <Card title="Cloudflare TURN (önerilen)">
          <p className="mb-4 text-xs leading-relaxed text-muted">
            Bazı mobil ve kurumsal ağlarda doğrudan bağlantı kurulamaz; TURN görüntüyü şifreli olarak aktarır ve içeriğini
            göremez. Her görüşme için 4 saat geçerli geçici bir parola üretilir; API token yalnızca bu bilgisayarın şifreli
            veritabanında kalır, danışana gönderilmez. Cloudflare'de ayda 1.000 GB ücretsizdir.
          </p>
          <div className="space-y-4">
            <Field label="TURN Key ID">
              <input className={inputCls} value={form.cf_turn_key_id} onChange={set("cf_turn_key_id")} autoComplete="off" spellCheck={false} />
            </Field>
            <Field label={cfTokenSet ? "API Token (kayıtlı; değiştirmek için yenisini yazın)" : "API Token"}>
              <input type="password" className={inputCls} value={form.cf_turn_api_token} onChange={set("cf_turn_api_token")} placeholder={cfTokenSet ? "••••••••••••" : ""} autoComplete="off" />
            </Field>
            <Button variant="subtle" onClick={testTurn} disabled={!form.cf_turn_key_id.trim() || (!form.cf_turn_api_token.trim() && !cfTokenSet)}>
              <ShieldCheck size={16} /> Kaydet ve bağlantıyı test et
            </Button>
          </div>
        </Card>
        <Card title="Kendi TURN Sunucunuz (gelişmiş)">
          <p className="mb-4 text-xs text-muted">
            Cloudflare yerine kendi coturn sunucunuzu kullanmak isterseniz. Cloudflare ayarlıysa bu alanlar kullanılmaz.
            Bu parola görüşme sırasında danışana olduğu gibi iletilir; mümkünse Cloudflare'i tercih edin.
          </p>
          <div className="space-y-4">
            <Field label="Adres(ler)" hint="Örn: turn:turn.ornek.com:3478, turns:turn.ornek.com:5349">
              <input className={inputCls} value={form.turn_url} onChange={set("turn_url")} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Kullanıcı adı"><input className={inputCls} value={form.turn_username} onChange={set("turn_username")} /></Field>
              <Field label="Parola"><input type="password" className={inputCls} value={form.turn_credential} onChange={set("turn_credential")} /></Field>
            </div>
          </div>
        </Card>
          </>
        )}

      </div>

      {confirmRestore && (
        <Modal title="Yedekten geri yükle" onClose={() => setConfirmRestore(null)}>
          <p className="text-sm text-muted">
            Mevcut tüm kayıtlar seçilen yedekteki verilerle <b className="text-ink">değiştirilecek</b>. Önce güncel bir yedek almanız önerilir.
          </p>
          <p className="mt-3 break-all text-xs text-faint">{confirmRestore}</p>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmRestore(null)}>Vazgeç</Button>
            <Button variant="danger" onClick={restore}>Geri Yükle</Button>
          </div>
        </Modal>
      )}

      {showRecovery && (
        <RecoveryKeyDialog
          onClose={() => setShowRecovery(false)}
          onConfirmed={() => {
            setShowRecovery(false);
            loadRecoveryStatus();
            setMsg({ ok: true, text: "Kurtarma anahtarı doğrulandı." });
          }}
        />
      )}
      {restoreOther && <RestoreWithRecoveryKey onClose={() => setRestoreOther(false)} />}
    </div>
  );
}

/** Uygulama kilidi: PIN koyma, değiştirme, kaldırma. PIN yalnızca özet olarak şifreli veritabanında durur. */
function AppLockCard() {
  const [enabled, setEnabled] = useState(false);
  const [current, setCurrent] = useState("");
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const digits = (v: string) => v.replace(/\D/g, "").slice(0, 8);

  useEffect(() => {
    api.getSettings().then((s) => setEnabled(s.app_lock_set === "1"));
  }, []);

  const apply = async () => {
    if (pin !== pin2) return setMsg({ ok: false, text: "PIN'ler aynı değil." });
    try {
      await api.setAppPin(pin, enabled ? current : undefined);
      setEnabled(true);
      setCurrent(""); setPin(""); setPin2("");
      notifyDataChanged();
      setMsg({ ok: true, text: "Kilit etkin. Uygulama 5 dakika hareketsiz kalınca (seans sırasında değil) kilitlenir." });
    } catch (e) {
      setMsg({ ok: false, text: errorText(e) });
    }
  };

  const remove = async () => {
    try {
      await api.clearAppPin(current);
      setEnabled(false);
      setCurrent("");
      notifyDataChanged();
      setMsg({ ok: true, text: "Kilit kaldırıldı." });
    } catch (e) {
      setMsg({ ok: false, text: errorText(e) });
    }
  };

  return (
    <Card title="Uygulama kilidi">
      <p className="mb-3 text-xs leading-relaxed text-muted">
        Bilgisayarı açık bıraktığınızda başkası danışan kayıtlarını görmesin diye 4-8 haneli bir PIN ile kilitleyin.
        PIN'i unutursanız kurtarma anahtarıyla veritabanı yine açılabilir ancak kilit için sıfırlama yoktur; PIN'i not alın.
      </p>
      <div className="space-y-3">
        {enabled && (
          <Field label="Mevcut PIN"><input type="password" inputMode="numeric" className={inputCls} value={current} onChange={(e) => setCurrent(digits(e.target.value))} autoComplete="off" /></Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label={enabled ? "Yeni PIN" : "PIN"}><input type="password" inputMode="numeric" className={inputCls} value={pin} onChange={(e) => setPin(digits(e.target.value))} autoComplete="off" /></Field>
          <Field label="PIN (tekrar)"><input type="password" inputMode="numeric" className={inputCls} value={pin2} onChange={(e) => setPin2(digits(e.target.value))} autoComplete="off" /></Field>
        </div>
        {msg && <p className={`text-xs ${msg.ok ? "text-ok" : "text-danger"}`}>{msg.text}</p>}
        <div className="flex gap-2">
          <Button variant="subtle" onClick={() => void apply()} disabled={pin.length < 4 || (enabled && current.length < 4)}>
            {enabled ? "PIN'i değiştir" : "Kilidi etkinleştir"}
          </Button>
          {enabled && <Button variant="ghost" className="hover:text-danger" onClick={() => void remove()} disabled={current.length < 4}>Kilidi kaldır</Button>}
        </div>
      </div>
    </Card>
  );
}
