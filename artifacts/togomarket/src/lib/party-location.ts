/**
 * Capture de la position GPS de l'acheteur / du vendeur (validation du prix).
 * Sans position, le livreur ne peut pas recevoir de coordonnées exactes.
 */

export type PositionFailure = "unsupported" | "denied" | "unavailable" | "timeout" | "imprecise";

export type PositionResult =
  | { ok: true; latitude: number; longitude: number; accuracyMeters: number | null }
  | { ok: false; reason: PositionFailure };

/** Même limite que le serveur : au-delà, la position est refusée. */
const MAX_ACCURACY_METERS = 2000;

export function capturePosition(): Promise<PositionResult> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      resolve({ ok: false, reason: "unsupported" });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const accuracy = Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null;
        if (accuracy !== null && accuracy > MAX_ACCURACY_METERS) {
          resolve({ ok: false, reason: "imprecise" });
          return;
        }
        resolve({
          ok: true,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: accuracy,
        });
      },
      (error) => {
        // 1 = permission refusée, 2 = position indisponible, 3 = délai dépassé
        resolve({ ok: false, reason: error.code === 1 ? "denied" : error.code === 3 ? "timeout" : "unavailable" });
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    );
  });
}

export function locationErrorMessage(reason: PositionFailure, lang: "fr" | "en"): string {
  const fr: Record<PositionFailure, string> = {
    denied:
      "La localisation est bloquée pour TogoMarket. Autorisez-la dans les réglages du navigateur (cadenas près de l'adresse → Autorisations → Position) et activez la localisation du téléphone, puis réessayez.",
    unavailable:
      "Votre position est introuvable. Activez la localisation (GPS) de votre téléphone, puis réessayez.",
    timeout:
      "La position met trop de temps à arriver. Activez le GPS en « haute précision », placez-vous près d'une fenêtre ou dehors, puis réessayez.",
    imprecise:
      "Votre position est trop imprécise. Activez le GPS en « haute précision » (et non le Wi-Fi seul), puis réessayez.",
    unsupported:
      "Ce navigateur ne gère pas la localisation. Utilisez Chrome ou Safari sur votre téléphone.",
  };
  const en: Record<PositionFailure, string> = {
    denied:
      "Location is blocked for TogoMarket. Allow it in your browser settings (padlock near the address → Permissions → Location) and turn on your phone's location, then try again.",
    unavailable: "Your position could not be found. Turn on your phone's location (GPS), then try again.",
    timeout:
      "Your position is taking too long. Turn on high-accuracy GPS, move near a window or outside, then try again.",
    imprecise: "Your position is too imprecise. Turn on high-accuracy GPS (not Wi-Fi only), then try again.",
    unsupported: "This browser does not support location. Use Chrome or Safari on your phone.",
  };
  return (lang === "fr" ? fr : en)[reason];
}

export const PARTY_LOCATION_UPDATED_EVENT = "tm-party-location-updated";

export type PartyLocationStatus = { buyer: boolean; seller: boolean; mine: boolean };

export async function fetchPartyLocationStatus(
  conversationId: number,
  headers: Record<string, string>,
): Promise<PartyLocationStatus | null> {
  try {
    const response = await fetch(`/api/delivery/conversations/${conversationId}/party-location-status`, { headers });
    if (!response.ok) return null;
    return await response.json() as PartyLocationStatus;
  } catch {
    return null;
  }
}

/** Envoie la position captée au serveur. */
export async function sharePartyLocation(
  conversationId: number,
  headers: Record<string, string>,
  position: Extract<PositionResult, { ok: true }>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const response = await fetch(`/api/delivery/conversations/${conversationId}/party-location`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({
        latitude: position.latitude,
        longitude: position.longitude,
        accuracyMeters: position.accuracyMeters,
      }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => null) as { error?: string } | null;
      return { ok: false, error: data?.error ?? "Partage de la position impossible." };
    }
    window.dispatchEvent(new Event(PARTY_LOCATION_UPDATED_EVENT));
    return { ok: true };
  } catch {
    return { ok: false, error: "Partage de la position impossible. Vérifiez votre connexion." };
  }
}
