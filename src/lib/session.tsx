import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { api, type Session } from "./api";

/** Devam eden seansın durumu. Sayfalar arasında gezilse de korunur. */
interface ActiveSession {
  session: Session | null;
  elapsed: number;
  running: boolean;
  targetSeconds: number;
  start: (patientId: string, targetMinutes?: number) => Promise<Session>;
  pause: () => void;
  resume: () => void;
  finish: () => Promise<void>;
}

const Ctx = createContext<ActiveSession | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(false);
  const [targetSeconds, setTarget] = useState(50 * 60);
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

  const start = useCallback(async (patientId: string, targetMinutes = 50) => {
    const s = await api.startSession(patientId);
    setSession(s);
    setElapsed(0);
    setTarget(targetMinutes * 60);
    setRunning(true);
    return s;
  }, []);

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
