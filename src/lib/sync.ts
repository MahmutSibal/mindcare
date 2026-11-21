// Cihazlar arası eşitleme: Rust motoru kayıtları şifreler ve uygular, bu dosya yalnızca şifreli paketleri
// Supabase ile taşır. Sunucu içeriği göremez; şifreleme anahtarı webview'a hiç gelmez.

import { useEffect, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ensureSignedIn, supabase } from "./rtc";
import { notifyDataChanged, useDataVersion } from "./session";

export interface SyncStatus {
  enabled: boolean;
  device: string;
  pending: number;
  cursor: number;
  last_sync_at: number | null;
}

interface SyncItem {
  rec: string;
  ts: number;
  device: string;
  deleted: boolean;
  data: string | null;
  seq?: number;
}

interface PushBatch {
  items: SyncItem[];
  upto_seq: number;
  skipped: number;
}

interface ApplyReport {
  applied: number;
  stale: number;
  failed: number;
  last_seq: number;
}

interface Credentials {
  vault: string;
  token: string;
  cursor: number;
  device: string;
}

export interface SyncState {
  enabled: boolean;
  busy: boolean;
  /** Son başarılı eşitleme (ms). */
  last: number | null;
  /** Gönderilmeyi bekleyen kayıt sayısı. */
  pending: number;
  error: string | null;
  /** Çok büyük olduğu için eşitlenmeyen kayıtlar. */
  skipped: number;
  /** Başka cihazdan gelip uygulanamayan kayıtlar (ör. aynı numaralı seans). */
  failed: number;
}

let state: SyncState = { enabled: false, busy: false, last: null, pending: 0, error: null, skipped: 0, failed: 0 };
const subs = new Set<() => void>();

function setState(p: Partial<SyncState>) {
  state = { ...state, ...p };
  subs.forEach((f) => f());
}

export function useSyncState(): SyncState {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => state,
  );
}

const BATCH_ITEMS = 50;
const BATCH_BYTES = 4_000_000;

function friendly(e: unknown): string {
  const m = e instanceof Error ? e.message : typeof e === "string" ? e : (e as { message?: string })?.message ?? String(e);
  const l = m.toLowerCase();
  if (l.includes("failed to fetch") || l.includes("networkerror") || l.includes("load failed")) return "Sunucuya ulaşılamadı. İnternet bağlantısını kontrol edin.";
  if (l.includes("quota")) return "Eşitleme alanı doldu (250 MB). Büyük dosyaları silin.";
  if (l.includes("denied")) return "Eşitleme kasasına erişim reddedildi. Eşleştirme kodu doğru mu?";
  if (l.includes("capacity")) return "Eşitleme sunucusu şu an yeni kasa kabul etmiyor.";
  return m;
}

export async function refreshSyncStatus(): Promise<SyncStatus> {
  const s = await invoke<SyncStatus>("sync_status");
  setState({ enabled: s.enabled, pending: s.pending, last: s.last_sync_at });
  return s;
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase().rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

/** Önce yerel değişiklikleri gönderir, sonra diğer cihazlardakileri çekip uygular. */
export async function syncNow(): Promise<void> {
  if (state.busy) return;
  setState({ busy: true });
  try {
    const creds = await invoke<Credentials | null>("sync_credentials");
    if (!creds) {
      setState({ enabled: false, busy: false, error: null });
      return;
    }
    await ensureSignedIn();
    const opened = await rpc<string>("sync_open", { p_vault: creds.vault, p_token: creds.token });
    if (opened !== "ok") throw new Error(opened);
    const v = { p_vault: creds.vault, p_token: creds.token };

    let skipped = 0;
    for (;;) {
      const batch = await invoke<PushBatch>("sync_prepare_push", { maxItems: BATCH_ITEMS, maxBytes: BATCH_BYTES });
      skipped += batch.skipped;
      if (batch.items.length > 0) await rpc<number>("sync_push", { ...v, p_items: batch.items });
      await invoke("sync_commit_push", { uptoSeq: batch.upto_seq });
      if (batch.items.length < BATCH_ITEMS) break;
    }

    let cursor = creds.cursor;
    let applied = 0;
    let failed = 0;
    for (;;) {
      const rows = await rpc<SyncItem[]>("sync_pull", { ...v, p_after: cursor, p_limit: 50 });
      if (!rows || rows.length === 0) break;
      const rep = await invoke<ApplyReport>("sync_apply", { items: rows });
      applied += rep.applied;
      failed += rep.failed;
      cursor = Math.max(cursor, ...rows.map((r) => r.seq ?? 0));
      if (rows.length < 50) break;
    }
    if (applied > 0) notifyDataChanged();
    const s = await refreshSyncStatus();
    setState({ busy: false, error: null, skipped, failed, last: s.last_sync_at ?? Date.now() });
  } catch (e) {
    setState({ busy: false, error: friendly(e) });
  }
}

/** Bu cihazda eşitlemeyi açar; diğer cihaza girilecek eşleştirme kodunu döndürür. */
export async function syncEnable(): Promise<string> {
  const code = await invoke<string>("sync_enable");
  await refreshSyncStatus();
  void syncNow();
  return code;
}

export async function syncPairingCode(): Promise<string> {
  return invoke<string>("sync_pairing_code");
}

/** Başka cihazdaki kodla bağlanır ve hemen eşitler. */
export async function syncJoin(code: string): Promise<void> {
  await invoke("sync_join", { code });
  await refreshSyncStatus();
  await syncNow();
}

/** Eşitlemeyi kapatır. `wipe` doğruysa sunucudaki şifreli kopya da silinir (başarısız olursa kapatılmaz). */
export async function syncDisable(wipe: boolean): Promise<void> {
  if (wipe) {
    const creds = await invoke<Credentials | null>("sync_credentials");
    if (creds) {
      try {
        await ensureSignedIn();
        await rpc<void>("sync_wipe", { p_vault: creds.vault, p_token: creds.token });
      } catch (e) {
        const m = friendly(e);
        // Kasa zaten yoksa (daha önce silinmiş) devam edilebilir.
        if (!m.toLowerCase().includes("erişim reddedildi")) throw new Error(`Sunucudaki veri silinemedi: ${m}`);
      }
    }
  }
  await invoke("sync_disable");
  setState({ enabled: false, error: null, pending: 0, last: null });
}

/** Eşitleme açıksa arka planda çalışır: açılışta, dakikada bir, pencereye dönünce ve veri değişince. */
export function useSyncLoop(paused: boolean) {
  const version = useDataVersion();
  const { enabled } = useSyncState();

  useEffect(() => {
    void refreshSyncStatus().catch(() => {});
  }, []);

  useEffect(() => {
    if (!enabled || paused) return;
    const tick = () => {
      if (document.visibilityState === "visible") void syncNow();
    };
    tick();
    const iv = setInterval(tick, 60_000);
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(iv);
      window.removeEventListener("focus", tick);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [enabled, paused]);

  // Kayıt değişince kısa bir bekleme sonrası gönder (art arda değişiklikler tek turda gider).
  useEffect(() => {
    if (!enabled || paused) return;
    const t = setTimeout(() => void syncNow(), 6000);
    return () => clearTimeout(t);
  }, [version, enabled, paused]);
}
