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
}

export interface PatientInput {
  full_name: string;
  birth_date?: string | null;
  phone?: string | null;
  email?: string | null;
  status?: PatientStatus;
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

  getSettings: () => invoke<Record<string, string>>("get_settings"),
  setSetting: (key: string, value: string) => invoke<void>("set_setting", { key, value }),

  backupDatabase: (dest: string) => invoke<void>("backup_database", { dest }),
  restoreDatabase: (src: string) => invoke<void>("restore_database", { src }),
};

export function errorText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return "Beklenmeyen bir hata oluştu.";
}
