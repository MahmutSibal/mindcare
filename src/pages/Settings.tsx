import { useEffect, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { DatabaseBackup, HardDriveDownload, KeyRound, Save, ShieldCheck } from "lucide-react";
import { api, errorText, type AppStatus } from "../lib/api";
import { DEFAULT_PATIENT_APP_URL } from "../lib/config";
import { notifyDataChanged } from "../lib/session";
import PageHeader from "../components/PageHeader";
import { Button, Card, Field, inputCls, Modal } from "../components/ui";

const KEYS = ["therapist_name", "therapist_title", "patient_app_url", "invite_ttl_minutes", "turn_url", "turn_username", "turn_credential"] as const;
type Form = Record<(typeof KEYS)[number], string>;

export default function Settings() {
  const [form, setForm] = useState<Form | null>(null);
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null);

  useEffect(() => {
    api.getSettings().then((s) =>
      setForm({
        therapist_name: s.therapist_name ?? "",
        therapist_title: s.therapist_title ?? "",
        patient_app_url: s.patient_app_url ?? DEFAULT_PATIENT_APP_URL,
        invite_ttl_minutes: s.invite_ttl_minutes ?? "30",
        turn_url: s.turn_url ?? "",
        turn_username: s.turn_username ?? "",
        turn_credential: s.turn_credential ?? "",
      }),
    );
    api.appStatus().then(setStatus);
  }, []);

  if (!form) return null;
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const persist = async () => {
    try {
      for (const k of KEYS) await api.setSetting(k, form[k].trim());
      notifyDataChanged();
      setMsg({ ok: true, text: "Ayarlar kaydedildi." });
    } catch (e) {
      setMsg({ ok: false, text: errorText(e) });
    }
  };

  const backup = async () => {
    const stamp = new Date().toISOString().slice(0, 10);
    const dest = await save({ defaultPath: `mindcare-yedek-${stamp}.mcbak`, filters: [{ name: "MindCare yedeği", extensions: ["mcbak"] }] });
    if (!dest) return;
    try {
      await api.backupDatabase(dest);
      setMsg({ ok: true, text: `Şifreli yedek oluşturuldu: ${dest}` });
    } catch (e) {
      setMsg({ ok: false, text: errorText(e) });
    }
  };

  const pickRestore = async () => {
    const src = await open({ multiple: false, filters: [{ name: "MindCare yedeği", extensions: ["mcbak", "db"] }] });
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
    <div className="h-full overflow-y-auto p-8">
      <PageHeader title="Ayarlar">
        <Button onClick={persist}><Save size={16} /> Kaydet</Button>
      </PageHeader>
      {msg && (
        <p className={`mb-4 rounded-lg px-3 py-2 text-sm ${msg.ok ? "bg-ok/10 text-ok" : "bg-danger/10 text-danger"}`}>{msg.text}</p>
      )}

      <div className="grid max-w-5xl grid-cols-2 gap-4">
        <Card title="Profil">
          <div className="space-y-4">
            <Field label="Ad Soyad"><input className={inputCls} value={form.therapist_name} onChange={set("therapist_name")} placeholder="Dr. …" /></Field>
            <Field label="Unvan"><input className={inputCls} value={form.therapist_title} onChange={set("therapist_title")} placeholder="Psikiyatrist, Klinik Psikolog…" /></Field>
          </div>
        </Card>

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

        <Card title="TURN Sunucusu (coturn)">
          <p className="mb-4 text-xs text-muted">
            Doğrudan bağlantı kurulamayan ağlarda (simetrik NAT, kısıtlı güvenlik duvarı) gerekir. Boş bırakılırsa yalnızca STUN kullanılır.
            Bilgiler şifreli yerel veritabanında tutulur ve görüşme sırasında yalnızca danışana iletilir.
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
          <p className="mt-4 rounded-lg border border-warn/30 bg-warn/10 p-3 text-xs leading-relaxed text-warn">
            Yedekler bu bilgisayardaki anahtarla şifrelenir. Windows hesabı veya anahtar kaybolursa veriler ve yedekler
            geri getirilemez. Kurtarma anahtarı sonraki sürümde eklenecek.
          </p>
        </Card>
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
    </div>
  );
}
