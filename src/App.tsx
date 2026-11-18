import { useEffect, useRef, useState } from "react";
import { useBackClose, useBackGuard } from "./lib/backStack";
import { CalendarDays, CircleHelp, FolderOpen, Home, LockKeyhole, Menu, Settings as SettingsIcon, Users, UsersRound } from "lucide-react";
import { api, errorText, RECOVERY_CONFIRMED_KEY, type Appointment, type AppStatus } from "./lib/api";
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
import Billing from "./pages/Billing";
import AppLock from "./components/AppLock";
import UpdateBanner from "./components/UpdateBanner";
import GuideTour from "./components/GuideTour";

export type Page = "home" | "groups" | "patients" | "appointments" | "billing" | "sessions" | "materials" | "tests" | "settings";

/** Yan menü 6 bölümdür; birden çok sayfası olan bölümlerde sayfalar üstte sekme olarak görünür. */
const NAV: { id: Page; label: string; icon: typeof Home; pages: { page: Page; label: string }[] }[] = [
  { id: "home", label: "Ana Sayfa", icon: Home, pages: [{ page: "home", label: "Ana Sayfa" }] },
  { id: "patients", label: "Danışanlar", icon: Users, pages: [{ page: "patients", label: "Danışanlar" }, { page: "billing", label: "Ücretler" }] },
  { id: "groups", label: "Gruplar", icon: UsersRound, pages: [{ page: "groups", label: "Gruplar" }] },
  { id: "appointments", label: "Takvim", icon: CalendarDays, pages: [{ page: "appointments", label: "Randevular" }, { page: "sessions", label: "Geçmiş seanslar" }] },
  { id: "materials", label: "Kütüphane", icon: FolderOpen, pages: [{ page: "materials", label: "Materyaller" }, { page: "tests", label: "Testler" }] },
  { id: "settings", label: "Ayarlar", icon: SettingsIcon, pages: [{ page: "settings", label: "Ayarlar" }] },
];

const sectionOf = (page: Page) => NAV.find((n) => n.pages.some((p) => p.page === page)) ?? NAV[0]!;

/** Bölümün sayfaları arasında geçiş: Danışanlar | Ücretler gibi. */
function SectionTabs({ page, onPage }: { page: Page; onPage: (p: Page) => void }) {
  const section = sectionOf(page);
  if (section.pages.length < 2) return null;
  return (
    <div className="flex shrink-0 gap-1 border-b border-line px-4 pt-2 md:px-8" role="tablist">
      {section.pages.map((p) => (
        <button
          key={p.page}
          role="tab"
          aria-selected={page === p.page}
          onClick={() => onPage(p.page)}
          className={cx(
            "-mb-px border-b-2 px-3 py-2.5 text-sm transition-colors",
            page === p.page ? "border-accent font-medium text-ink" : "border-transparent text-muted hover:text-ink",
          )}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

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

/** İlk açılışta bir kez: ad ve unvan sorulur. "Şimdilik geç" de bir daha sormaz. */
function WelcomeProfile({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const finish = async (save: boolean) => {
    setBusy(true);
    try {
      if (save && name.trim()) {
        await api.setSetting("therapist_name", name.trim());
        await api.setSetting("therapist_title", title.trim());
      }
      await api.setSetting("onboarding_done", "1");
    } finally {
      onDone();
    }
  };
  const cls = "w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent";
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-6">
      <div className="w-full max-w-md rounded-2xl border border-line bg-panel p-6 shadow-2xl">
        <h2 className="text-lg font-semibold">Hoş geldiniz</h2>
        <p className="mt-1 text-sm text-muted">
          Danışanlarınız görüşmeye katılırken bu adı görür. İstediğiniz zaman Ayarlar'dan değiştirebilirsiniz.
        </p>
        <label className="mt-4 block text-xs text-muted">Ad Soyad
          <input className={cls + " mt-1"} value={name} onChange={(e) => setName(e.target.value)} placeholder="Örn: Ayşe Yılmaz" autoFocus />
        </label>
        <label className="mt-3 block text-xs text-muted">Unvan (isteğe bağlı)
          <input className={cls + " mt-1"} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Klinik Psikolog" />
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => void finish(false)} disabled={busy}>Şimdilik geç</Button>
          <Button onClick={() => void finish(true)} disabled={busy || !name.trim()}>Başla</Button>
        </div>
      </div>
    </div>
  );
}

/** Son yedek yoksa ya da 30 günden eskiyse hatırlat. */
function backupOverdue(last: string | null): boolean {
  if (!last) return true;
  const t = Date.parse(last);
  return Number.isNaN(t) || Date.now() - t > 30 * 24 * 3600 * 1000;
}

function Shell() {
  const [page, setPage] = useState<Page>("home");
  const [patientId, setPatientId] = useState<string | null>(null);
  const [therapist, setTherapist] = useState({ name: "", title: "" });
  const [askRecovery, setAskRecovery] = useState(false);
  const [askProfile, setAskProfile] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [askGuide, setAskGuide] = useState(false);
  const [locked, setLocked] = useState(false);
  const [lockEnabled, setLockEnabled] = useState(false);
  const [lastBackup, setLastBackup] = useState<string | null | undefined>(undefined);
  const [hasPatients, setHasPatients] = useState(false);
  const [backupDismissed, setBackupDismissed] = useState(false);
  const [due, setDue] = useState<Appointment | null>(null);
  const [dueDismissed, setDueDismissed] = useState<string[]>([]);
  const lastActive = useRef(Date.now());
  const firstLoad = useRef(true);
  const [backHint, setBackHint] = useState(false);
  const pageRef = useRef(page);
  pageRef.current = page;
  // Geri tuşu: başka sayfadaysa ana sayfaya döner; ana sayfada uygulamadan çıkmaz, kısa bir uyarı verir.
  useBackGuard(true, () => {
    if (pageRef.current !== "home") {
      setPage("home");
      return;
    }
    setBackHint(true);
    setTimeout(() => setBackHint(false), 2500);
  });
  const { session } = useActiveSession();
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const version = useDataVersion();

  useEffect(() => {
    api.getSettings().then((s) => {
      setTherapist({ name: s.therapist_name ?? "", title: s.therapist_title ?? "" });
      const enabled = s.app_lock_set === "1";
      setLockEnabled(enabled);
      if (firstLoad.current) setLocked(enabled);
      firstLoad.current = false;
      setLastBackup(s.last_backup_at ?? null);
    });
    api.listPatients().then((l) => setHasPatients(l.length > 0));
  }, [version]);

  // Uygulama kilidi: 5 dakika hareketsizlikte kilitlenir (seans sürerken kilitlenmez).
  useEffect(() => {
    const touch = () => { lastActive.current = Date.now(); };
    const events = ["pointerdown", "keydown", "mousemove", "touchstart"] as const;
    events.forEach((e) => window.addEventListener(e, touch));
    const t = setInterval(() => {
      if (lockEnabled && !sessionRef.current && Date.now() - lastActive.current > 5 * 60_000) setLocked(true);
    }, 15_000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, touch));
      clearInterval(t);
    };
  }, [lockEnabled]);

  // Randevu saati gelince (5 dk önce - 10 dk sonra) "seansı başlat" önerisi.
  useEffect(() => {
    const check = () => {
      api.listAppointments().then((list) => {
        const now = Date.now();
        const hit = list.find((a) => {
          const d = new Date(a.appointment_date).getTime();
          return a.status === "scheduled" && d - now <= 5 * 60_000 && now - d <= 10 * 60_000;
        });
        setDue(hit ?? null);
      }).catch(() => {});
    };
    check();
    const t = setInterval(check, 30_000);
    return () => clearInterval(t);
  }, [version]);

  // Kurtarma anahtarı doğrulanana kadar her açılışta bir kez hatırlatılır.
  useEffect(() => {
    api.getSettings().then((s) => {
      setAskRecovery(!s[RECOVERY_CONFIRMED_KEY]);
      setAskProfile(!s.onboarding_done && !(s.therapist_name ?? "").trim());
      setAskGuide(!s.guide_seen);
    });
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
          {NAV.map(({ id, label, icon: Icon, pages }) => {
            const active = pages.some((p) => p.page === page);
            return (
            <button
              key={id}
              onClick={() => !active && setPage(id)}
              title={label}
              aria-label={label}
              aria-current={active ? "page" : undefined}
              className={cx(
                "relative flex items-center justify-center gap-2.5 rounded-lg px-2 py-2.5 text-[13px] transition-colors xl:justify-start xl:px-3 xl:py-2",
                active ? "bg-accent-soft font-medium text-ink" : "text-muted hover:bg-card hover:text-ink",
              )}
            >
              <Icon size={18} className={active ? "text-accent" : ""} />
              <span className="hidden xl:inline">{label}</span>
              {id === "home" && session && (
                <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-ok xl:static xl:ml-auto" title="Seans sürüyor" />
              )}
            </button>
            );
          })}
        </nav>
        <div className="mx-3 mb-3 hidden items-center gap-1.5 rounded-lg bg-card/60 px-3 py-2 text-[11px] text-faint xl:flex">
          <LockKeyhole size={12} /> Yerel ve şifreli
        </div>
        <button
          onClick={() => setGuideOpen(true)}
          title="Kullanım rehberi / User guide"
          aria-label="Kullanım rehberi"
          className="mx-1.5 mb-2 flex items-center justify-center gap-2.5 rounded-lg px-2 py-2.5 text-[13px] text-muted transition-colors hover:bg-card hover:text-ink xl:mx-2 xl:justify-start xl:px-3 xl:py-2"
        >
          <CircleHelp size={18} />
          <span className="hidden xl:inline">Rehber</span>
        </button>
        <button
          onClick={() => setPage("settings")}
          title={therapist.name || "Ayarlar"}
          className="flex items-center justify-center gap-3 border-t border-line px-2 py-4 text-left hover:bg-card xl:justify-start xl:px-4"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-card text-sm font-medium text-accent">
            {therapist.name ? therapist.name.slice(0, 1).toLocaleUpperCase("tr-TR") : <SettingsIcon size={16} />}
          </div>
          <div className="hidden min-w-0 xl:block">
            <div className="truncate text-sm">{therapist.name || "Ayarlar"}</div>
            {(therapist.title || !therapist.name) && (
              <div className="truncate text-xs text-faint">{therapist.title || "Adınızı ekleyin"}</div>
            )}
          </div>
        </button>
      </aside>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <SectionTabs page={page} onPage={setPage} />
        <div className="min-h-0 flex-1">
        {/* Görüşme başka sayfaya geçilince kopmasın diye Ana Sayfa hep bağlı kalır. */}
        <div className={page === "home" ? "h-full" : "hidden"}>
          <Workspace patientId={patientId} onSelectPatient={setPatientId} onNavigate={setPage} visible={page === "home"} />
        </div>
        {/* Grup görüşmesi de sayfa değişince kopmasın diye hep bağlı kalır. */}
        <div className={page === "groups" ? "h-full" : "hidden"}>
          <Groups onNavigate={setPage} visible={page === "groups"} />
        </div>
        {page === "patients" && <Patients onOpen={openPatient} />}
        {page === "appointments" && <Appointments />}
        {page === "billing" && <Billing />}
        {page === "sessions" && <Sessions onOpenPatient={openPatient} />}
        {page === "materials" && <Materials />}
        {page === "tests" && <Tests />}
        {page === "settings" && <Settings onOpenGuide={() => setGuideOpen(true)} />}
        </div>
      </main>

      <MobileNav page={page} onPage={setPage} sessionActive={!!session} />
      {backHint && (
        <div className="pointer-events-none fixed inset-x-0 top-6 z-[70] mx-auto w-fit max-w-[90%] rounded-lg bg-black/85 px-4 py-2 text-center text-xs text-white shadow-lg">
          Uygulamadan çıkmak için telefonun ana ekran tuşunu kullanın
        </div>
      )}

      {(due && !dueDismissed.includes(due.id)) || (hasPatients && !backupDismissed && lastBackup !== undefined && backupOverdue(lastBackup)) ? (
        <div className="fixed inset-x-0 top-3 z-[65] mx-auto flex w-fit max-w-[92%] flex-col gap-2">
          {due && !dueDismissed.includes(due.id) && (
            <div className="flex items-center gap-3 rounded-lg border border-accent/40 bg-panel px-4 py-2.5 text-sm shadow-lg">
              <span><b>{due.patient_name}</b> ile randevu saati geldi.</span>
              <Button className="py-1" onClick={() => { setDueDismissed((d) => [...d, due.id]); openPatient(due.patient_id); }}>Seansı başlat</Button>
              <button className="text-xs text-muted hover:text-ink" onClick={() => setDueDismissed((d) => [...d, due.id])}>Kapat</button>
            </div>
          )}
          {hasPatients && !backupDismissed && lastBackup !== undefined && backupOverdue(lastBackup) && (
            <div className="flex items-center gap-3 rounded-lg border border-warn/40 bg-panel px-4 py-2.5 text-sm shadow-lg">
              <span>{lastBackup ? "Son yedeğinizin üzerinden 30 günden fazla geçti." : "Henüz yedek almadınız."}</span>
              <Button className="py-1" variant="subtle" onClick={() => { setBackupDismissed(true); setPage("settings"); }}>Yedek al</Button>
              <button className="text-xs text-muted hover:text-ink" onClick={() => setBackupDismissed(true)}>Sonra</button>
            </div>
          )}
        </div>
      ) : null}

      <UpdateBanner sessionActive={!!session} />

      {locked && <AppLock onUnlock={() => { lastActive.current = Date.now(); setLocked(false); }} />}

      {askProfile && !locked && (
        <WelcomeProfile onDone={() => { setAskProfile(false); notifyDataChanged(); }} />
      )}

      {(guideOpen || (askGuide && !askProfile && !locked)) && (
        <GuideTour
          onClose={() => {
            setGuideOpen(false);
            if (askGuide) {
              setAskGuide(false);
              void api.setSetting("guide_seen", "1").catch(() => {});
            }
          }}
        />
      )}

      {askRecovery && !askProfile && !locked && !(askGuide || guideOpen) && (
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
  useBackClose(more, () => setMore(false));
  const main = NAV.filter((n) => ["home", "patients", "groups", "appointments"].includes(n.id));
  const rest = NAV.filter((n) => !["home", "patients", "groups", "appointments"].includes(n.id));
  const isActive = (n: (typeof NAV)[number]) => n.pages.some((p) => p.page === page);
  const restActive = rest.some(isActive);
  return (
    <nav className="relative shrink-0 border-t border-line bg-rail pb-[env(safe-area-inset-bottom)] md:hidden" aria-label="Ana gezinme">
      {more && (
        <>
          <button className="fixed inset-0 z-30 cursor-default" aria-label="Menüyü kapat" onClick={() => setMore(false)} />
          <div className="absolute bottom-full right-2 z-40 mb-2 w-52 overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl">
            {rest.map((n) => (
              <button
                key={n.id}
                onClick={() => {
                  onPage(n.id);
                  setMore(false);
                }}
                className={cx("flex w-full items-center gap-3 px-4 py-3 text-left text-sm", isActive(n) ? "bg-accent-soft text-ink" : "text-muted hover:bg-card")}
              >
                <n.icon size={18} className={isActive(n) ? "text-accent" : ""} /> {n.label}
              </button>
            ))}
          </div>
        </>
      )}
      <div className="flex">
        {main.map((n) => (
          <button
            key={n.id}
            onClick={() => !isActive(n) && onPage(n.id)}
            className={cx("relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px]", isActive(n) ? "text-accent" : "text-muted")}
          >
            <n.icon size={20} />
            {n.label}
            {n.id === "home" && sessionActive && <span className="absolute right-[28%] top-1.5 h-2 w-2 rounded-full bg-ok" />}
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
