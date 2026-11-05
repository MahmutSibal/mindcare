import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import { ExternalLink, FilePlus2, Trash2 } from "lucide-react";
import { api, errorText, type Material, type MaterialCategory } from "../lib/api";
import { fmtDate } from "../lib/format";
import { notifyDataChanged, useDataVersion } from "../lib/session";
import PageHeader from "../components/PageHeader";
import { CATEGORY_LABEL, CategoryIcon } from "../components/category";
import { Button, Empty, Field, inputCls, Modal } from "../components/ui";

function guessCategory(path: string): MaterialCategory {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (["mp4", "mov", "webm", "mkv", "avi"].includes(ext)) return "video";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return "image";
  return "document";
}

export default function Materials() {
  const version = useDataVersion();
  const [list, setList] = useState<Material[]>([]);
  const [draft, setDraft] = useState<{ title: string; category: MaterialCategory; file_path: string; description: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listMaterials().then(setList);
  }, [version]);

  const pick = async () => {
    const path = await open({ multiple: false, directory: false, title: "Materyal seçin" });
    if (typeof path !== "string") return;
    const name = path.split(/[\\/]/).pop() ?? "";
    setDraft({ title: name.replace(/\.[^.]+$/, ""), category: guessCategory(path), file_path: path, description: "" });
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    try {
      await api.createMaterial(draft);
      setDraft(null);
      notifyDataChanged();
    } catch (err) {
      setError(errorText(err));
    }
  };

  const openFile = async (m: Material) => {
    setError(null);
    try {
      await openPath(m.file_path);
    } catch {
      setError(`Dosya açılamadı: ${m.file_path}`);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-8">
      <PageHeader title="Materyaller" subtitle="Seanslarda kullandığınız dosyalar. Dosyalar yerinde kalır; burada yalnızca kayıtları tutulur.">
        <Button onClick={pick}><FilePlus2 size={16} /> Materyal Ekle</Button>
      </PageHeader>
      {error && <p className="mb-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
      {list.length === 0 ? (
        <Empty text="Henüz materyal eklenmedi." />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
          {list.map((m) => (
            <div key={m.id} className="flex flex-col rounded-xl border border-line bg-panel p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                  <CategoryIcon c={m.category} />
                </div>
                <div className="min-w-0">
                  <div className="truncate font-medium">{m.title}</div>
                  <div className="text-xs text-muted">{CATEGORY_LABEL[m.category]} • {fmtDate(m.created_at, true)}</div>
                </div>
              </div>
              {m.description && <p className="mt-3 line-clamp-2 text-sm text-muted">{m.description}</p>}
              <p className="mt-2 truncate text-xs text-faint" title={m.file_path}>{m.file_path}</p>
              <div className="mt-3 flex justify-end gap-1">
                <Button variant="ghost" className="px-2 py-1.5 text-xs" onClick={() => openFile(m)}><ExternalLink size={14} /> Aç</Button>
                <Button variant="ghost" className="px-2 py-1.5 text-xs hover:text-danger" onClick={async () => { await api.deleteMaterial(m.id); notifyDataChanged(); }}>
                  <Trash2 size={14} /> Kaldır
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {draft && (
        <Modal title="Materyal Ekle" onClose={() => setDraft(null)}>
          <form onSubmit={save} className="space-y-4">
            <Field label="Başlık">
              <input className={inputCls} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} required autoFocus />
            </Field>
            <Field label="Kategori">
              <select className={inputCls} value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value as MaterialCategory })}>
                {(Object.keys(CATEGORY_LABEL) as MaterialCategory[]).map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
              </select>
            </Field>
            <Field label="Açıklama">
              <textarea className={inputCls} rows={3} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
            </Field>
            <p className="truncate text-xs text-faint">{draft.file_path}</p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setDraft(null)}>Vazgeç</Button>
              <Button type="submit">Ekle</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
