import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Check, Copy, HardDriveDownload, KeyRound } from "lucide-react";
import { api, errorText } from "../lib/api";
import { Button, Modal, inputCls } from "./ui";

/** Kurtarma anahtarı giriş alanı: büyük, eş aralıklı yazı; tire ve küçük harf serbest. */
export function RecoveryKeyInput({ value, onChange, autoFocus }: {
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <textarea
      className={`${inputCls} h-20 resize-none font-mono text-[15px] tracking-wider`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="XXXXX-XXXXX-XXXXX-…"
      spellCheck={false}
      autoComplete="off"
      autoFocus={autoFocus}
    />
  );
}

/**
 * Kurtarma anahtarını gösterir ve terapistin kaydettiğini, anahtarı yeniden yazdırarak doğrular.
 * Doğrulama başarılı olunca `onConfirmed` çağrılır.
 */
export function RecoveryKeyDialog({ onClose, onConfirmed }: { onClose: () => void; onConfirmed: () => void }) {
  const [key, setKey] = useState<string | null>(null);
  const [step, setStep] = useState<"show" | "confirm">("show");
  const [typed, setTyped] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getRecoveryKey().then(setKey).catch((e) => setError(errorText(e)));
  }, []);

  const copy = async () => {
    if (!key) return;
    await navigator.clipboard.writeText(key);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const confirm = async () => {
    setError(null);
    try {
      await api.confirmRecoveryKey(typed);
      onConfirmed();
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <Modal title="Kurtarma Anahtarı" onClose={onClose} width="max-w-2xl">
      {step === "show" ? (
        <>
          <p className="text-sm leading-relaxed text-muted">
            Danışan kayıtlarınız bu bilgisayarda şifreli tutulur. Bilgisayar bozulur, kaybolur ya da Windows yeniden
            kurulursa verilerinizi yedekten geri getirmenin <b className="text-ink">tek yolu</b> bu anahtardır.
          </p>
          <div className="my-5 rounded-xl border border-accent/40 bg-bg p-5 text-center font-mono text-xl tracking-wider text-ink select-all">
            {key ?? "…"}
          </div>
          <ul className="mb-5 space-y-1.5 text-sm text-muted">
            <li>• Kağıda yazıp güvenli bir yerde saklayın ya da bir parola yöneticisine kaydedin.</li>
            <li>• Bu bilgisayarda bir dosyaya veya yedeklerin yanına <b className="text-ink">kaydetmeyin</b>.</li>
            <li>• Anahtarı bilen biri yedeklerinizi açabilir; kimseyle paylaşmayın.</li>
          </ul>
          <div className="flex justify-between gap-2">
            <Button variant="subtle" onClick={copy} disabled={!key}>
              {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? "Kopyalandı" : "Kopyala"}
            </Button>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={onClose}>Daha sonra</Button>
              <Button onClick={() => setStep("confirm")} disabled={!key}>Kaydettim, devam et</Button>
            </div>
          </div>
        </>
      ) : (
        <>
          <p className="mb-4 text-sm text-muted">
            Doğru kaydettiğinizden emin olmak için anahtarı kaydettiğiniz yerden bakarak <b className="text-ink">tamamını</b> yazın.
            Tire ve büyük/küçük harf fark etmez.
          </p>
          <RecoveryKeyInput value={typed} onChange={setTyped} autoFocus />
          {error && <p className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
          <div className="mt-5 flex justify-between gap-2">
            <Button variant="ghost" onClick={() => { setStep("show"); setError(null); }}>Geri</Button>
            <Button onClick={confirm} disabled={!typed.trim()}><KeyRound size={16} /> Doğrula</Button>
          </div>
        </>
      )}
      {step === "show" && error && <p className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
    </Modal>
  );
}

/**
 * Başka bilgisayarda alınmış bir yedeği, o bilgisayarın kurtarma anahtarıyla geri yükler.
 * Başarılı olunca bütün veriler değiştiği için uygulama yeniden yüklenir.
 */
export function RestoreWithRecoveryKey({ onClose }: { onClose: () => void }) {
  const [src, setSrc] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async () => {
    const f = await open({ multiple: false, filters: [{ name: "MindCare yedeği", extensions: ["mcbak", "db"] }] });
    if (typeof f === "string") setSrc(f);
  };

  const restore = async () => {
    if (!src) return;
    setBusy(true);
    setError(null);
    try {
      await api.restoreWithRecoveryKey(src, typed);
      window.location.reload();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  return (
    <Modal title="Kurtarma anahtarıyla geri yükle" onClose={onClose} width="max-w-2xl">
      <p className="text-sm leading-relaxed text-muted">
        Başka bir bilgisayarda alınmış yedeği geri yükler. Bu bilgisayardaki mevcut kayıtlar yedekteki verilerle
        <b className="text-ink"> değiştirilir</b> ve bundan sonra yedeğin kurtarma anahtarı kullanılır.
      </p>
      <div className="mt-4 flex items-center gap-3">
        <Button variant="subtle" onClick={pick}><HardDriveDownload size={16} /> Yedek dosyası seç</Button>
        <span className="min-w-0 break-all text-xs text-faint">{src ?? "Seçilmedi"}</span>
      </div>
      <p className="mb-1.5 mt-4 text-[13px] text-muted">Yedeğin alındığı bilgisayarın kurtarma anahtarı</p>
      <RecoveryKeyInput value={typed} onChange={setTyped} />
      {error && <p className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={busy}>Vazgeç</Button>
        <Button variant="danger" onClick={restore} disabled={busy || !src || !typed.trim()}>
          {busy ? "Geri yükleniyor…" : "Geri Yükle"}
        </Button>
      </div>
    </Modal>
  );
}
