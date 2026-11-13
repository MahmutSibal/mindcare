import { useEffect, useState } from "react";
import {
  CalendarDays, ClipboardList, FolderOpen, Home, LockKeyhole, Menu, NotebookTabs, Settings as SettingsIcon, Users, UsersRound,
} from "lucide-react";
import { api, errorText, RECOVERY_CONFIRMED_KEY, type AppStatus } from "./lib/api";
import { BRAND_NAME } from "./lib/brand";
import BrandMark from "./components/BrandMark";
import { notifyDataChanged, SessionProvider, useActiveSession, useDataVersion } from "./lib/session";
import { Button, cx } from "./components/ui";
import { RecoveryKeyDialog, RecoveryKeyInput, RestoreWithRecoveryKey } from "./components/RecoveryKey";
import Workspace from "./pages/Workspace";
import Patients from "./pages/Patients";
import Groups from "./pages/Groups";
import Appointments from "./pages/Appointments";
import Sessions from "./pages/Sessions";
import Materials from "./pages/Materials";
import Tests from "./pages/Tests";
import Settings from "./pages/Settings";

export type Page = "home" | "groups" | "patients" | "appointments" | "sessions" | "materials" | "tests" | "settings";

const NAV: { id: Page; label: string; icon: typeof Home }[] = [
  { id: "home", label: "Ana Sayfa", icon: Home },
  { id: "patients", label: "Danışanlar", icon: Users },
  { id: "groups", label: "Gruplar", icon: UsersRound },
  { id: "appointments", label: "Randevular", icon: CalendarDays },
  { id: "sessions", label: "Seanslar", icon: NotebookTabs },
  { id: "materials", label: "Materyaller", icon: FolderOpen },
  { id: "tests", label: "Testler", icon: ClipboardList },
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
    <div className="flex h-full flex-col md:flex-row">
      <aside className="hidden w-14 shrink-0 flex-col border-r border-line bg-rail pl-[env(safe-area-inset-left)] md:flex xl:w-[168px]">
        <div className="flex h-14 items-center justify-center gap-2 px-2 xl:justify-start xl:px-4">
          <BrandMark size={30} />
          <span className="hidden font-semibold tracking-tight xl:inline">{BRAND_NAME}</span>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 px-1.5 pt-1 xl:px-2">
          {NAV.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setPage(id)}
              title={label}
              aria-label={label}
              className={cx(
                "relative flex items-center justify-center gap-2.5 rounded-lg px-2 py-2.5 text-[13px] transition-colors xl:justify-start xl:px-3 xl:py-2",
                page === id ? "bg-accent-soft font-medium text-ink" : "text-muted hover:bg-card hover:text-ink",
              )}
            >
              <Icon size={18} className={page === id ? "text-accent" : ""} />
              <span className="hidden xl:inline">{label}</span>
              {id === "home" && session && (
                <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-ok xl:static xl:ml-auto" title="Seans sürüyor" />
              )}
            </button>
          ))}
        </nav>
        <div className="mx-3 mb-3 hidden items-center gap-1.5 rounded-lg bg-card/60 px-3 py-2 text-[11px] text-faint xl:flex">
          <LockKeyhole size={12} /> Yerel ve şifreli
        </div>
        <button
          onClick={() => setPage("settings")}
          title={therapist.name || "Profil"}
          className="flex items-center justify-center gap-3 border-t border-line px-2 py-4 text-left hover:bg-card xl:justify-start xl:px-4"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-card text-sm font-medium text-accent">
            {(therapist.name || "?").slice(0, 1).toLocaleUpperCase("tr-TR")}
          </div>
          <div className="hidden min-w-0 xl:block">
            <div className="truncate text-sm">{therapist.name || "Profil ayarla"}</div>
            <div className="truncate text-xs text-faint">{therapist.title || "Ayarlar'dan düzenleyin"}</div>
          </div>
        </button>
      </aside>

      <main className="min-h-0 min-w-0 flex-1">
        {/* Görüşme başka sayfaya geçilince kopmasın diye Ana Sayfa hep bağlı kalır. */}
        <div className={page === "home" ? "h-full" : "hidden"}>
          <Workspace patientId={patientId} onSelectPatient={setPatientId} onNavigate={setPage} />
        </div>
        {/* Grup görüşmesi de sayfa değişince kopmasın diye hep bağlı kalır. */}
        <div className={page === "groups" ? "h-full" : "hidden"}>
          <Groups onNavigate={setPage} />
        </div>
        {page === "patients" && <Patients onOpen={openPatient} />}
        {page === "appointments" && <Appointments />}
        {page === "sessions" && <Sessions onOpenPatient={openPatient} />}
        {page === "materials" && <Materials />}
        {page === "tests" && <Tests />}
        {page === "settings" && <Settings />}
      </main>

      <MobileNav page={page} onPage={setPage} sessionActive={!!session} />

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

/** Telefonda soldaki menünün yerine geçen alt gezinme çubuğu. */
function MobileNav({ page, onPage, sessionActive }: { page: Page; onPage: (p: Page) => void; sessionActive: boolean }) {
  const [more, setMore] = useState(false);
  const main = NAV.filter((n) => ["home", "patients", "groups", "appointments"].includes(n.id));
  const rest = NAV.filter((n) => !["home", "patients", "groups", "appointments"].includes(n.id));
  const restActive = rest.some((n) => n.id === page);
  return (
    <nav className="relative shrink-0 border-t border-line bg-rail pb-[env(safe-area-inset-bottom)] md:hidden" aria-label="Ana gezinme">
      {more && (
        <>
          <button className="fixed inset-0 z-30 cursor-default" aria-label="Menüyü kapat" onClick={() => setMore(false)} />
          <div className="absolute bottom-full right-2 z-40 mb-2 w-52 overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl">
            {rest.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => {
                  onPage(id);
                  setMore(false);
                }}
                className={cx("flex w-full items-center gap-3 px-4 py-3 text-left text-sm", page === id ? "bg-accent-soft text-ink" : "text-muted hover:bg-card")}
              >
                <Icon size={18} className={page === id ? "text-accent" : ""} /> {label}
              </button>
            ))}
          </div>
        </>
      )}
      <div className="flex">
        {main.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => onPage(id)}
            className={cx("relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px]", page === id ? "text-accent" : "text-muted")}
          >
            <Icon size={20} />
            {label}
            {id === "home" && sessionActive && <span className="absolute right-[28%] top-1.5 h-2 w-2 rounded-full bg-ok" />}
          </button>
        ))}
        <button
          onClick={() => setMore(!more)}
          className={cx("flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px]", restActive || more ? "text-accent" : "text-muted")}
        >
          <Menu size={20} />
          Diğer
        </button>
      </div>
    </nav>
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
