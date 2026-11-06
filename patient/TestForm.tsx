// Danışan tarafı: terapistin gönderdiği testi doldurma formu.
// Cevaplar yalnızca şifreli görüşme veri kanalıyla terapiste gider; burada saklanmaz.

import { useState } from "react";
import { CheckCircle2, ClipboardList } from "lucide-react";
import type { ChannelMessage } from "../src/lib/rtc";
import { MAX_TEXT_ANSWER, unansweredCount, type Answers } from "../src/lib/tests";
import { Button, cx } from "../src/components/ui";

type TestMessage = Extract<ChannelMessage, { type: "test" }>;

export default function TestForm({ test, onSubmit, onDone }: {
  test: TestMessage;
  /** Cevapları gönderir; bağlantı yoksa `false` döner. */
  onSubmit: (answers: Answers) => boolean;
  onDone: () => void;
}) {
  const { definition: def } = test;
  const [answers, setAnswers] = useState<Answers>({});
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const missing = unansweredCount(def, answers);
  const scaleCount = def.questions.filter((q) => q.kind === "scale").length;

  const submit = () => {
    setError(null);
    if (!onSubmit(answers)) {
      setError("Bağlantı şu an kurulu değil. Birkaç saniye sonra tekrar deneyin.");
      return;
    }
    setSent(true);
    setTimeout(onDone, 2500);
  };

  if (sent) {
    return (
      <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-bg/95 p-6 text-center">
        <CheckCircle2 size={44} className="text-ok" />
        <p className="text-lg font-medium">Teşekkürler</p>
        <p className="text-sm text-muted">Cevaplarınız terapistinize iletildi.</p>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 z-20 overflow-y-auto bg-bg/95">
      <div className="mx-auto max-w-xl p-4 pb-28 sm:p-6">
        <div className="mb-1 flex items-center gap-2 text-accent">
          <ClipboardList size={20} />
          <span className="text-xs font-medium uppercase tracking-wide">Terapistiniz bir test gönderdi</span>
        </div>
        <h2 className="text-xl font-semibold">{test.title}</h2>
        {test.instructions && <p className="mt-2 text-sm leading-relaxed text-muted">{test.instructions}</p>}

        <ol className="mt-5 space-y-4">
          {def.questions.map((q, i) => (
            <li key={q.id} className="rounded-xl border border-line bg-panel p-4">
              <p className="mb-3 text-[15px] leading-snug">
                <span className="text-faint">{i + 1}. </span>{q.text}
              </p>
              {q.kind === "scale" ? (
                <div className="grid gap-2">
                  {def.options.map((o, oi) => {
                    const on = answers[q.id]?.option === oi;
                    return (
                      <button
                        key={oi}
                        onClick={() => setAnswers({ ...answers, [q.id]: { option: oi } })}
                        className={cx(
                          "rounded-lg border px-4 py-3 text-left text-sm transition-colors",
                          on ? "border-accent bg-accent-soft text-ink" : "border-line bg-card text-muted hover:text-ink",
                        )}
                        aria-pressed={on}
                      >
                        {o.label}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <textarea
                  className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                  rows={3}
                  maxLength={MAX_TEXT_ANSWER}
                  value={answers[q.id]?.text ?? ""}
                  onChange={(e) => setAnswers({ ...answers, [q.id]: { text: e.target.value } })}
                  placeholder="İsteğe bağlı"
                />
              )}
            </li>
          ))}
        </ol>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-panel/95 p-3 backdrop-blur">
        <div className="mx-auto flex max-w-xl items-center gap-3">
          <span className="flex-1 text-xs text-muted">
            {scaleCount > 0 && (missing > 0 ? `${scaleCount - missing} / ${scaleCount} cevaplandı` : "Tüm sorular cevaplandı")}
            {error && <span className="block text-danger">{error}</span>}
          </span>
          <Button className="px-6 py-2.5" onClick={submit} disabled={missing > 0}>Gönder</Button>
        </div>
      </div>
    </div>
  );
}
