import { useEffect, useRef } from "react";

/**
 * Geri tuşu yönetimi. Telefonda geri tuşu sayfayı terk ettirir ve görüşme kopar. Burada açılan her ekran
 * (ödev, materyal, tuval, menü...) için tarayıcı geçmişine bir kayıt eklenir; geri tuşu sayfadan çıkmak
 * yerine en üstteki ekranı kapatır. Hiç ekran açık değilken geri tuşu görüşmeyi bırakmaz, kısa bir uyarı verir.
 */
interface Entry {
  id: number;
  close: () => void;
}

const stack: Entry[] = [];
let nextId = 1;
let ignore = 0; // kendi history.back() çağrımızın doğuracağı popstate olayı sayısı
let guard: (() => void) | null = null;
let installed = false;

function install() {
  if (installed) return;
  installed = true;
  window.addEventListener("popstate", () => {
    if (ignore > 0) {
      ignore--;
      return;
    }
    const top = stack.pop();
    if (top) {
      top.close();
      return;
    }
    if (guard) {
      // Ekran açık değil ve görüşme sürüyor: sayfadan çıkmayı engelle.
      history.pushState({ mcGuard: true }, "");
      guard();
    }
  });
}

/** Ekran açıkken geri tuşu onu kapatır (`close`). */
export function useBackClose(open: boolean, close: () => void) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    install();
    const entry: Entry = { id: nextId++, close: () => closeRef.current() };
    history.pushState({ mcOverlay: entry.id }, "");
    stack.push(entry);
    return () => {
      const i = stack.indexOf(entry);
      if (i >= 0) {
        // Ekran düğmeyle kapandı: eklediğimiz geçmiş kaydını geri al.
        stack.splice(i, 1);
        ignore++;
        history.back();
      }
    };
  }, [open]);
}

/** Görüşme sürerken geri tuşunun sayfadan çıkmasını engeller; `onBlocked` her engellemede çağrılır. */
export function useBackGuard(active: boolean, onBlocked: () => void) {
  const ref = useRef(onBlocked);
  ref.current = onBlocked;
  useEffect(() => {
    if (!active) return;
    install();
    history.pushState({ mcGuard: true }, "");
    const g = () => ref.current();
    guard = g;
    return () => {
      if (guard === g) guard = null;
    };
  }, [active]);
}
