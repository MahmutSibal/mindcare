import { useState } from "react";
import { AlertTriangle, CheckCircle2, Copy, RefreshCw, Smartphone } from "lucide-react";
import { errorText } from "../lib/api";
import { copyText } from "../lib/clipboard";
import { fmtDate } from "../lib/format";
import { refreshSyncStatus, syncDisable, syncEnable, syncJoin, syncNow, syncPairingCode, useSyncState } from "../lib/sync";
import { Button, Card, Field, inputCls, Modal } from "./ui";

/** Ayarlar > Veri Güvenliği: telefon ↔ bilgisayar eşitleme. */
export default function SyncCard() {
  const s = useSyncState();
  const [code, setCode] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [input, setInput] = useState("");
  const [confirmOff, setConfirmOff] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [working, setWorking] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setWorking(true);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg({ ok: false, text: errorText(e) });
    } finally {
      setWorking(false);
    }
  };

  const showCode = () => run(async () => setCode(s.enabled ? await syncPairingCode() : await syncEnable()));
  const join = () =>
    run(async () => {
      await syncJoin(input);
      setJoining(false);
      setInput("");
      await refreshSyncStatus();
      setMsg({ ok: true, text: "Bağlandı. Veriler bu cihaza indiriliyor." });
    });
  const turnOff = () =>
    run(async () => {
      await syncDisable(true);
      setConfirmOff(false);
      setMsg({ ok: true, text: "Eşitleme kapatıldı; sunucudaki şifreli kopya silindi. Bu cihazdaki veriler yerinde." });
    });

  return (
    <Card title="Cihazlar arası eşitleme (telefon ↔ bilgisayar)">
      <p className="mb-3 text-xs leading-relaxed text-muted">
        Aynı danışan kayıtlarını telefonunuzda ve bilgisayarınızda kullanın. Veriler cihazdan çıkmadan şifrelenir; sunucu yalnızca
        anlamsız şifreli paketleri görür ve anahtar yalnızca sizdedir. Seans video kayıtları eşitlenmez.
      </p>

      {s.enabled ? (
        <>
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-ok/30 bg-ok/10 p-3 text-xs leading-relaxed text-ok">
            <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
            <span>
              Eşitleme açık.{" "}
              {s.last ? `Son eşitleme: ${fmtDate(new Date(s.last).toISOString(), true)}.` : "Henüz eşitlenmedi."}{" "}
              {s.pending > 0 ? `${s.pending} kayıt gönderilmeyi bekliyor.` : "Bekleyen kayıt yok."}
            </span>
          </div>
          {s.error && (
            <p className="mb-3 flex items-start gap-2 rounded-lg border border-warn/30 bg-warn/10 p-3 text-xs leading-relaxed text-warn">
              <AlertTriangle size={16} className="shrink-0" /> {s.error}
            </p>
          )}
          {s.skipped > 0 && (
            <p className="mb-3 text-xs text-warn">{s.skipped} kayıt çok büyük olduğu için eşitlenmedi (15 MB sınırı).</p>
          )}
          {s.failed > 0 && (
            <p className="mb-3 text-xs text-warn">
              {s.failed} kayıt uygulanamadı (örneğin iki cihazda aynı danışana aynı numaralı seans açılmış). Seans numaralarını kontrol edin.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="subtle" onClick={() => void syncNow()} disabled={s.busy}>
              <RefreshCw size={16} className={s.busy ? "animate-spin" : ""} /> {s.busy ? "Eşitleniyor…" : "Şimdi eşitle"}
            </Button>
            <Button variant="subtle" onClick={() => void showCode()} disabled={working}>
              <Smartphone size={16} /> Yeni cihaz bağla (kodu göster)
            </Button>
            <Button variant="ghost" className="hover:text-danger" onClick={() => setConfirmOff(true)}>
              Eşitlemeyi kapat
            </Button>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => void showCode()} disabled={working}>
            <Smartphone size={16} /> Bu cihazdaki verilerle eşitlemeyi aç
          </Button>
          <Button variant="subtle" onClick={() => setJoining(true)} disabled={working}>
            Başka cihazdaki kodla bağlan
          </Button>
        </div>
      )}
      {msg && <p className={`mt-3 text-xs ${msg.ok ? "text-ok" : "text-danger"}`}>{msg.text}</p>}

      {code && (
        <Modal title="Eşleştirme kodu" onClose={() => setCode(null)}>
          <p className="mb-3 text-sm text-muted">
            Diğer cihazda <b>Ayarlar → Veri Güvenliği → Başka cihazdaki kodla bağlan</b> deyip bu kodu girin. Kodu yalnızca kendi
            cihazlarınıza yazın; bu kodu bilen herkes eşitlenen verilerin şifresini çözebilir.
          </p>
          <p className="select-all break-all rounded-lg bg-bg p-3 text-center font-mono text-sm tracking-wider">{code}</p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="subtle" onClick={() => void copyText(code)}><Copy size={16} /> Kopyala</Button>
            <Button onClick={() => setCode(null)}>Tamam</Button>
          </div>
        </Modal>
      )}

      {joining && (
        <Modal title="Başka cihazdaki kodla bağlan" onClose={() => setJoining(false)}>
          <p className="mb-3 text-sm text-muted">
            Diğer cihazda eşitlemeyi açınca gösterilen 55 karakterlik kodu girin. Bu cihazdaki mevcut kayıtlar da korunur ve birleştirilir.
          </p>
          <Field label="Eşleştirme kodu">
            <textarea className={`${inputCls} h-24 font-mono`} value={input} onChange={(e) => setInput(e.target.value)} placeholder="XXXXX-XXXXX-XXXXX-…" autoComplete="off" />
          </Field>
          {msg && !msg.ok && <p className="mt-2 text-xs text-danger">{msg.text}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setJoining(false)}>Vazgeç</Button>
            <Button onClick={() => void join()} disabled={working || input.trim().length < 20}>{working ? "Bağlanıyor…" : "Bağlan"}</Button>
          </div>
        </Modal>
      )}

      {confirmOff && (
        <Modal title="Eşitlemeyi kapat" onClose={() => setConfirmOff(false)}>
          <p className="mb-3 text-sm text-muted">
            Sunucudaki şifreli kopya silinir ve bu cihaz diğerleriyle eşitlenmeyi bırakır. <b>Bu cihazdaki veriler silinmez</b>; diğer
            cihazlardakiler de kendi cihazlarında kalır. Daha sonra yeniden açabilirsiniz.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmOff(false)}>Vazgeç</Button>
            <Button variant="danger" onClick={() => void turnOff()} disabled={working}>{working ? "Kapatılıyor…" : "Kapat ve sunucudakini sil"}</Button>
          </div>
        </Modal>
      )}
    </Card>
  );
}
