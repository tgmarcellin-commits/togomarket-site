export interface DeliveryAdminOrder {
  id: number;
  firstName: string;
  lastName: string;
  phone: string;
  description: string;
  articlePriceLocked: number;
  distanceLockedKm: number | null;
  transportFeeLocked: number | null;
  distanceSource: string | null;
  status: string;
  createdAt: string;
  assignment: {
    id: number;
    driverId: number;
    acceptanceStatus: string;
    assignmentExpiresAt: string | null;
    acceptedAt: string | null;
    refusedAt: string | null;
    driver: {
      id: number;
      firstName: string;
      lastName: string;
      phone: string;
      isAvailable: boolean;
    } | null;
  } | null;
}

export interface AvailableDriver {
  id: number;
  firstName: string;
  lastName: string;
  phone: string;
  photoUrl: string | null;
  whatsappNumber: string | null;
  isAvailable: boolean;
}

export interface AdminDriver {
  id: number;
  firstName: string;
  lastName: string;
  phone: string;
  whatsappNumber: string | null;
  photoUrl: string | null;
  workZone: string | null;
  idDocumentNumber: string | null;
  idDocumentPhotoUrl: string | null;
  isActive: boolean;
  isAvailable: boolean;
}

export type AdminDriverInput = Partial<Omit<AdminDriver, "id">>;

type FetchLike = typeof fetch;

export async function loadAdminDeliveryOrders(adminCode: string, fetchImpl: FetchLike = fetch): Promise<DeliveryAdminOrder[]> {
  const res = await fetchImpl("/api/admin/delivery/orders", {
    headers: { "x-admin-code": adminCode },
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(errorData.error ?? "Impossible de charger les commandes livraison.");
  }
  const data = await res.json() as { orders?: DeliveryAdminOrder[] };
  return Array.isArray(data.orders) ? data.orders : [];
}

export async function loadAdminAvailableDrivers(adminCode: string, fetchImpl: FetchLike = fetch): Promise<AvailableDriver[]> {
  const res = await fetchImpl("/api/drivers/available", {
    headers: { "x-admin-code": adminCode },
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(errorData.error ?? "Impossible de charger les livreurs disponibles.");
  }

  const data = await res.json() as AvailableDriver[];
  return Array.isArray(data) ? data : [];
}

export async function loadAdminDrivers(adminCode: string, fetchImpl: FetchLike = fetch): Promise<AdminDriver[]> {
  const response = await fetchImpl("/api/admin/drivers", {
    headers: { "x-admin-code": adminCode },
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(errorData.error ?? "Impossible de charger les livreurs.");
  }
  const result = await response.json() as { drivers?: AdminDriver[] };
  return Array.isArray(result.drivers) ? result.drivers : [];
}

export async function saveAdminDriver(
  adminCode: string,
  input: AdminDriverInput,
  driverId?: number,
  fetchImpl: FetchLike = fetch,
): Promise<AdminDriver> {
  const response = await fetchImpl(driverId ? `/api/admin/drivers/${driverId}` : "/api/admin/drivers", {
    method: driverId ? "PATCH" : "POST",
    headers: { "Content-Type": "application/json", "x-admin-code": adminCode },
    body: JSON.stringify(input),
  });
  const result = await response.json().catch(() => ({})) as { driver?: AdminDriver; error?: string };
  if (!response.ok || !result.driver) {
    throw new Error(result.error ?? "Impossible d'enregistrer le livreur.");
  }
  return result.driver;
}
