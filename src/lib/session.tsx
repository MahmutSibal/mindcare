import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { api, type Session } from "./api";

/** Devam eden seansın durumu. Sayfalar arasında gezilse de korunur. */
interface ActiveSession {
  session: Session | null;
  elapsed: number;
  running: boolean;
  targetSeconds: number;
  /** Planlanan seans süresi (dakika); seans başlamadan önce ya da sürerken değiştirilebilir, hatırlanır. */
  setTargetMinutes: (minutes: number) => void;
  start: (patientId: string, targetMinutes?: number) => Promise<Session>;
  pause: () => void;
  resume: () => void;
  finish: () => Promise<void>;
}

const Ctx = createContext<ActiveSession | null>(null);

const TARGET_KEY = "mavi-ruh-seans-suresi";
const MIN_TARGET = 5;
const MAX_TARGET = 480;

function loadTargetMinutes(): number {
  try {
    const v = Number(localStorage.getItem(TARGET_KEY));
    return v >= MIN_TARGET && v <= MAX_TARGET ? v : 50;
  } catch {
    return 50;
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(false);
  const [targetSeconds, setTarget] = useState(() => loadTargetMinutes() * 60);
  const elapsedRef = useRef(0);
  elapsedRef.current = elapsed;

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [running]);

  // Uygulama beklenmedik şekilde kapanırsa süre kaybolmasın diye düzenli kayıt.
  useEffect(() => {
    if (!session) return;
    const t = setInterval(() => {
      api.updateSessionDuration(session.id, elapsedRef.current).catch(() => {});
    }, 30_000);
    return () => clearInterval(t);
  }, [session]);

  const setTargetMinutes = useCallback((minutes: number) => {
    const v = Math.min(MAX_TARGET, Math.max(MIN_TARGET, Math.round(minutes)));
    setTarget(v * 60);
    try {
      localStorage.setItem(TARGET_KEY, String(v));
    } catch {
      /* hatırlanmazsa bir sonraki açılışta 50 dk olur */
    }
  }, []);

  // Süre verilmezse seçili (hatırlanan) süre kullanılır.
  const start = useCallback(async (patientId: string, targetMinutes?: number) => {
    const s = await api.startSession(patientId);
    setSession(s);
    setElapsed(0);
    if (targetMinutes) setTargetMinutes(targetMinutes);
    setRunning(true);
    return s;
  }, [setTargetMinutes]);

  const finish = useCallback(async () => {
    if (!session) return;
    await api.finishSession(session.id, elapsedRef.current);
    setSession(null);
    setRunning(false);
    setElapsed(0);
  }, [session]);

  return (
    <Ctx.Provider
      value={{
        session,
        elapsed,
        running,
        targetSeconds,
        setTargetMinutes,
        start,
        pause: () => setRunning(false),
        resume: () => session && setRunning(true),
        finish,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useActiveSession() {
  const c = useContext(Ctx);
  if (!c) throw new Error("SessionProvider eksik");
  return c;
}

/** Basit veri yenileme sinyali: kayıt değiştiğinde ilgili listeler yeniden yüklenir. */
type Listener = () => void;
const listeners = new Set<Listener>();
export function notifyDataChanged() {
  listeners.forEach((l) => l());
}
export function useDataVersion() {
  const [v, setV] = useState(0);
  useEffect(() => {
    const l = () => setV((x) => x + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return v;
}
