export {};
// GEÇİCİ: telefon düzeni önizlemesi (sahte verilerle). Commit edilmez.
const patients = [
  { id: "p1", full_name: "Ayşe Yılmaz", birth_date: "1991-04-12", phone: "0532 000 00 00", email: null, status: "active", created_at: "2026-09-01", completed_sessions: 6, last_session_date: "2026-11-06", next_appointment: "2026-11-20T10:00", emergency_contact: "Eşi", emergency_phone: "0533 000 00 00", risk_note: null, consent_at: "2026-11-01", intake_reason: "Kaygı ve uyku sorunu, 3 aydır." },
  { id: "p2", full_name: "Burak Demir", birth_date: "1985-08-30", phone: null, email: null, status: "active", created_at: "2026-10-01", completed_sessions: 2, last_session_date: "2026-11-09", next_appointment: null, emergency_contact: null, emergency_phone: null, risk_note: null, consent_at: null, intake_reason: null },
];
const w = window as any;
w.__TAURI_INTERNALS__ = {
  transformCallback: () => 1,
  invoke: async (cmd: string, args: any) => {
    switch (cmd) {
      case "app_status": return { ready: true, error: null, cipher_version: "4", db_path: "" };
      case "get_settings": return { therapist_name: "Said", therapist_title: "Klinik Psikolog", recovery_key_confirmed_at: "2026-11-01", gemini_api_key_set: "1", patient_app_url: "https://mindcare-gorusme.onrender.com", invite_ttl_minutes: "30" };
      case "list_patients": return patients;
      case "get_patient": return patients.find((p) => p.id === args.id) ?? patients[0];
      case "list_groups": return [{ id: "g1", name: "Kaygı grubu", description: "Perşembe 19:00", status: "active", member_count: 5, session_count: 3 }];
      case "list_appointments": return [{ id: "a1", patient_id: "p1", patient_name: "Ayşe Yılmaz", appointment_date: "2026-11-20T10:00", duration_minutes: 50, status: "scheduled" }];
      case "list_sessions": return [{ id: "s1", patient_id: "p1", patient_name: "Ayşe Yılmaz", session_number: 6, session_date: "2026-11-06", duration_seconds: 2900, status: "completed" }];
      case "get_active_session": case "active_session": return null;
      default:
        if (cmd.startsWith("list_")) return [];
        return null;
    }
  },
};
await import("./main");
