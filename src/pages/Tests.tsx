import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, ClipboardList, ClipboardPaste, PencilLine, Plus, Trash2 } from "lucide-react";
import { api, errorText, type Test } from "../lib/api";
import { fmtDate } from "../lib/format";
import { notifyDataChanged, useDataVersion } from "../lib/session";
import {
  FREQUENCY_SCALE, maxScore, newQuestionId, parseDefinition, type QuestionKind, type TestDefinition, type TestOption,
  type TestQuestion,
} from "../lib/tests";
import PageHeader from "../components/PageHeader";
import { Button, Empty, Field, inputCls, Modal } from "../components/ui";

export default function Tests() {
  const version = useDataVersion();
  const [list, setList] = useState<Test[]>([]);
  const [editing, setEditing] = useState<Test | "new" | null>(null);
  const [deleting, setDeleting] = useState<Test | null>(null);

  useEffect(() => {
    api.listTests().then(setList);
  }, [version]);

  return (
    <div className="h-full overflow-y-auto p-8">
      <PageHeader
        title="Testler"
        subtitle="Kendi testlerinizi oluşturun; seans sırasında danışana gönderin, sonuçlar danışan dosyasına kaydedilir."
      >
        <Button onClick={() => setEditing("new")}><Plus size={16} /> Test Oluştur</Button>
      </PageHeader>

      {list.length === 0 ? (
        <Empty icon={<ClipboardList size={28} />} text="Henüz test oluşturulmadı." />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
          {list.map((t) => {
            const def = parseDefinition(t.definition_json);
            const max = maxScore(def);
            return (
              <div key={t.id} className="flex flex-col rounded-xl border border-line bg-panel p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                    <ClipboardList size={22} />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate font-medium">{t.title}</div>
                    <div className="text-xs text-muted">
                      {def.questions.length} soru{max !== null && ` • en yüksek puan ${max}`}
                    </div>
                  </div>
                </div>
                {t.instructions && <p className="mt-3 line-clamp-2 text-sm text-muted">{t.instructions}</p>}
                <div className="mt-auto flex items-center justify-between pt-3">
                  <span className="text-xs text-faint">{fmtDate(t.updated_at ?? t.created_at, true)}</span>
                  <div className="flex gap-1">
                    <Button variant="ghost" className="px-2 py-1.5 text-xs" onClick={() => setEditing(t)}>
                      <PencilLine size={14} /> Düzenle
                    </Button>
                    <Button variant="ghost" className="px-2 py-1.5 text-xs hover:text-danger" onClick={() => setDeleting(t)}>
                      <Trash2 size={14} /> Sil
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && <TestEditor test={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      {deleting && (
        <Modal title="Testi sil" onClose={() => setDeleting(null)}>
          <p className="text-sm text-muted">
            <b className="text-ink">{deleting.title}</b> silinecek. Danışanların bu testle ilgili geçmiş sonuçları
            silinmez ve okunabilir kalır.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleting(null)}>Vazgeç</Button>
            <Button
              variant="danger"
              onClick={async () => {
                await api.deleteTest(deleting.id);
                setDeleting(null);
                notifyDataChanged();
              }}
            >
              Sil
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ───────────────────────────── Test düzenleyici ─────────────────────────────

function TestEditor({ test, onClose }: { test: Test | null; onClose: () => void }) {
  const initial: TestDefinition = test
    ? parseDefinition(test.definition_json)
    : { options: FREQUENCY_SCALE, questions: [{ id: newQuestionId(), text: "", kind: "scale" }] };
  const [title, setTitle] = useState(test?.title ?? "");
  const [instructions, setInstructions] = useState(test?.instructions ?? "");
  const [options, setOptions] = useState<TestOption[]>(initial.options);
  const [questions, setQuestions] = useState<TestQuestion[]>(initial.questions);
  const [pasting, setPasting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setOption = (i: number, patch: Partial<TestOption>) =>
    setOptions(options.map((o, j) => (j === i ? { ...o, ...patch } : o)));
  const setQuestion = (i: number, patch: Partial<TestQuestion>) =>
    setQuestions(questions.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= questions.length) return;
    const next = [...questions];
    [next[i], next[j]] = [next[j]!, next[i]!];
    setQuestions(next);
  };

  const hasScale = questions.some((q) => q.kind === "scale");
  const max = maxScore({ options, questions });

  const save = async () => {
    setError(null);
    const definition: TestDefinition = {
      options: hasScale ? options.map((o) => ({ label: o.label.trim(), score: Number(o.score) || 0 })) : [],
      questions: questions.map((q) => ({ ...q, text: q.text.trim() })),
    };
    try {
      await api.saveTest(test?.id ?? null, {
        title,
        instructions,
        definition_json: JSON.stringify(definition),
      });
      notifyDataChanged();
      onClose();
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <Modal title={test ? "Testi Düzenle" : "Yeni Test"} onClose={onClose} width="max-w-3xl">
      <div className="space-y-4">
        <Field label="Test adı">
          <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus placeholder="Örn. Haftalık duygu durum değerlendirmesi" />
        </Field>
        <Field label="Danışana yönerge" hint="Testin başında danışana gösterilir.">
          <textarea
            className={inputCls}
            rows={2}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="Örn. Son iki hafta içinde aşağıdaki sorunlardan ne sıklıkla rahatsız oldunuz?"
          />
        </Field>

        {hasScale && (
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Cevap seçenekleri <span className="font-normal text-faint">(tüm ölçekli sorular için ortak)</span></h3>
              <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setOptions(FREQUENCY_SCALE)}>0–3 sıklık ölçeği</Button>
            </div>
            <div className="space-y-2">
              {options.map((o, i) => (
                <div key={i} className="grid grid-cols-[1fr_90px_32px] gap-2">
                  <input className={inputCls} value={o.label} onChange={(e) => setOption(i, { label: e.target.value })} placeholder="Seçenek" />
                  <input
                    type="number"
                    className={inputCls}
                    value={o.score}
                    onChange={(e) => setOption(i, { score: Number(e.target.value) })}
                    title="Puan"
                  />
                  <button
                    onClick={() => setOptions(options.filter((_, j) => j !== i))}
                    className="rounded-md text-faint hover:bg-card hover:text-danger"
                    aria-label="Seçeneği kaldır"
                  >
                    <Trash2 size={15} className="mx-auto" />
                  </button>
                </div>
              ))}
            </div>
            <Button variant="ghost" className="mt-2 px-2 py-1 text-xs" onClick={() => setOptions([...options, { label: "", score: options.length }])}>
              <Plus size={14} /> Seçenek ekle
            </Button>
          </section>
        )}

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Sorular <span className="font-normal text-faint">({questions.length}{max !== null && ` • en yüksek puan ${max}`})</span></h3>
            <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setPasting(true)}><ClipboardPaste size={14} /> Toplu yapıştır</Button>
          </div>
          <ol className="space-y-2">
            {questions.map((q, i) => (
              <li key={q.id} className="grid grid-cols-[24px_1fr_150px_auto] items-start gap-2 rounded-lg bg-card/50 p-2">
                <span className="pt-2 text-right text-sm text-faint">{i + 1}.</span>
                <textarea
                  className={`${inputCls} resize-y`}
                  rows={1}
                  value={q.text}
                  onChange={(e) => setQuestion(i, { text: e.target.value })}
                  placeholder="Soru metni"
                />
                <select className={inputCls} value={q.kind} onChange={(e) => setQuestion(i, { kind: e.target.value as QuestionKind })}>
                  <option value="scale">Ölçekli (puanlı)</option>
                  <option value="text">Serbest metin</option>
                </select>
                <div className="flex">
                  <IconBtn label="Yukarı taşı" onClick={() => move(i, -1)} disabled={i === 0}><ArrowUp size={15} /></IconBtn>
                  <IconBtn label="Aşağı taşı" onClick={() => move(i, 1)} disabled={i === questions.length - 1}><ArrowDown size={15} /></IconBtn>
                  <IconBtn label="Soruyu sil" onClick={() => setQuestions(questions.filter((_, j) => j !== i))} danger><Trash2 size={15} /></IconBtn>
                </div>
              </li>
            ))}
          </ol>
          <Button variant="ghost" className="mt-2 px-2 py-1 text-xs" onClick={() => setQuestions([...questions, { id: newQuestionId(), text: "", kind: "scale" }])}>
            <Plus size={14} /> Soru ekle
          </Button>
        </section>

        <p className="text-xs text-faint">
          Kullandığınız testlerin içeriği ve kullanım hakları size aittir. Lisanslı ölçekleri yalnızca kullanım izniniz varsa ekleyin.
        </p>
        {error && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Vazgeç</Button>
          <Button onClick={save}>Kaydet</Button>
        </div>
      </div>

      {pasting && (
        <PasteQuestions
          onClose={() => setPasting(false)}
          onAdd={(lines) => {
            const added = lines.map((text) => ({ id: newQuestionId(), text, kind: "scale" as const }));
            // Tek boş başlangıç sorusu varsa onun yerine geçer.
            const keep = questions.filter((q) => q.text.trim() !== "");
            setQuestions([...keep, ...added]);
            setPasting(false);
          }}
        />
      )}
    </Modal>
  );
}

function IconBtn({ label, onClick, disabled, danger, children }: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`rounded-md p-2 text-faint hover:bg-card disabled:opacity-30 ${danger ? "hover:text-danger" : "hover:text-ink"}`}
    >
      {children}
    </button>
  );
}

function PasteQuestions({ onClose, onAdd }: { onClose: () => void; onAdd: (lines: string[]) => void }) {
  const [text, setText] = useState("");
  // Baştaki "1." "2)" "- " gibi numaralandırmalar temizlenir.
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(\d+[.)-]|[-•*])\s*/, "").trim())
    .filter(Boolean);
  return (
    <Modal title="Soruları toplu yapıştır" onClose={onClose} width="max-w-2xl">
      <p className="mb-3 text-sm text-muted">Her satır bir soru olur. Baştaki numaralar otomatik silinir; sorular ölçekli olarak eklenir.</p>
      <textarea className={`${inputCls} h-60`} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
      <div className="mt-4 flex items-center justify-between">
        <span className="text-xs text-muted">{lines.length} soru</span>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>Vazgeç</Button>
          <Button onClick={() => onAdd(lines)} disabled={lines.length === 0}>Ekle</Button>
        </div>
      </div>
    </Modal>
  );
}
