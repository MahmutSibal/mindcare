import { useEffect } from "react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extensions";
import { Bold, Heading2, Italic, Link2, List, ListOrdered, Quote, Redo2, Underline, Undo2 } from "lucide-react";
import { cx } from "./ui";

export function useNotesEditor(opts: { content: string; editable: boolean; placeholder?: string; onChange?: (html: string) => void }) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2] }, link: { openOnClick: false, autolink: true } }),
      Placeholder.configure({ placeholder: opts.placeholder ?? "" }),
    ],
    content: opts.content,
    editable: opts.editable,
    onUpdate: ({ editor }) => opts.onChange?.(editor.getHTML()),
  });
  useEffect(() => {
    editor?.setEditable(opts.editable);
  }, [editor, opts.editable]);
  return editor;
}

type Ed = ReturnType<typeof useNotesEditor>;

const section = (title: string) => `<h2>${title}</h2><p></p>`;
/** Hazır not iskeletleri; imlecin olduğu yere eklenir. */
export const NOTE_TEMPLATES: { id: string; label: string; html: string }[] = [
  { id: "soap", label: "SOAP (Öznel-Nesnel-Değerlendirme-Plan)", html: section("Öznel (S)") + section("Nesnel (O)") + section("Değerlendirme (A)") + section("Plan (P)") },
  { id: "dap", label: "DAP (Veri-Değerlendirme-Plan)", html: section("Veri (D)") + section("Değerlendirme (A)") + section("Plan (P)") },
  { id: "birp", label: "BIRP (Davranış-Müdahale-Yanıt-Plan)", html: section("Davranış (B)") + section("Müdahale (I)") + section("Yanıt (R)") + section("Plan (P)") },
  { id: "risk", label: "Risk değerlendirmesi", html: section("Kendine zarar düşüncesi") + section("Koruyucu etkenler") + section("Güvenlik planı / yapılanlar") },
];

export function Toolbar({ editor }: { editor: Ed }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e?.isActive("bold"),
      italic: e?.isActive("italic"),
      underline: e?.isActive("underline"),
      link: e?.isActive("link"),
      bullet: e?.isActive("bulletList"),
      ordered: e?.isActive("orderedList"),
      h2: e?.isActive("heading", { level: 2 }),
      quote: e?.isActive("blockquote"),
      editable: e?.isEditable,
    }),
  });
  if (!editor) return null;
  const c = () => editor.chain().focus();
  const setLink = () => {
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Bağlantı adresi", prev ?? "https://");
    if (url === null) return;
    if (url === "") c().unsetLink().run();
    else c().extendMarkRange("link").setLink({ href: url }).run();
  };
  const btn = (active: boolean | undefined, onClick: () => void, Icon: typeof Bold, label: string) => (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={!s?.editable}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cx(
        "rounded-md p-1.5 transition-colors disabled:opacity-30",
        active ? "bg-accent-soft text-accent" : "text-muted hover:bg-card hover:text-ink",
      )}
    >
      <Icon size={17} />
    </button>
  );
  return (
    <div className="flex flex-wrap items-center gap-0.5">
      {btn(s?.bold, () => c().toggleBold().run(), Bold, "Kalın")}
      {btn(s?.italic, () => c().toggleItalic().run(), Italic, "İtalik")}
      {btn(s?.underline, () => c().toggleUnderline().run(), Underline, "Altı çizili")}
      {btn(s?.link, setLink, Link2, "Bağlantı")}
      <span className="mx-1 h-5 w-px bg-line" />
      {btn(s?.h2, () => c().toggleHeading({ level: 2 }).run(), Heading2, "Başlık")}
      {btn(s?.bullet, () => c().toggleBulletList().run(), List, "Madde listesi")}
      {btn(s?.ordered, () => c().toggleOrderedList().run(), ListOrdered, "Numaralı liste")}
      {btn(s?.quote, () => c().toggleBlockquote().run(), Quote, "Alıntı")}
      <span className="mx-1 h-5 w-px bg-line" />
      {btn(false, () => c().undo().run(), Undo2, "Geri al")}
      {btn(false, () => c().redo().run(), Redo2, "Yinele")}
      <span className="mx-1 h-5 w-px bg-line" />
      <select
        aria-label="Not şablonu"
        title="Not şablonu ekle"
        disabled={!s?.editable}
        value=""
        onChange={(e) => {
          const t = NOTE_TEMPLATES.find((x) => x.id === e.target.value);
          if (t) c().insertContent(t.html).run();
        }}
        className="rounded-md border border-line bg-bg px-1.5 py-1 text-xs text-muted disabled:opacity-30"
      >
        <option value="">Şablon…</option>
        {NOTE_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
      </select>
    </div>
  );
}

/** Kayıtlı notu salt okunur gösterir. HTML, TipTap şemasından geçirildiği için güvenlidir. */
export function NoteViewer({ html }: { html: string }) {
  const editor = useNotesEditor({ content: html, editable: false });
  return <EditorContent editor={editor} className="text-ink" />;
}

export { EditorContent };
