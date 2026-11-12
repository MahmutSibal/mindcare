// Ortak çizim oturumunun durumu. Terapist ("host") başlatır ve kapatır; danışan ("guest") katılır.
// İki taraf da aynı kancayı kullanır; mesajlar görüşmenin şifreli veri kanalından gider.

import { useCallback, useEffect, useRef, useState } from "react";
import { BoardState, newId, sanitizeElements, sanitizeStroke, sanitizeText, type BoardMessage } from "./board";
import type { ChannelMessage } from "./rtc";

export interface BoardSession {
  id: string;
  prompt: string | null;
  /** Arka plan görselinin (gösterilen materyalin) kimliği. */
  backdropId: string | null;
}

export function useBoard(role: "host" | "guest", send: (m: ChannelMessage) => boolean, connected: boolean) {
  const board = useRef(new BoardState()).current;
  const [rev, setRev] = useState(0);
  const bump = useCallback(() => setRev((r) => r + 1), []);
  const [session, setSession] = useState<BoardSession | null>(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const sendRef = useRef(send);
  sendRef.current = send;

  /** Tahta durumunu karşıya gönderir; veri kanalı henüz açık değilse birkaç kez dener. */
  const sync = useCallback(() => {
    let tries = 0;
    const attempt = () => {
      const s = sessionRef.current;
      if (!s) return;
      const ok = sendRef.current({ type: "board_sync", sessionId: s.id, elements: board.elements, removed: [...board.removed] });
      if (!ok && ++tries < 8) setTimeout(attempt, 1000);
    };
    attempt();
  }, [board]);

  // Bağlantı (yeniden) kurulunca iki taraf da durumunu gönderir; alıcı birleştirir.
  useEffect(() => {
    if (!connected || !session) return;
    const t = setTimeout(sync, 600);
    return () => clearTimeout(t);
  }, [connected, session?.id, sync]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Terapist: yeni tahta açar ve danışana bildirir. */
  const open = useCallback(
    (prompt: string | null, backdropId: string | null = null) => {
      const id = newId();
      board.reset();
      const s = { id, prompt: prompt?.trim() || null, backdropId };
      sessionRef.current = s;
      setSession(s);
      sendRef.current({ type: "board_open", sessionId: id, prompt: s.prompt, backdropId });
      bump();
    },
    [board, bump],
  );

  /** Terapist: tahtayı iki taraf için kapatır. */
  const close = useCallback(() => {
    const s = sessionRef.current;
    if (s && role === "host") sendRef.current({ type: "board_close", sessionId: s.id });
    sessionRef.current = null;
    setSession(null);
  }, [role]);

  /** Gelen kanal mesajını işler; tahta mesajıysa `true` döner. */
  const handle = useCallback(
    (m: ChannelMessage): boolean => {
      if (!m.type.startsWith("board_")) return false;
      const b = m as BoardMessage;
      if (b.type === "board_open") {
        if (role === "guest" && typeof b.sessionId === "string") {
          board.reset();
          const s = {
            id: b.sessionId,
            prompt: typeof b.prompt === "string" ? b.prompt.slice(0, 500) : null,
            backdropId: typeof b.backdropId === "string" ? b.backdropId.slice(0, 64) : null,
          };
          sessionRef.current = s;
          setSession(s);
          bump();
        }
        return true;
      }
      const cur = sessionRef.current;
      if (!cur || b.sessionId !== cur.id) return true;
      switch (b.type) {
        case "board_close":
          if (role === "guest") {
            sessionRef.current = null;
            setSession(null);
          }
          break;
        case "board_stroke": {
          const s = sanitizeStroke(b);
          if (s) {
            board.addStroke(s);
            bump();
          }
          break;
        }
        case "board_text": {
          const t = sanitizeText(b.el);
          if (t) {
            board.addText(t);
            bump();
          }
          break;
        }
        case "board_undo":
          if (typeof b.id === "string") {
            board.undo(b.id);
            bump();
          }
          break;
        case "board_clear":
          board.clear();
          bump();
          break;
        case "board_sync":
          board.merge(
            sanitizeElements(b.elements),
            Array.isArray(b.removed) ? b.removed.filter((x): x is string => typeof x === "string").slice(0, 2000) : [],
          );
          bump();
          break;
      }
      return true;
    },
    [role, board, bump],
  );

  return { board, rev, session, open, close, handle, bump, send: (m: BoardMessage) => sendRef.current(m) };
}

export type BoardApi = ReturnType<typeof useBoard>;
