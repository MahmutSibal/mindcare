// PDF sayfalarını görsele çevirir (pdf.js). Terapist ve danışan aynı sayfayı aynı oranla çizer; ortak çizim
// bu görselin üzerine yapılır. pdf.js yalnızca ilk PDF açıldığında yüklenir (sayfa başlangıcı yavaşlamasın).

import type { PDFDocumentProxy } from "pdfjs-dist";

export interface PdfPageImage {
  /** Sayfanın PNG görseli (blob adresi). Kullanılmayınca `URL.revokeObjectURL` ile serbest bırakılır. */
  url: string;
  /** Genişlik / yükseklik. */
  aspect: number;
}

export interface PdfDoc {
  pages: number;
  render: (page: number) => Promise<PdfPageImage>;
  destroy: () => void;
}

const MAX_PAGES = 500;
// En/boy oranı sınırları: aşırı uzun/geniş sayfalar tuvali kullanılmaz hale getirmesin.
const MIN_ASPECT = 0.4;
const MAX_ASPECT = 2.5;

let lib: Promise<typeof import("pdfjs-dist")> | null = null;
async function pdfjs() {
  if (!lib) {
    lib = (async () => {
      const m = await import("pdfjs-dist");
      const worker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
      m.GlobalWorkerOptions.workerSrc = worker;
      return m;
    })();
  }
  return lib;
}

/** Baytlardan PDF açar. Bozuk ya da çok büyük belgelerde hata fırlatır. */
export async function openPdf(bytes: Uint8Array): Promise<PdfDoc> {
  const m = await pdfjs();
  // pdf.js veriyi devralır; çağıranın kopyası bozulmasın diye kopya verilir.
  const task = m.getDocument({ data: bytes.slice(), useSystemFonts: true });
  const doc: PDFDocumentProxy = await task.promise;
  if (doc.numPages > MAX_PAGES) {
    void task.destroy();
    throw new Error(`PDF çok uzun (en fazla ${MAX_PAGES} sayfa).`);
  }
  return {
    pages: doc.numPages,
    async render(n) {
      const page = await doc.getPage(Math.min(Math.max(1, n), doc.numPages));
      const base = page.getViewport({ scale: 1 });
      const aspect = Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, base.width / base.height));
      // Uzun kenar ~1600 px: net okunur, aktarım ve bellek makul.
      const scale = 1600 / Math.max(base.width, base.height);
      const vp = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(vp.width);
      canvas.height = Math.round(vp.height);
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise;
      const blob: Blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("Sayfa görsele çevrilemedi"))), "image/png"));
      return { url: URL.createObjectURL(blob), aspect };
    },
    destroy: () => void task.destroy(),
  };
}
