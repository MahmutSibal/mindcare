import { ClipboardList, FileText, Film, Image as ImageIcon, Quote } from "lucide-react";
import type { MaterialCategory } from "../lib/api";

export const CATEGORY_LABEL: Record<MaterialCategory, string> = {
  video: "Video",
  image: "Görsel",
  quote: "Alıntı",
  test: "Test",
  document: "Doküman",
};

export function CategoryIcon({ c, size = 22 }: { c: MaterialCategory; size?: number }) {
  const I = { video: Film, image: ImageIcon, quote: Quote, test: ClipboardList, document: FileText }[c];
  return <I size={size} />;
}
