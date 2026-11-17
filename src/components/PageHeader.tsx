import { type ReactNode, useId } from "react";

export default function PageHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: ReactNode }) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3 md:gap-4">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {children && <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">{children}</div>}
    </header>
  );
}

/**
 * Tablo: geniş ekranda klasik tablo, dar ekranda (< md) her satır bir kart olur; sütun adları hücrelerin
 * önüne yazılır. Başlığı boş sütun (işlem düğmeleri) etiketsiz ve sağa yaslı gösterilir.
 */
export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  const id = "tbl" + useId().replace(/[^a-zA-Z0-9]/g, "");
  const labels = head
    .map((h, i) => (h ? `#${id} td:nth-child(${i + 1})::before{content:${JSON.stringify(h)}}` : `#${id} td:nth-child(${i + 1}){justify-content:flex-end}`))
    .join(" ");
  return (
    <div id={id} className="overflow-x-auto rounded-xl border border-line bg-panel max-md:overflow-visible max-md:border-0 max-md:bg-transparent">
      <style>{`@media (max-width: 767px){
#${id} table,#${id} tbody{display:block}
#${id} thead{display:none}
#${id} tr{display:block;margin-bottom:.625rem;border:1px solid var(--color-line);border-radius:.875rem;background:var(--color-panel);padding:.375rem .25rem}
#${id} td{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:.4rem .75rem!important;text-align:right}
#${id} td::before{color:var(--color-muted);font-size:.75rem;text-align:left;flex-shrink:0}
${labels}
}`}</style>
      <table className="w-full text-sm">
        <thead className="bg-card/60 text-left text-[13px] text-muted">
          <tr>{head.map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-line max-md:divide-y-0">{children}</tbody>
      </table>
    </div>
  );
}
