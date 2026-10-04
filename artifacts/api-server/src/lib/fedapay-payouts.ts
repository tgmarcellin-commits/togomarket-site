/**
 * Client des retraits FedaPay (compte « Marketplace Livraison »).
 * Documentation : POST /v1/payouts (création), PUT /v1/payouts/start (envoi), GET /v1/payouts/{id},
 * GET /v1/payouts/merchant/{reference}, GET /v1/balances. Statuts d'un virement : pending, started,
 * processing, sent, failed. N'utilise QUE FEDAPAY_MARKETPLACE_SECRET_KEY.
 */

const CURRENCY = "XOF";
const TIMEOUT_MS = 15_000;

/** Interrupteur : sans cette variable, les retraits restent en validation manuelle (comportement d'origine). */
export function isFedapayPayoutsEnabled(): boolean {
  return process.env.FEDAPAY_PAYOUTS_ENABLED === "true";
}

function secretKey(): string {
  return process.env.FEDAPAY_MARKETPLACE_SECRET_KEY?.trim() ?? "";
}

export function isFedapayPayoutConfigured(): boolean {
  return secretKey().length > 0;
}

function isLive(): boolean {
  const publicKey = process.env.FEDAPAY_MARKETPLACE_PUBLIC_KEY?.trim() ?? "";
  return publicKey.startsWith("pk_live") || secretKey().startsWith("sk_live");
}

function baseUrl(): string {
  return isLive() ? "https://api.fedapay.com/v1" : "https://sandbox-api.fedapay.com/v1";
}

/**
 * forbidden   : FedaPay a répondu 401/403 (« Opération non autorisée ») : le compte n'a pas le droit de faire des
 *               virements par API -> les fonds sont remis sur le solde et les virements sont suspendus un moment.
 * rejected    : FedaPay a répondu 4xx (demande refusée) -> l'argent peut être remis sur le solde.
 * unreachable : réseau, délai dépassé ou erreur 5xx -> le virement a peut-être été créé : on ne remet RIEN sur
 *               le solde tant que l'état réel n'est pas connu (rapprochement automatique).
 * not_found   : 404 à la lecture d'un virement.
 */
export class FedapayPayoutError extends Error {
  constructor(
    message: string,
    readonly kind: "rejected" | "forbidden" | "unreachable" | "not_found",
    readonly status?: number,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "FedapayPayoutError";
  }
}

async function call(method: "GET" | "POST" | "PUT", path: string, body?: unknown): Promise<Record<string, unknown>> {
  const key = secretKey();
  if (!key) throw new FedapayPayoutError("FEDAPAY_MARKETPLACE_SECRET_KEY manquante", "rejected");

  let response: Response;
  try {
    response = await fetch(`${baseUrl()}${path}`, {
      method,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new FedapayPayoutError("FedaPay injoignable", "unreachable", undefined, err instanceof Error ? err.message : String(err));
  }

  const text = await response.text().catch(() => "");
  if (!response.ok) {
    const detail = text.slice(0, 400);
    if (response.status === 404) throw new FedapayPayoutError("Introuvable chez FedaPay", "not_found", 404, detail);
    if (response.status >= 500 || response.status === 429 || response.status === 408) {
      throw new FedapayPayoutError(`FedaPay indisponible (${response.status})`, "unreachable", response.status, detail);
    }
    if (response.status === 401 || response.status === 403) {
      throw new FedapayPayoutError(`FedaPay n'autorise pas cette opération (${response.status})`, "forbidden", response.status, detail);
    }
    throw new FedapayPayoutError(`FedaPay a refusé la demande (${response.status})`, "rejected", response.status, detail);
  }
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new FedapayPayoutError("Réponse FedaPay illisible", "unreachable", response.status, text.slice(0, 200));
  }
}

function unwrap(json: Record<string, unknown>, singular: string): Record<string, unknown> {
  // La réponse REST FedaPay porte des clés du type "v1/payout" (avec slash)
  const candidate = json[`v1/${singular}`] ?? json[singular];
  return (candidate && typeof candidate === "object" ? candidate : json) as Record<string, unknown>;
}

export type PayoutRecord = {
  id: string;
  status: string;
  merchantReference: string | null;
  amount: number;
};

function toRecord(raw: Record<string, unknown>): PayoutRecord {
  return {
    id: String(raw["id"] ?? ""),
    status: String(raw["status"] ?? "").toLowerCase(),
    merchantReference: raw["merchant_reference"] ? String(raw["merchant_reference"]) : null,
    // montant FedaPay parfois flottant : conversion immédiate en entier
    amount: Math.round(Number(raw["amount"] ?? 0)),
  };
}

function countryOf(digits: string): string {
  if (digits.startsWith("228")) return "tg";
  if (digits.startsWith("229")) return "bj";
  if (digits.startsWith("225")) return "ci";
  if (digits.startsWith("226")) return "bf";
  if (digits.startsWith("221")) return "sn";
  if (digits.startsWith("227")) return "ne";
  if (digits.startsWith("223")) return "ml";
  return "tg";
}

/** Un virement Mobile Money n'est possible que vers un numéro d'un pays géré par FedaPay. */
export function isPayoutCountrySupported(digits: string): boolean {
  return /^(228|229|225|226|221|227|223)/.test(digits);
}

/** Crée le virement (statut « pending »). La référence marchand doit être unique et ne jamais être réutilisée. */
export async function createPayout(params: {
  amount: number;
  phoneDigits: string;
  reference: string;
  description: string;
  firstName: string;
  lastName: string;
  metadata: Record<string, string>;
}): Promise<PayoutRecord> {
  if (!Number.isInteger(params.amount) || params.amount <= 0) {
    throw new FedapayPayoutError("Montant de virement invalide", "rejected");
  }
  const json = await call("POST", "/payouts", {
    amount: params.amount,
    currency: { iso: CURRENCY },
    description: params.description,
    merchant_reference: params.reference,
    custom_metadata: params.metadata,
    customer: {
      firstname: params.firstName,
      lastname: params.lastName,
      phone_number: { number: `+${params.phoneDigits}`, country: countryOf(params.phoneDigits) },
    },
  });
  const record = toRecord(unwrap(json, "payout"));
  if (!record.id) throw new FedapayPayoutError("Identifiant de virement absent de la réponse FedaPay", "unreachable", undefined, JSON.stringify(json).slice(0, 200));
  return record;
}

/** Envoie immédiatement un virement créé. */
export async function startPayout(payoutId: string): Promise<void> {
  const numericId = Number(payoutId);
  await call("PUT", "/payouts/start", { payouts: [{ id: Number.isFinite(numericId) ? numericId : payoutId }] });
}

export async function retrievePayout(payoutId: string): Promise<PayoutRecord> {
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(payoutId)) throw new FedapayPayoutError("Identifiant de virement invalide", "rejected");
  return toRecord(unwrap(await call("GET", `/payouts/${payoutId}`), "payout"));
}

/** Retrouve un virement par notre référence ; null s'il n'existe pas chez FedaPay. */
export async function retrievePayoutByReference(reference: string): Promise<PayoutRecord | null> {
  try {
    return toRecord(unwrap(await call("GET", `/payouts/merchant/${encodeURIComponent(reference)}`), "payout"));
  } catch (err) {
    if (err instanceof FedapayPayoutError && err.kind === "not_found") return null;
    throw err;
  }
}

export type FedapayBalance = { mode: string; amount: number };

/** Soldes du compte Marketplace chez FedaPay (un solde par mode de paiement : ils ne se combinent pas). */
export async function fetchBalances(): Promise<FedapayBalance[]> {
  const json = await call("GET", "/balances");
  const list = (json["v1/balances"] ?? json["balances"] ?? (Array.isArray(json) ? json : [])) as unknown;
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => item as Record<string, unknown>)
    .map((item) => ({ mode: String(item["mode"] ?? ""), amount: Math.round(Number(item["amount"] ?? 0)) }))
    .filter((item) => Number.isFinite(item.amount));
}
