import { useEffect, useState } from "react";
import { api, type Session, type SessionStatus } from "../lib/api";
import { fmtDate, fmtTime, minutes } from "../lib/format";
import { useDataVersion } from "../lib/session";
import PageHeader, { Table } from "../components/PageHeader";
import { Badge, Empty } from "../components/ui";

const STATUS: Record<SessionStatus, { label: string; tone: "accent" | "ok" | "muted" | "warn" }> = {
  planned: { label: "Planlandı", tone: "muted" },
  in_progress: { label: "Sürüyor", tone: "accent" },
  completed: { label: "Tamamlandı", tone: "ok" },
  cancelled: { label: "İptal", tone: "warn" },
};

export default function Sessions({ onOpenPatient }: { onOpenPatient: (id: string) => void }) {
  const version = useDataVersion();
  const [list, setList] = useState<Session[]>([]);
  useEffect(() => {
    api.listSessions().then(setList);
  }, [version]);

  const total = list.filter((s) => s.status === "completed").reduce((a, s) => a + s.duration_seconds, 0);

  return (
    <div className="h-full overflow-y-auto p-8">
      <PageHeader
        title="Seanslar"
        subtitle={`${list.filter((s) => s.status === "completed").length} tamamlanmış seans • toplam ${Math.round(total / 3600)} saat`}
      />
      {list.length === 0 ? (
        <Empty text="Henüz seans kaydı yok. Ana Sayfa'dan seans başlatabilirsiniz." />
      ) : (
        <Table head={["Tarih", "Saat", "Danışan", "No", "Süre", "Durum"]}>
          {list.map((s) => (
            <tr key={s.id} className="cursor-pointer hover:bg-card/50" onClick={() => onOpenPatient(s.patient_id)}>
              <td className="px-4 py-3">{fmtDate(s.session_date)}</td>
              <td className="px-4 py-3 tabular-nums text-muted">{fmtTime(s.session_date)}</td>
              <td className="px-4 py-3 font-medium">{s.patient_name}</td>
              <td className="px-4 py-3">{s.session_number}. Seans</td>
              <td className="px-4 py-3 text-muted">{minutes(s.duration_seconds)}</td>
              <td className="px-4 py-3"><Badge tone={STATUS[s.status].tone}>{STATUS[s.status].label}</Badge></td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
