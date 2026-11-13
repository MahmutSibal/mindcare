import { useEffect, useState } from "react";

/** Telefon genişliği (Tailwind `md` eşiğinin altı). */
export function useIsMobile(): boolean {
  const q = "(max-width: 767px)";
  const [m, setM] = useState(() => window.matchMedia?.(q).matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.(q);
    if (!mq) return;
    const on = () => setM(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return m;
}
