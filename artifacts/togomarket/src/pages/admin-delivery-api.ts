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

type FetchLike = typeof fetch;

export async function loadAdminDeliveryOrders(adminCode: string, fetchImpl: FetchLike = fetch): Promise<DeliveryAdminOrder[]> {
  const res = await fetchImpl("/api/admin/delivery/orders", {
    headers: { "x-admin-code": adminCode },
  });
  if (!res.ok) {
    throw new Error("Impossible de charger les commandes livraison.");
  }
  const data = await res.json() as { orders?: DeliveryAdminOrder[] };
  return Array.isArray(data.orders) ? data.orders : [];
}

export async function loadAdminAvailableDrivers(adminCode: string, fetchImpl: FetchLike = fetch): Promise<AvailableDriver[]> {
  const res = await fetchImpl("/api/drivers/available", {
    headers: { "x-admin-code": adminCode },
  });
  if (!res.ok) {
    throw new Error("Impossible de charger les livreurs disponibles.");
  }
  const data = await res.json() as AvailableDriver[];
  return Array.isArray(data) ? data : [];
}
