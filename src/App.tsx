import { useEffect, useState } from "react";
import {
  CalendarDays, FolderOpen, HeartHandshake, Home, LockKeyhole, NotebookTabs, Settings as SettingsIcon, Users,
} from "lucide-react";
import { api, errorText, RECOVERY_CONFIRMED_KEY, type AppStatus } from "./lib/api";
import { notifyDataChanged, SessionProvider, useActiveSession, useDataVersion } from "./lib/session";
import { Button, cx } from "./components/ui";
import { RecoveryKeyDialog, RecoveryKeyInput, RestoreWithRecoveryKey } from "./components/RecoveryKey";
import Workspace from "./pages/Workspace";
import Patients from "./pages/Patients";
import Appointments from "./pages/Appointments";
import Sessions from "./pages/Sessions";
import Materials from "./pages/Materials";
import Settings from "./pages/Settings";

export type Page = "home" | "patients" | "appointments" | "sessions" | "materials" | "settings";

const NAV: { id: Page; label: string; icon: typeof Home }[] = [
  { id: "home", label: "Ana Sayfa", icon: Home },
  { id: "patients", label: "Danışanlar", icon: Users },
  { id: "appointments", label: "Randevular", icon: CalendarDays },
  { id: "sessions", label: "Seanslar", icon: NotebookTabs },
  { id: "materials", label: "Materyaller", icon: FolderOpen },
  { id: "settings", label: "Ayarlar", icon: SettingsIcon },
];

export default function App() {
  const [status, setStatus] = useState<AppStatus | null>(null);

  useEffect(() => {
    api.appStatus().then(setStatus).catch((e) =>
      setStatus({ ready: false, error: String(e), cipher_version: null, db_path: "" }),
    );
  }, []);

  if (!status) return null;
  if (!status.ready) return <StartupError status={status} />;

  return (
    <SessionProvider>
      <Shell />
    </SessionProvider>
  );
}

function Shell() {
  const [page, setPage] = useState<Page>("home");
  const [patientId, setPatientId] = useState<string | null>(null);
  const [therapist, setTherapist] = useState({ name: "", title: "" });
  const [askRecovery, setAskRecovery] = useState(false);
  const { session } = useActiveSession();
  const version = useDataVersion();

  useEffect(() => {
    api.getSettings().then((s) => setTherapist({ name: s.therapist_name ?? "", title: s.therapist_title ?? "" }));
  }, [version]);

  // Kurtarma anahtarı doğrulanana kadar her açılışta bir kez hatırlatılır.
  useEffect(() => {
    api.getSettings().then((s) => setAskRecovery(!s[RECOVERY_CONFIRMED_KEY]));
  }, []);

  const openPatient = (id: string) => {
    setPatientId(id);
    setPage("home");
  };

  return (
    <div className="flex h-full">
      <aside className="flex w-[190px] shrink-0 flex-col border-r border-line bg-rail">
        <div className="flex h-20 items-center gap-2 px-5">
          <HeartHandshake className="text-accent" size={30} strokeWidth={2.2} />
          <span className="text-lg font-semibold tracking-tight">MindCare</span>
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-2 pt-4">
          {NAV.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setPage(id)}
              className={cx(
                "flex items-center gap-3 rounded-lg px-4 py-3 text-sm transition-colors",
                page === id ? "bg-accent-soft font-medium text-ink" : "text-muted hover:bg-card hover:text-ink",
              )}
            >
              <Icon size={18} className={page === id ? "text-accent" : ""} />
              {label}
              {id === "home" && session && <span className="ml-auto h-2 w-2 rounded-full bg-ok" title="Seans sürüyor" />}
            </button>
          ))}
        </nav>
        <div className="mx-3 mb-3 flex items-center gap-1.5 rounded-lg bg-card/60 px-3 py-2 text-[11px] text-faint">
          <LockKeyhole size={12} /> Yerel ve şifreli
        </div>
        <button
          onClick={() => setPage("settings")}
          className="flex items-center gap-3 border-t border-line px-4 py-4 text-left hover:bg-card"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-card text-sm font-medium text-accent">
            {(therapist.name || "?").slice(0, 1).toLocaleUpperCase("tr-TR")}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm">{therapist.name || "Profil ayarla"}</div>
            <div className="truncate text-xs text-faint">{therapist.title || "Ayarlar'dan düzenleyin"}</div>
          </div>
        </button>
      </aside>

      <main className="min-w-0 flex-1">
        {/* Görüşme başka sayfaya geçilince kopmasın diye Ana Sayfa hep bağlı kalır. */}
        <div className={page === "home" ? "h-full" : "hidden"}>
          <Workspace patientId={patientId} onSelectPatient={setPatientId} onNavigate={setPage} />
        </div>
        {page === "patients" && <Patients onOpen={openPatient} />}
        {page === "appointments" && <Appointments />}
        {page === "sessions" && <Sessions onOpenPatient={openPatient} />}
        {page === "materials" && <Materials />}
        {page === "settings" && <Settings />}
      </main>

      {askRecovery && (
        <RecoveryKeyDialog
          onClose={() => setAskRecovery(false)}
          onConfirmed={() => {
            setAskRecovery(false);
            notifyDataChanged();
          }}
        />
      )}
    </div>
  );
}

function StartupError({ status }: { status: AppStatus }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  const unlock = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.unlockWithRecoveryKey(typed);
      window.location.reload();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto p-10">
      <div className="max-w-xl rounded-2xl border border-danger/40 bg-panel p-8">
        <div className="mb-3 flex items-center gap-2 text-danger">
          <LockKeyhole size={20} />
          <h1 className="text-lg font-semibold">Şifreli veritabanı açılamadı</h1>
        </div>
        <p className="text-sm leading-relaxed text-muted">{status.error}</p>
        {status.db_path && (
          <p className="mt-4 break-all rounded-lg bg-bg p-3 font-mono text-xs text-faint">{status.db_path}</p>
        )}
        <p className="mt-4 text-sm text-muted">
          Veriler korunması için silinmedi ve yeni anahtar oluşturulmadı. Anahtarı içeren Windows kullanıcı hesabıyla
          oturum açtığınızdan emin olun.
        </p>

        <div className="mt-6 border-t border-line pt-6">
          <h2 className="mb-2 font-semibold">Kurtarma anahtarıyla aç</h2>
          <p className="mb-3 text-sm text-muted">
            Windows yeniden kurulduysa veya anahtar silindiyse, kurulumda kaydettiğiniz kurtarma anahtarını girin.
          </p>
          <RecoveryKeyInput value={typed} onChange={setTyped} />
          {error && <p className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
          <div className="mt-4 flex justify-between gap-2">
            <Button variant="ghost" onClick={() => setRestoring(true)}>Başka bilgisayarın yedeğini yükle</Button>
            <Button onClick={unlock} disabled={busy || !typed.trim()}>{busy ? "Açılıyor…" : "Veritabanını Aç"}</Button>
          </div>
        </div>
      </div>
      {restoring && <RestoreWithRecoveryKey onClose={() => setRestoring(false)} />}
    </div>
  );
}
