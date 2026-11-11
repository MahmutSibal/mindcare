import { invoke } from "@tauri-apps/api/core";

export type PatientStatus = "active" | "passive";

export interface Patient {
  id: string;
  full_name: string;
  birth_date: string | null;
  phone: string | null;
  email: string | null;
  status: PatientStatus;
  created_at: string;
  completed_sessions: number;
  last_session_date: string | null;
  next_appointment: string | null;
  /** Acil durumda aranacak kişi ve telefonu. */
  emergency_contact: string | null;
  emergency_phone: string | null;
  /** Terapistin risk notu (kendine zarar riski, kriz planı vb.). */
  risk_note: string | null;
  /** Danışanın çevrim içi görüşme onamını en son verdiği an (UTC). */
  consent_at: string | null;
}

export interface PatientInput {
  full_name: string;
  birth_date?: string | null;
  phone?: string | null;
  email?: string | null;
  status?: PatientStatus;
  emergency_contact?: string | null;
  emergency_phone?: string | null;
  risk_note?: string | null;
}

export type SessionStatus = "planned" | "in_progress" | "completed" | "cancelled";

export interface Session {
  id: string;
  patient_id: string;
  patient_name: string;
  session_number: number;
  session_date: string;
  duration_seconds: number;
  status: SessionStatus;
}

export interface Note {
  id: string;
  session_id: string;
  session_number: number;
  session_date: string;
  note_content: string;
  created_at: string;
  updated_at: string | null;
}

export type AppointmentStatus = "scheduled" | "completed" | "cancelled" | "no_show";

export interface Appointment {
  id: string;
  patient_id: string;
  patient_name: string;
  appointment_date: string;
  duration_minutes: number;
  status: AppointmentStatus;
}

export type MaterialCategory = "video" | "image" | "quote" | "test" | "document";

export interface Material {
  id: string;
  title: string;
  category: MaterialCategory;
  file_path: string;
  description: string | null;
  created_at: string;
}

export interface Test {
  id: string;
  title: string;
  instructions: string | null;
  definition_json: string;
  created_at: string;
  updated_at: string | null;
}

export interface TestResult {
  id: string;
  patient_id: string;
  session_id: string | null;
  session_number: number | null;
  test_id: string | null;
  test_title: string;
  definition_json: string;
  answers_json: string;
  total_score: number | null;
  completed_at: string;
}

export type HomeworkStatus = "assigned" | "done" | "partial" | "not_done";

export interface Homework {
  id: string;
  patient_id: string;
  session_id: string | null;
  session_number: number | null;
  title: string;
  description: string | null;
  due_date: string | null;
  status: HomeworkStatus;
  review_note: string | null;
  delivered_at: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface AppStatus {
  ready: boolean;
  error: string | null;
  cipher_version: string | null;
  db_path: string;
}

export const api = {
  appStatus: () => invoke<AppStatus>("app_status"),

  listPatients: () => invoke<Patient[]>("list_patients"),
  getPatient: (id: string) => invoke<Patient>("get_patient", { id }),
  createPatient: (input: PatientInput) => invoke<string>("create_patient", { input }),
  updatePatient: (id: string, input: PatientInput) => invoke<void>("update_patient", { id, input }),
  deletePatient: (id: string) => invoke<void>("delete_patient", { id }),
  recordPatientConsent: (id: string) => invoke<void>("record_patient_consent", { id }),

  listSessions: (patientId?: string) =>
    invoke<Session[]>("list_sessions", { patientId: patientId ?? null }),
  startSession: (patientId: string) => invoke<Session>("start_session", { patientId }),
  finishSession: (id: string, durationSeconds: number) =>
    invoke<void>("finish_session", { id, durationSeconds }),
  updateSessionDuration: (id: string, durationSeconds: number) =>
    invoke<void>("update_session_duration", { id, durationSeconds }),
  cancelSession: (id: string) => invoke<void>("cancel_session", { id }),

  listNotes: (patientId: string) => invoke<Note[]>("list_notes", { patientId }),
  saveNote: (sessionId: string, content: string) => invoke<string>("save_note", { sessionId, content }),
  getSessionNote: (sessionId: string) => invoke<string | null>("get_session_note", { sessionId }),

  listAppointments: (patientId?: string) =>
    invoke<Appointment[]>("list_appointments", { patientId: patientId ?? null }),
  createAppointment: (input: { patient_id: string; appointment_date: string; duration_minutes?: number }) =>
    invoke<string>("create_appointment", { input }),
  setAppointmentStatus: (id: string, status: AppointmentStatus) =>
    invoke<void>("set_appointment_status", { id, status }),
  deleteAppointment: (id: string) => invoke<void>("delete_appointment", { id }),

  listMaterials: () => invoke<Material[]>("list_materials"),
  createMaterial: (input: { title: string; category: MaterialCategory; file_path: string; description?: string }) =>
    invoke<string>("create_material", { input }),
  deleteMaterial: (id: string) => invoke<void>("delete_material", { id }),
  /** Kütüphanedeki materyal dosyasının ham içeriği. */
  readMaterial: (id: string) => invoke<ArrayBuffer>("read_material", { id }),

  listTests: () => invoke<Test[]>("list_tests"),
  saveTest: (id: string | null, input: { title: string; instructions?: string; definition_json: string }) =>
    invoke<string>("save_test", { id, input }),
  deleteTest: (id: string) => invoke<void>("delete_test", { id }),
  saveTestResult: (input: {
    patient_id: string;
    session_id: string | null;
    test_id: string | null;
    test_title: string;
    definition_json: string;
    answers_json: string;
  }) => invoke<TestResult>("save_test_result", { input }),
  listTestResults: (patientId: string) => invoke<TestResult[]>("list_test_results", { patientId }),

  listHomework: (patientId: string) => invoke<Homework[]>("list_homework", { patientId }),
  createHomework: (input: {
    patient_id: string;
    session_id: string | null;
    title: string;
    description?: string;
    due_date?: string;
  }) => invoke<Homework>("create_homework", { input }),
  reviewHomework: (id: string, status: HomeworkStatus, reviewNote?: string) =>
    invoke<void>("review_homework", { id, status, reviewNote: reviewNote ?? null }),
  markHomeworkDelivered: (id: string) => invoke<void>("mark_homework_delivered", { id }),
  deleteHomework: (id: string) => invoke<void>("delete_homework", { id }),

  /** Cloudflare TURN ayarlıysa bu görüşme için geçici ICE sunucuları; ayarlı değilse `null`. */
  generateTurnServers: () => invoke<RTCIceServer[] | null>("generate_turn_servers"),

  getSettings: () => invoke<Record<string, string>>("get_settings"),
  setSetting: (key: string, value: string) => invoke<void>("set_setting", { key, value }),

  backupDatabase: (dest: string) => invoke<void>("backup_database", { dest }),
  restoreDatabase: (src: string) => invoke<void>("restore_database", { src }),

  getRecoveryKey: () => invoke<string>("get_recovery_key"),
  confirmRecoveryKey: (input: string) => invoke<void>("confirm_recovery_key", { input }),
  unlockWithRecoveryKey: (recoveryKey: string) => invoke<void>("unlock_with_recovery_key", { recoveryKey }),
  restoreWithRecoveryKey: (src: string, recoveryKey: string) =>
    invoke<void>("restore_with_recovery_key", { src, recoveryKey }),
};

/** Ayarlar tablosunda kurtarma anahtarının doğrulandığı zamanı tutan anahtar. */
export const RECOVERY_CONFIRMED_KEY = "recovery_key_confirmed_at";

export function errorText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return "Beklenmeyen bir hata oluştu.";
}
