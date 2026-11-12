import { useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink, Send, ShieldAlert, Sparkles, Trash2 } from "lucide-react";
import { api, errorText, type AssistantAnswer } from "../lib/api";
import { findIdentifiers } from "../lib/privacy";
import { useDataVersion } from "../lib/session";
import { Button, cx, inputCls } from "./ui";

interface Msg {
  role: "user" | "model";
  text: string;
  answer?: AssistantAnswer;
  error?: boolean;
}

const EXAMPLES = [
  "Panik bozukluğunda enterosepsiyon maruz bırakma nasıl uygulanır?",
  "Beck Depresyon Envanteri kesme puanları nelerdir?",
  "Yas sürecinde karmaşık yas ölçütleri nelerdir?",
  "Çocuk istismarından şüphelenildiğinde psikologun yasal yükümlülükleri nelerdir?",
];

/** [1], [2] gibi işaretleri kaynak bağlantısına çevirir. */
function Answer({ a }: { a: AssistantAnswer }) {
  const parts = a.text.split(/(\[\d+\])/g);
  return (
    <>
      <div className="whitespace-pre-wrap text-sm leading-relaxed">
        {parts.map((p, i) => {
          const m = /^\[(\d+)\]$/.exec(p);
          const src = m ? a.sources[Number(m[1]) - 1] : null;
          return src ? (
            <button
              key={i}
              onClick={() => void openUrl(src.uri)}
              title={src.title}
              className="mx-0.5 align-super text-[10px] font-medium text-accent hover:underline"
            >
              [{m![1]}]
            </button>
          ) : (
            <span key={i}>{p}</span>
          );
        })}
      </div>
      {a.sources.length > 0 ? (
        <div className="mt-3 border-t border-line pt-2">
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-faint">Kaynaklar</div>
          <ol className="space-y-1">
            {a.sources.map((s, i) => (
              <li key={s.uri} className="flex items-start gap-1.5 text-xs">
                <span className="shrink-0 text-faint">[{i + 1}]</span>
                <button onClick={() => void openUrl(s.uri)} className="flex min-w-0 items-center gap-1 text-left text-accent hover:underline">
                  <span className="truncate">{s.title}</span>
                  <ExternalLink size={11} className="shrink-0" />
                </button>
              </li>
            ))}
          </ol>
          {a.queries.length > 0 && <p className="mt-2 text-[11px] text-faint">Yapılan aramalar: {a.queries.join(" • ")}</p>}
        </div>
      ) : (
        <p className="mt-3 rounded-lg border border-warn/30 bg-warn/10 px-2.5 py-1.5 text-xs text-warn">
          Bu yanıt için doğrulanabilir kaynak bulunamadı; bilgiyi mutlaka güvenilir bir kaynaktan teyit edin.
        </p>
      )}
    </>
  );
}

/** Seans ekranının sağ panelinde duran sohbet: görüşme sırasında hızlıca soru sorulur. */
export default function AssistantChat({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [names, setNames] = useState<string[]>([]);
  const [blocked, setBlocked] = useState<string[] | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const version = useDataVersion();

  useEffect(() => {
    api.getSettings().then((s) => setConfigured(s.gemini_api_key_set === "1"));
    api.listPatients().then((p) => setNames(p.map((x) => x.full_name)));
  }, [version]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, busy]);

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    // Danışan tanımlayıcısı içeren soru Google'a gönderilmez.
    const found = findIdentifiers(q, names);
    if (found.length > 0) {
      setBlocked(found.map((f) => (f.kind === "ad" ? `kayıtlı danışan adı: ${f.text}` : f.text)));
      return;
    }
    setBlocked(null);
    // Hata alan sorular (ve hata mesajları) sonraki isteklere geçmiş olarak eklenmez.
    const history = msgs
      .filter((m, i) => !m.error && !msgs[i + 1]?.error)
      .map((m) => ({ role: m.role, text: m.text }));
    setMsgs((l) => [...l, { role: "user", text: q }]);
    setInput("");
    setBusy(true);
    try {
      const answer = await api.askAssistant(history, q);
      setMsgs((l) => [...l, { role: "model", text: answer.text, answer }]);
    } catch (e) {
      setMsgs((l) => [...l, { role: "model", text: errorText(e), error: true }]);
    } finally {
      setBusy(false);
    }
  };

  if (configured === false) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <div className="text-center">
          <Sparkles className="mx-auto mb-3 text-accent" size={28} />
          <h1 className="text-base font-semibold">Terapist asistanı</h1>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            Asistanı kullanmak için Gemini API anahtarı gerekir. Ücretsiz anahtarı aistudio.google.com/apikey adresinden alıp
            Ayarlar sayfasındaki "Yapay zekâ asistanı" bölümüne yapıştırın.
          </p>
          <Button className="mt-4" onClick={onOpenSettings}>Ayarlar'a git</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
        <Sparkles className="shrink-0 text-accent" size={16} />
        <div className="min-w-0 flex-1">
          <h1 className="text-[13px] font-semibold">Terapist asistanı</h1>
          <p className="truncate text-[11px] text-muted">Kaynaklı hatırlatma • klinik karar sizindir</p>
        </div>
        {msgs.length > 0 && (
          <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setMsgs([])} title="Konuşmayı temizle">
            <Trash2 size={14} />
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <div className="space-y-3">
          <div className="flex items-start gap-2 rounded-xl border border-warn/30 bg-warn/10 px-2.5 py-2 text-[11px] leading-relaxed text-warn">
            <ShieldAlert size={15} className="mt-0.5 shrink-0" />
            <span>
              Soruları Google'ın Gemini servisi yanıtlar. <b>Danışan adı, kimlik ya da tanımlayıcı bilgi yazmayın</b>; konuyu
              genel ("40 yaşında bir erkek danışanda…") tutun. Konuşma yalnızca bu pencerede durur, kaydedilmez.
            </span>
          </div>

          {msgs.length === 0 && (
            <div className="space-y-2 pt-2">
              <p className="text-sm text-muted">Örnek sorular:</p>
              {EXAMPLES.map((e) => (
                <button
                  key={e}
                  onClick={() => void send(e)}
                  className="block w-full rounded-lg border border-line bg-card px-2.5 py-1.5 text-left text-[13px] hover:bg-line"
                >
                  {e}
                </button>
              ))}
            </div>
          )}

          {msgs.map((m, i) => (
            <div key={i} className={cx("flex", m.role === "user" && "justify-end")}>
              <div
                className={cx(
                  "max-w-[95%] rounded-2xl px-3 py-2.5",
                  m.role === "user" ? "bg-accent-soft text-ink" : m.error ? "border border-danger/40 bg-danger/10 text-danger" : "border border-line bg-panel",
                )}
              >
                {m.answer ? <Answer a={m.answer} /> : <div className="whitespace-pre-wrap text-sm leading-relaxed">{m.text}</div>}
              </div>
            </div>
          ))}
          {busy && <div className="text-sm text-muted">Asistan kaynakları araştırıyor…</div>}
          <div ref={bottom} />
        </div>
      </div>

      <div className="shrink-0 border-t border-line px-3 py-2.5">
        <div>
          {blocked && (
            <p className="mb-2 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger" role="alert">
              Soru gönderilmedi: tanımlayıcı bilgi içeriyor ({blocked.join(", ")}). Lütfen danışanı anonimleştirip yeniden yazın.
            </p>
          )}
          <div className="flex items-end gap-2">
            <textarea
              className={cx(inputCls, "max-h-40 min-h-[44px] flex-1 resize-none")}
              rows={2}
              placeholder="Sorunuzu yazın… (Enter ile gönder, Shift+Enter yeni satır)"
              value={input}
              maxLength={4000}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(input);
                }
              }}
            />
            <Button onClick={() => void send(input)} disabled={busy || !input.trim()} aria-label="Gönder">
              <Send size={16} />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
