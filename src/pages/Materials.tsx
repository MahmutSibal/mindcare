import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { ExternalLink, FilePlus2, Link2, Quote, Trash2 } from "lucide-react";
import { httpsUrl, isWebLink, parseYouTube } from "../lib/share";
import { api, errorText, type Material, type MaterialCategory, type Patient } from "../lib/api";
import { takeNewItemOwner } from "../lib/scope";
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

const isAndroid = /Android/i.test(navigator.userAgent);

export default function Materials() {
  const version = useDataVersion();
  const [list, setList] = useState<Material[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  // Danışan profilinden gelindiyse o danışan seçili açılır; yeni eklenenler de ona özel olur.
  const [filter, setFilter] = useState<string>(() => takeNewItemOwner() ?? "all");
  const owner = filter !== "all" && filter !== "general" ? filter : "";
  const nameOf = (id: string) => patients.find((p) => p.id === id)?.full_name ?? "Danışan";
  const [draft, setDraft] = useState<{ title: string; category: MaterialCategory; file_path: string; description: string; patient_id: string; bytes?: Uint8Array } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"file" | "quote" | "link">("file");

  useEffect(() => {
    api.listMaterials().then(setList);
    api.listPatients().then(setPatients).catch(() => {});
  }, [version]);

  const shown = list.filter((m) => (filter === "all" ? true : filter === "general" ? !m.patient_id : m.patient_id === filter));

  // Telefonda sistemin dosya seçicisi: dosya yolu yoktur, içerik doğrudan okunup veritabanına kaydedilir.
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setError(null);
    if (f.type.startsWith("video/")) {
      setError("Videolar telefona eklenemez (çok büyük). YouTube bağlantısı olarak ekleyin.");
      return;
    }
    if (f.size > 25 * 1024 * 1024) {
      setError("Dosya 25 MB'tan büyük. Büyük dosyaları ekran paylaşımıyla gösterin.");
      return;
    }
    const bytes = new Uint8Array(await f.arrayBuffer());
    setMode("file");
    setDraft({
      title: f.name.replace(/\.[^.]+$/, ""),
      category: f.type.startsWith("image/") ? "image" : "document",
      file_path: f.name,
      description: "",
      patient_id: owner,
      bytes,
    });
  };

  const pick = async () => {
    if (isAndroid) {
      fileInput.current?.click();
      return;
    }
    const path = await open({ multiple: false, directory: false, title: "Materyal seçin" });
    if (typeof path !== "string") return;
    const name = path.split(/[\\/]/).pop() ?? "";
    setMode("file");
    setDraft({ title: name.replace(/\.[^.]+$/, ""), category: guessCategory(path), file_path: path, description: "", patient_id: owner });
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    setError(null);
    let input = draft;
    if (mode === "link") {
      const url = httpsUrl(draft.file_path);
      if (!url) {
        setError("Geçerli bir bağlantı girin (https:// ile başlamalı).");
        return;
      }
      input = { ...draft, file_path: url, category: parseYouTube(url) ? "video" : "document" };
    }
    try {
      if (input.bytes && (input.category === "image" || input.category === "document")) {
        await api.addMaterialFile(
          { title: input.title, name: input.file_path, category: input.category, description: input.description, patient_id: input.patient_id },
          input.bytes,
        );
      } else {
        await api.createMaterial(input);
      }
      setDraft(null);
      notifyDataChanged();
    } catch (err) {
      setError(errorText(err));
    }
  };

  const openFile = async (m: Material) => {
    setError(null);
    try {
      await api.openMaterial(m.id);
    } catch {
      setError(`Dosya açılamadı: ${m.file_path}`);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-4 md:p-8">
      <input
        ref={fileInput}
        type="file"
        className="hidden"
        accept="image/*,application/pdf,.pdf,.txt,.doc,.docx,.ppt,.pptx,.xls,.xlsx"
        onChange={(e) => void onFile(e)}
      />
      <PageHeader title="Materyaller" subtitle="Seanslarda kullandığınız dosyalar. Dosyalar yerinde kalır; burada yalnızca kayıtları tutulur.">
        <Button variant="subtle" onClick={() => { setMode("link"); setDraft({ title: "", category: "video", file_path: "", description: "", patient_id: owner }); }}>
          <Link2 size={16} /> Bağlantı Ekle
        </Button>
        <Button variant="subtle" onClick={() => { setMode("quote"); setDraft({ title: "", category: "quote", file_path: "", description: "", patient_id: owner }); }}>
          <Quote size={16} /> Alıntı Yaz
        </Button>
        <Button onClick={pick}><FilePlus2 size={16} /> Materyal Ekle</Button>
      </PageHeader>
      <p className="-mt-2 mb-4 text-xs text-faint">
        Görüşmede "Göster" ile: görsel ve belgeler (en fazla 25 MB) danışana gönderilir, videolar bu bilgisayarda oynatılıp
        sesiyle yayınlanır (MP4 veya WebM önerilir), alıntılar metin olarak görünür. YouTube bağlantıları danışanın ekranında
        doğrudan oynatılır.
      </p>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label htmlFor="materyal-filtre" className="text-xs text-muted">Göster:</label>
        <select id="materyal-filtre" className={`${inputCls} max-w-xs`} value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">Tümü</option>
          <option value="general">Genel kütüphane (herkes için)</option>
          {patients.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
        </select>
        {owner && <span className="text-xs text-faint">Eklediğiniz yeni materyaller yalnızca {nameOf(owner)} için olur.</span>}
      </div>
      {error && <p className="mb-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
      {shown.length === 0 ? (
        <Empty text={filter === "all" ? "Henüz materyal eklenmedi." : "Bu görünümde materyal yok."} />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,260px),1fr))] gap-3">
          {shown.map((m) => (
            <div key={m.id} className="flex flex-col rounded-xl border border-line bg-panel p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                  <CategoryIcon c={m.category} />
                </div>
                <div className="min-w-0">
                  <div className="truncate font-medium">{m.title}</div>
                  <div className="text-xs text-muted">
                    {isWebLink(m.file_path) ? (parseYouTube(m.file_path) ? "YouTube videosu" : "Bağlantı") : CATEGORY_LABEL[m.category]} • {fmtDate(m.created_at, true)} • {m.patient_id ? nameOf(m.patient_id) : "Genel"}{!m.available && " • dosya bu cihazda yok"}
                  </div>
                </div>
              </div>
              {m.description && <p className="mt-3 line-clamp-2 text-sm text-muted">{m.description}</p>}
              {m.file_path && <p className="mt-2 truncate text-xs text-faint" title={m.file_path}>{m.file_path}</p>}
              <div className="mt-3 flex justify-end gap-1">
                {m.file_path && !isWebLink(m.file_path) && (
                  <Button variant="ghost" className="px-2 py-1.5 text-xs" onClick={() => openFile(m)}><ExternalLink size={14} /> Aç</Button>
                )}
                <Button variant="ghost" className="px-2 py-1.5 text-xs hover:text-danger" onClick={async () => { await api.deleteMaterial(m.id); notifyDataChanged(); }}>
                  <Trash2 size={14} /> Kaldır
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {draft && (
        <Modal title={mode === "link" ? "Bağlantı Ekle" : mode === "quote" ? "Alıntı Yaz" : "Materyal Ekle"} onClose={() => setDraft(null)}>
          <form onSubmit={save} className="space-y-4">
            <Field label="Başlık">
              <input className={inputCls} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} required autoFocus />
            </Field>
            <Field label="Kimin için?" hint="Danışana özel materyal yalnızca o danışanın profilinde görünür.">
              <select className={inputCls} value={draft.patient_id} onChange={(e) => setDraft({ ...draft, patient_id: e.target.value })}>
                <option value="">Genel (herkes için)</option>
                {patients.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </select>
            </Field>
            {mode === "link" && (
              <Field label="Bağlantı" hint="YouTube bağlantısı danışanın ekranında oynatılır. Belirli bir yerden başlatmak için YouTube'da Paylaş → 'Başlangıç zamanı' ile kopyalayın.">
                <input
                  className={inputCls}
                  value={draft.file_path}
                  onChange={(e) => setDraft({ ...draft, file_path: e.target.value })}
                  placeholder="https://www.youtube.com/watch?v=…"
                  inputMode="url"
                  required
                />
              </Field>
            )}
            {mode === "file" && (
              <Field label="Kategori">
                <select className={inputCls} value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value as MaterialCategory })}>
                  {(Object.keys(CATEGORY_LABEL) as MaterialCategory[]).map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
                </select>
              </Field>
            )}
            <Field
              label={draft.category === "quote" ? "Alıntı metni" : "Açıklama"}
              hint={draft.category === "quote" ? "Danışanın ekranında bu metin gösterilir." : undefined}
            >
              <textarea
                className={inputCls}
                rows={draft.category === "quote" ? 5 : 3}
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                required={mode === "quote"}
              />
            </Field>
            {mode === "file" && <p className="truncate text-xs text-faint">{draft.file_path}</p>}
            {mode === "link" && draft.file_path.trim() && (
              <p className="text-xs text-muted">
                {parseYouTube(draft.file_path)
                  ? `YouTube videosu tanındı${parseYouTube(draft.file_path)!.start ? ` • ${parseYouTube(draft.file_path)!.start}. saniyeden başlar` : ""}.`
                  : "YouTube bağlantısı değil: danışana 'Bağlantıyı aç' düğmesi olarak gösterilir."}
              </p>
            )}
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
