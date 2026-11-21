// Danışana özel materyal ve testler: boş `patient_id` herkese ortak "genel kütüphane"dir.

interface Owned {
  patient_id: string | null;
}

/**
 * Bir danışanın profili açıkken görünecekler: yalnızca ona özel olanlar; `includeGeneral` açıksa genel
 * kütüphane de. Danışan yoksa (örn. grup seansı) yalnızca genel kütüphane.
 */
export function forPatient<T extends Owned>(items: T[], patientId: string | null | undefined, includeGeneral: boolean): T[] {
  if (!patientId) return items.filter((i) => !i.patient_id);
  return items.filter((i) => i.patient_id === patientId || (includeGeneral && !i.patient_id));
}

let pendingOwner: string | null = null;

/** Danışan profilinden Materyaller/Testler sayfasına geçerken: sayfa o danışanı seçili açsın. */
export function setNewItemOwner(patientId: string | null) {
  pendingOwner = patientId;
}

/** Bekleyen danışan seçimini bir kez verir. */
export function takeNewItemOwner(): string | null {
  const v = pendingOwner;
  pendingOwner = null;
  return v;
}
