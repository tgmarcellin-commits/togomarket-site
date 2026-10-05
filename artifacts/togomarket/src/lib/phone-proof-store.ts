/**
 * Preuve de vérification du numéro, conservée sur l'appareil après le code WhatsApp (challenge « 10Défis »).
 * C'est un jeton signé par le serveur : il permet de ne pas redemander un code au joueur qui revient, et de rattacher
 * ses conversations à son numéro vérifié sans second code. Il ne sert à rien sans l'appareil qui le détient.
 */

const STORAGE_KEY = "tm_phone_proof_v1";

export type StoredPhoneProof = {
  /** Numéro tel que saisi par le joueur lors de la vérification. */
  typedPhone: string;
  proof: string;
  /** Expiration (ms depuis 1970), fixée par le serveur. */
  expiresAt: number;
};

export function loadPhoneProof(): StoredPhoneProof | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<StoredPhoneProof>;
    if (typeof data.typedPhone !== "string" || typeof data.proof !== "string" || typeof data.expiresAt !== "number") return null;
    if (data.expiresAt <= Date.now()) {
      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return { typedPhone: data.typedPhone, proof: data.proof, expiresAt: data.expiresAt };
  } catch {
    return null;
  }
}

export function savePhoneProof(value: StoredPhoneProof): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // stockage indisponible (navigation privée…) : le joueur devra simplement refaire la vérification
  }
}

export function clearPhoneProof(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // rien à faire
  }
}

/** Deux saisies désignent-elles le même numéro ? Comparaison des chiffres seuls (espaces et « + » ignorés). */
export function sameTypedPhone(a: string, b: string): boolean {
  const digits = (value: string) => value.replace(/\D/g, "").replace(/^00/, "");
  const left = digits(a);
  return left.length >= 8 && left === digits(b);
}
