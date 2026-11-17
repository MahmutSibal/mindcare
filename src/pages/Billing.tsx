import { useEffect, useState } from "react";
import { FileDown, Plus, Trash2 } from "lucide-react";
import { save } from "@tauri-apps/plugin-dialog";
import { api, errorText, type BillingRow, type LedgerEntry } from "../lib/api";
import { fmtDate } from "../lib/format";
import { notifyDataChanged, useDataVersion } from "../lib/session";
import PageHeader, { Table } from "../components/PageHeader";
import { Badge, Button, Empty, Field, inputCls, Modal } from "../components/ui";
import { BRAND_NAME } from "../lib/brand";

export const tl = (cents: number) =>
  (cents / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " TL";

/** "1.250,50" ya da "1250.5" gibi girdiyi kuruşa çevirir; geçersizse null. */
export function parseTl(input: string): number | null {
  const t = input.trim().replace(/\s/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const cents = Math.round(parseFloat(t) * 100);
  return cents > 0 ? cents : null;
}

const today = () => new Date().toISOString().slice(0, 10);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export default function Billing() {
  const version = useDataVersion();
  const [rows, setRows] = useState<BillingRow[]>([]);
  const [open, setOpen] = useState<BillingRow | null>(null);

  useEffect(() => {
    api.billingSummary().then(setRows);
  }, [version]);

  const owed = rows.reduce((t, r) => t + Math.max(0, r.charged_cents - r.paid_cents), 0);

  return (
    <div className="h-full overflow-y-auto p-4 md:p-8">
      <PageHeader title="Ücretler" subtitle={owed > 0 ? `Toplam alacak: ${tl(owed)}` : "Ücret ve ödeme takibi"} />
      {rows.length === 0 ? (
        <Empty text="Henüz danışan yok." />
      ) : (
        <Table head={["Danışan", "Seans ücreti", "Toplam borç", "Ödenen", "Bakiye", ""]}>
          {rows.map((r) => {
            const bal = r.charged_cents - r.paid_cents;
            return (
              <tr key={r.patient_id} className="cursor-pointer hover:bg-card/50" onClick={() => setOpen(r)}>
                <td className="px-4 py-3 font-medium">{r.patient_name}</td>
                <td className="px-4 py-3 text-muted">{r.session_fee_cents ? tl(r.session_fee_cents) : "—"}</td>
                <td className="px-4 py-3 tabular-nums">{tl(r.charged_cents)}</td>
                <td className="px-4 py-3 tabular-nums">{tl(r.paid_cents)}</td>
                <td className="px-4 py-3">
                  {bal > 0 ? <Badge tone="warn">{tl(bal)} borç</Badge> : bal < 0 ? <Badge tone="accent">{tl(-bal)} fazla</Badge> : <Badge tone="ok">Ödendi</Badge>}
                </td>
                <td className="px-4 py-3 text-right text-xs text-accent">Aç</td>
              </tr>
            );
          })}
        </Table>
      )}
      {open && <LedgerDialog row={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function LedgerDialog({ row, onClose }: { row: BillingRow; onClose: () => void }) {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [fee, setFee] = useState(row.session_fee_cents ? String(row.session_fee_cents / 100).replace(".", ",") : "");
  const [kind, setKind] = useState<"charge" | "payment">("payment");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today());
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = () => api.listLedger(row.patient_id).then(setEntries);
  useEffect(() => {
    void load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const saveFee = async () => {
    const cents = fee.trim() ? parseTl(fee) : null;
    if (fee.trim() && cents === null) return setError("Ücret geçersiz.");
    try {
      await api.setPatientFee(row.patient_id, cents);
      setError(null);
      notifyDataChanged();
    } catch (e) {
      setError(errorText(e));
    }
  };

  const add = async (k: "charge" | "payment", cents: number | null, n?: string) => {
    if (cents === null) return setError("Tutar geçersiz.");
    try {
      await api.addLedgerEntry({ patient_id: row.patient_id, kind: k, amount_cents: cents, entry_date: date, note: n });
      setError(null);
      setAmount("");
      setNote("");
      await load();
      notifyDataChanged();
    } catch (e) {
      setError(errorText(e));
    }
  };

  const feeCents = fee.trim() ? parseTl(fee) : null;
  const charged = entries.filter((e) => e.kind === "charge").reduce((t, e) => t + e.amount_cents, 0);
  const paid = entries.filter((e) => e.kind === "payment").reduce((t, e) => t + e.amount_cents, 0);

  const receipt = async (e: LedgerEntry) => {
    const dest = await save({ defaultPath: `makbuz-${e.entry_date}.html`, filters: [{ name: "Makbuz (HTML)", extensions: ["html"] }] });
    if (!dest) return;
    const html = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>Makbuz</title>
<style>body{font:15px/1.6 system-ui,sans-serif;max-width:560px;margin:3rem auto;padding:0 1rem}h1{font-size:1.3rem}table{width:100%;border-collapse:collapse}td{padding:6px 0;border-bottom:1px solid #ddd}</style></head><body>
<h1>${esc(BRAND_NAME)} – Ödeme Makbuzu</h1>
<table><tr><td>Tarih</td><td>${esc(fmtDate(e.entry_date))}</td></tr>
<tr><td>Danışan</td><td>${esc(row.patient_name)}</td></tr>
<tr><td>Tutar</td><td><b>${esc(tl(e.amount_cents))}</b></td></tr>
${e.note ? `<tr><td>Açıklama</td><td>${esc(e.note)}</td></tr>` : ""}</table>
<p style="margin-top:2rem;color:#666;font-size:13px">Bu belge bilgilendirme amaçlıdır; resmî fatura veya serbest meslek makbuzu yerine geçmez.</p></body></html>`;
    try {
      await api.saveTextFile(dest, html);
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <Modal title={row.patient_name} onClose={onClose} width="max-w-2xl">
      <div className="space-y-5">
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Seans ücreti (TL)">
            <input className={inputCls + " w-36"} value={fee} onChange={(e) => setFee(e.target.value)} placeholder="1500" inputMode="decimal" />
          </Field>
          <Button variant="subtle" onClick={() => void saveFee()}>Kaydet</Button>
          <Button variant="outline" disabled={!feeCents} onClick={() => void add("charge", feeCents, "Seans ücreti")}>
            <Plus size={16} /> Bu tarihe seans ücreti yaz
          </Button>
        </div>

        <div className="rounded-lg border border-line p-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <Field label="Tür">
              <select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value as "charge" | "payment")}>
                <option value="payment">Ödeme alındı</option>
                <option value="charge">Borç ekle</option>
              </select>
            </Field>
            <Field label="Tutar (TL)"><input className={inputCls} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" /></Field>
            <Field label="Tarih"><input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="Not"><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} /></Field>
          </div>
          <div className="mt-3 flex justify-end">
            <Button onClick={() => void add(kind, parseTl(amount), note)} disabled={!amount.trim()}>Ekle</Button>
          </div>
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}

        <p className="text-sm text-muted">Borç {tl(charged)} · Ödenen {tl(paid)} · Bakiye <b className="text-ink">{tl(charged - paid)}</b></p>

        {entries.length === 0 ? (
          <p className="text-sm text-faint">Henüz kayıt yok.</p>
        ) : (
          <ul className="max-h-64 divide-y divide-line overflow-y-auto rounded-lg border border-line text-sm">
            {entries.map((e) => (
              <li key={e.id} className="flex items-center gap-3 px-3 py-2">
                <span className="w-24 shrink-0 text-muted">{fmtDate(e.entry_date)}</span>
                <Badge tone={e.kind === "payment" ? "ok" : "warn"}>{e.kind === "payment" ? "Ödeme" : "Borç"}</Badge>
                <span className="tabular-nums">{tl(e.amount_cents)}</span>
                <span className="min-w-0 flex-1 truncate text-faint">{e.note}</span>
                {e.kind === "payment" && (
                  <Button variant="ghost" className="p-1.5" title="Makbuz oluştur" onClick={() => void receipt(e)}><FileDown size={15} /></Button>
                )}
                <Button variant="ghost" className="p-1.5 hover:text-danger" title="Sil" onClick={async () => { await api.deleteLedgerEntry(e.id); await load(); notifyDataChanged(); }}>
                  <Trash2 size={15} />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
