// Grup seansı araçları: ana sayfadaki test, materyal, ortak çizim ve ödev özelliklerinin grup karşılığı.
// Gönderilenler tüm katılımcılara gider; yanıtlar gönderene bakılarak ilgili üyenin dosyasına işlenir.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ClipboardCheck, FileSignature, Pencil, Send, Undo2 } from "lucide-react";
import {
  api, errorText, type GroupMember, type Material, type Test,
} from "../../lib/api";
import type { ChannelMessage } from "../../lib/rtc";
import { maxScore, parseDefinition } from "../../lib/tests";
import { notifyDataChanged } from "../../lib/session";
import { MaterialLibrary } from "../../pages/Workspace";
import { Button, cx, Field, inputCls, Modal } from "../ui";
import { hideMaterial, showMaterial, type SharedMaterial } from "./materialShare";
import { TestPicker } from "./SessionPanel";
import type { CallApi } from "./useCall";
import type { GroupCallApi } from "./useGroupCall";

// ───────────────────────────── Kanal uyarlayıcısı ─────────────────────────────

/**
 * Grup görüşmesini, birebir görüşme için yazılmış bileşenlerin (materyal gösterimi vb.) beklediği
 * biçime çevirir. Gönderilenler tüm üyelere gider. Materyal videosu grupta henüz desteklenmez.
 */
export function useGroupCallAdapter(g: GroupCallApi): CallApi {
  const ref = useRef(g);
  ref.current = g;
  return useMemo(
    () =>
      ({
        state: g.state,
        inCall: g.inCall,
        local: g.local,
        remote: null,
        screen: g.screen,
        micOn: g.micOn,
        camOn: g.camOn,
        videoShare: null,
        videoPaused: false,
        sendMessage: (m: ChannelMessage) => ref.current.sendMessage(m),
        sendBuffered: (m: ChannelMessage) => ref.current.sendBuffered(m),
        onMessage: ref.current.onMessage,
        showVideo: async () => {
          throw new Error("Video materyali grup görüşmesinde henüz desteklenmiyor. Videoyu ekran paylaşımıyla gösterin.");
        },
        stopVideo: () => {},
      }) as unknown as CallApi,
    [g.state, g.inCall, g.local, g.screen, g.micOn, g.camOn],
  );
}

// ───────────────────────────── Materyal gösterimi ─────────────────────────────

export function useGroupMaterial(call: CallApi) {
  const [shared, setShared] = useState<SharedMaterial | null>(null);
  const [error, setError] = useState<string | null>(null);
  const active = useRef<object | null>(null);
  const callRef = useRef(call);
  callRef.current = call;
  const sharedRef = useRef(shared);
  sharedRef.current = shared;

  const { onMessage } = call;
  useEffect(
    () =>
      onMessage((m) => {
        // İlk üyenin onayı yeterli; gerisi ayrıntı.
        if (m.type === "material_received") setShared((s) => (s && s.shareId === m.id && s.status === "sent" ? { ...s, status: "shown" } : s));
      }),
    [onMessage],
  );

  const show = useCallback(async (m: Material, bytes?: Uint8Array<ArrayBuffer>): Promise<SharedMaterial | null> => {
    setError(null);
    if (sharedRef.current) hideMaterial(callRef.current, sharedRef.current);
    setShared(null);
    const token = {};
    active.current = token;
    let last: SharedMaterial | null = null;
    try {
      await showMaterial(callRef.current, m, (s) => {
        last = s;
        if (active.current === token) setShared(s);
      }, bytes);
      return last;
    } catch (e) {
      if (active.current !== token) return null;
      setShared(null);
      setError(errorText(e));
      return null;
    }
  }, []);

  const clear = useCallback(() => {
    active.current = null;
    if (sharedRef.current) hideMaterial(callRef.current, sharedRef.current);
    setShared(null);
  }, []);

  // Görüşme bitince gösterim de biter.
  useEffect(() => {
    if (!call.inCall) setShared(null);
  }, [call.inCall]);

  return { shared, error, show, clear };
}

// ───────────────────────────── Ödev ─────────────────────────────

// Bu ekranda gönderilen ödevler; üyelerden gelen "ulaştı" onayı yalnızca bunlar için kabul edilir.
export const sentHomework = new Set<string>();

export function GroupHomeworkDialog({ members, call, onClose }: { members: GroupMember[]; call: GroupCallApi; onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [due, setDue] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set(members.map((m) => m.patient_id)));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const connected = call.inCall;

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selected.size === 0) return setError("En az bir üye seçin.");
    setBusy(true);
    setError(null);
    try {
      for (const m of members.filter((x) => selected.has(x.patient_id))) {
        const hw = await api.createHomework({ patient_id: m.patient_id, session_id: null, title, description, due_date: due });
        // Ödev yalnızca o üyenin ekranına gider (diğer katılımcılar görmez).
        const peer = call.peers.find((p) => p.memberId === m.patient_id && p.state === "connected");
        if (peer && call.sendMessage({ type: "homework", id: hw.id, title: hw.title, description: hw.description, due: hw.due_date }, peer.id)) {
          sentHomework.add(hw.id);
        }
      }
      notifyDataChanged();
      onClose();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <Modal title="Gruba ödev ver" onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <Field label="Başlık">
          <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus required placeholder="Örn. Düşünce kaydı tutmak" />
        </Field>
        <Field label="Açıklama" hint="Üyenin ekranında görünür; üye indirip saklayabilir.">
          <textarea className={inputCls} rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="Son tarih (isteğe bağlı)">
          <input type="date" className={inputCls} value={due} onChange={(e) => setDue(e.target.value)} />
        </Field>
        <Field label="Kimlere" hint="Her üyenin dosyasına ayrı ödev olarak kaydedilir.">
          <div className="space-y-0.5 rounded-lg border border-line bg-bg p-1.5">
            {members.map((m) => (
              <label key={m.patient_id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-card">
                <input type="checkbox" checked={selected.has(m.patient_id)} onChange={() => toggle(m.patient_id)} />
                <span className="truncate">{m.full_name}</span>
              </label>
            ))}
          </div>
        </Field>
        <p className={cx("rounded-lg px-3 py-2 text-xs", connected ? "bg-accent-soft text-accent" : "bg-card text-muted")}>
          {connected
            ? "Kaydedince bağlı üyelerin ekranına da gönderilecek."
            : "Görüşme açık değil: ödevler kaydedilir, üyelerin dosyasından sonra gönderilebilir."}
        </p>
        {error && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Vazgeç</Button>
          <Button type="submit" disabled={busy}>{connected ? <><Send size={15} /> Kaydet ve gönder</> : "Kaydet"}</Button>
        </div>
      </form>
    </Modal>
  );
}

// ───────────────────────────── Test ─────────────────────────────

interface PendingGroupTest {
  requestId: string;
  test: Test;
  /** Testi alan ve cevaplayan üyeler (danışan kimliğiyle). */
  received: Set<string>;
  answered: Set<string>;
}

// ───────────────────────────── Araçlar kartı ─────────────────────────────

export function GroupTools({ call, members, materials, material, onOpenBoard, onDrawMaterial, onNavigate }: {
  call: GroupCallApi;
  members: GroupMember[];
  materials: Material[];
  material: ReturnType<typeof useGroupMaterial>;
  onOpenBoard: () => void;
  onDrawMaterial: (m: Material) => void;
  onNavigate: (p: "materials") => void;
}) {
  const [tab, setTab] = useState<"tools" | "materials">("tools");
  const [picking, setPicking] = useState(false);
  const [givingHomework, setGivingHomework] = useState(false);
  const [pending, setPending] = useState<PendingGroupTest | null>(null);
  const [last, setLast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const peersRef = useRef(call.peers);
  peersRef.current = call.peers;
  const memberIds = useRef(new Set<string>());
  memberIds.current = new Set(members.map((m) => m.patient_id));
  const connected = call.state === "connected";

  // Üyelerden gelen test cevapları: gönderenin üyeliğine bakılarak o üyenin dosyasına kaydedilir.
  const { onMessage } = call;
  useEffect(
    () =>
      onMessage(async (m, from) => {
        const p = pendingRef.current;
        if (!p || !("requestId" in m) || m.requestId !== p.requestId) return;
        const memberId = peersRef.current.find((x) => x.id === from)?.memberId;
        if (!memberId || !memberIds.current.has(memberId)) return;
        if (m.type === "test_received") {
          setPending({ ...p, received: new Set(p.received).add(memberId) });
          return;
        }
        if (m.type !== "test_answers" || p.answered.has(memberId)) return;
        setPending((cur) => (cur && cur.requestId === p.requestId ? { ...cur, answered: new Set(cur.answered).add(memberId) } : cur));
        try {
          const r = await api.saveTestResult({
            patient_id: memberId,
            session_id: null,
            test_id: p.test.id,
            test_title: p.test.title,
            definition_json: p.test.definition_json,
            answers_json: JSON.stringify(m.answers),
          });
          const who = members.find((x) => x.patient_id === memberId)?.full_name ?? "Üye";
          const max = maxScore(parseDefinition(r.definition_json));
          setLast(`${who}: ${r.test_title}${r.total_score !== null ? ` • ${r.total_score}${max !== null ? ` / ${max}` : ""} puan` : ""}`);
          notifyDataChanged();
        } catch (e) {
          setError(`Test sonucu kaydedilemedi: ${errorText(e)}`);
        }
      }),
    [onMessage, members],
  );

  useEffect(() => {
    if (!call.inCall) setPending(null);
  }, [call.inCall]);

  const send = (test: Test) => {
    setError(null);
    const requestId = crypto.randomUUID();
    const ok = call.sendMessage({
      type: "test",
      requestId,
      title: test.title,
      instructions: test.instructions,
      definition: parseDefinition(test.definition_json),
    });
    if (!ok) {
      setError("Üyelerin bağlantısı hazır değil. Görüşme bağlandıktan sonra tekrar deneyin.");
      return;
    }
    setPending({ requestId, test, received: new Set(), answered: new Set() });
    setLast(null);
    setPicking(false);
  };

  const withdraw = () => {
    if (pending) call.sendMessage({ type: "test_cancel", requestId: pending.requestId });
    setPending(null);
  };

  const total = call.peers.filter((p) => p.memberId).length;

  return (
    <section className="flex max-h-[44%] shrink-0 flex-col rounded-xl border border-line bg-panel">
      <div className="flex shrink-0 gap-0.5 border-b border-line px-2 pt-1.5">
        {([["tools", "Test ve Ödev"], ["materials", "Materyaller"]] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cx(
              "-mb-px border-b-2 px-2.5 py-2 text-[13px] transition-colors",
              tab === id ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
        {tab === "materials" ? (
          <>
            {material.shared && (
              <div className="mb-2 flex items-center gap-2 rounded-lg border border-accent/40 bg-accent-soft px-3 py-2 text-xs">
                <span className="min-w-0 flex-1 truncate">
                  Gruba gösterilen: <b>{material.shared.material.title}</b>
                  {material.shared.status === "sending" ? ` (%${Math.round(material.shared.progress * 100)})` : ""}
                </span>
                <Button variant="ghost" className="px-2 py-0.5 text-xs" onClick={material.clear}>Kaldır</Button>
              </div>
            )}
            <MaterialLibrary
              materials={materials}
              onShow={(m) => void material.show(m)}
              onDraw={onDrawMaterial}
              onAll={() => onNavigate("materials")}
              connected={connected}
              error={material.error}
            />
          </>
        ) : (
          <ul className="space-y-1.5">
            <li className="rounded-lg bg-card/70 px-3 py-2">
              <div className="flex items-center gap-3">
                <ClipboardCheck size={18} className={connected ? "text-accent" : "text-muted"} />
                <div className="min-w-0 flex-1 text-[13px]">
                  Gruba test gönder
                  <div className="truncate text-xs text-faint">
                    {pending
                      ? `${pending.test.title}: ${pending.answered.size}/${total || "?"} yanıtladı`
                      : last ?? (connected ? "Tüm üyelere gönderilir; her cevap kendi dosyasına kaydolur" : "Görüşme bağlanınca kullanılabilir")}
                  </div>
                </div>
                {pending ? (
                  <Button variant="ghost" className="px-2 py-1 text-xs" onClick={withdraw}><Undo2 size={14} /> Geri çek</Button>
                ) : (
                  <Button variant="outline" className="px-3 py-1 text-xs" onClick={() => setPicking(true)} disabled={!connected}>Seç</Button>
                )}
              </div>
              {error && <p className="mt-2 text-xs text-danger">{error}</p>}
            </li>
            <li className="flex items-center gap-3 rounded-lg bg-card/70 px-3 py-2">
              <Pencil size={18} className={connected ? "text-accent" : "text-muted"} />
              <div className="min-w-0 flex-1 text-[13px]">
                Ortak çizim
                <div className="truncate text-xs text-faint">{connected ? "Herkes aynı tuvale çizer" : "Görüşme bağlanınca kullanılabilir"}</div>
              </div>
              <Button variant="outline" className="px-3 py-1 text-xs" onClick={onOpenBoard} disabled={!connected}>Aç</Button>
            </li>
            <li className="flex items-center gap-3 rounded-lg bg-card/70 px-3 py-2">
              <FileSignature size={18} className="text-accent" />
              <div className="min-w-0 flex-1 text-[13px]">
                Gruba ödev ver
                <div className="truncate text-xs text-faint">{connected ? "Seçtiğiniz üyelerin ekranına da gönderilir" : "Kaydedilir, görüşmede gönderilebilir"}</div>
              </div>
              <Button variant="outline" className="px-3 py-1 text-xs" onClick={() => setGivingHomework(true)}>Ver</Button>
            </li>
          </ul>
        )}
      </div>
      {picking && <TestPicker onClose={() => setPicking(false)} onSend={send} />}
      {givingHomework && <GroupHomeworkDialog members={members} call={call} onClose={() => setGivingHomework(false)} />}
    </section>
  );
}
