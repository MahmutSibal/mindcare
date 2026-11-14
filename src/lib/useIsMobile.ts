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

/** Üç sütunlu düzenin açıldığı genişlik (Tailwind `xl`). */
export function useIsWide(): boolean {
  const q = "(min-width: 1280px)";
  const [m, setM] = useState(() => window.matchMedia?.(q).matches ?? true);
  useEffect(() => {
    const mq = window.matchMedia?.(q);
    if (!mq) return;
    const on = () => setM(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return m;
}

/** Dokunmatik cihaz mı (telefon, tablet). */
export const isTouchDevice = () => window.matchMedia?.("(pointer: coarse)").matches ?? false;
