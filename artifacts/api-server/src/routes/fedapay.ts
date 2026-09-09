import { Router, type IRouter } from "express";
import { db, vendorsTable, adsTable, eventsTable, servicesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { normalizePhone } from "../lib/phone";
import { createHmac, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import { isAdminAny } from "../lib/admin-auth";

const router: IRouter = Router();

const FEDAPAY_SECRET_KEY = process.env.FEDAPAY_SECRET_KEY ?? "";
const FEDAPAY_PUBLIC_KEY = process.env.FEDAPAY_PUBLIC_KEY ?? "";
const FEDAPAY_WEBHOOK_SECRET = process.env.FEDAPAY_WEBHOOK_SECRET ?? "";
const EXPECTED_AMOUNT = 1000;
const EXPECTED_CURRENCY = "XOF";
const APP_URL = "https://togomarket.site";
const VALID_ENTITY_TYPES = ["vendor", "ad", "event", "service"] as const;
type EntityType = typeof VALID_ENTITY_TYPES[number];

function isEntityType(value: unknown): value is EntityType {
  return typeof value === "string" && VALID_ENTITY_TYPES.includes(value as EntityType);
}

function paymentRedirect(status: string, entityType?: EntityType): string {
  const url = new URL(APP_URL);
  url.searchParams.set("payment", status);
  if (entityType) url.searchParams.set("type", entityType);
  return url.toString();
}

function verifyWebhookSignature(rawBody: Buffer, header: string): boolean {
  if (!FEDAPAY_WEBHOOK_SECRET) return false;
  const fields = new Map(header.split(",").map((part) => {
    const separator = part.indexOf("=");
    return [part.slice(0, separator).trim(), part.slice(separator + 1).trim()];
  }));
  const timestamp = Number(fields.get("t"));
  const signature = fields.get("s");
  if (!Number.isFinite(timestamp) || !signature) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > 300) return false;
  const expected = createHmac("sha256", FEDAPAY_WEBHOOK_SECRET)
    .update(`${timestamp}.${rawBody.toString("utf8")}`, "utf8")
    .digest("hex");
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature);
  return expectedBuffer.length === signatureBuffer.length && timingSafeEqual(expectedBuffer, signatureBuffer);
}

function getFedapayEnv(): "live" | "sandbox" {
  return FEDAPAY_PUBLIC_KEY.startsWith("pk_live") ? "live" : "sandbox";
}

function getFedapayBaseUrl(): string {
  return getFedapayEnv() === "live"
    ? "https://api.fedapay.com/v1"
    : "https://sandbox-api.fedapay.com/v1";
}

/** Détecte le code pays FedaPay depuis un numéro de téléphone international */
function getPhoneCountry(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("228")) return "TG"; // Togo
  if (digits.startsWith("229")) return "BJ"; // Bénin
  if (digits.startsWith("225")) return "CI"; // Côte d'Ivoire
  if (digits.startsWith("221")) return "SN"; // Sénégal
  if (digits.startsWith("227")) return "NE"; // Niger
  return "TG"; // fallback
}

async function createFedapayTransaction(opts: {
  amount: number;
  description: string;
  customerName: string;
  customerPhone: string;
  callbackUrl: string;
  metadata: Record<string, string>;
}): Promise<{ id: string; paymentUrl: string }> {
  const baseUrl = getFedapayBaseUrl();
  // Normaliser le numéro (corrige notamment les numéros béninois dont le 0 de "01" a été perdu)
  const customerPhone = normalizePhone(opts.customerPhone);
  const res = await fetch(`${baseUrl}/transactions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${FEDAPAY_SECRET_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      description: opts.description,
      amount: opts.amount,
      currency: { iso: "XOF" },
      callback_url: opts.callbackUrl,
      customer: {
        firstname: opts.customerName,
        phone_number: { number: customerPhone, country: getPhoneCountry(customerPhone) },
      },
      custom_metadata: opts.metadata,
      include_fees: true,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`FedaPay error ${res.status}: ${text}`);
  }
  const json = await res.json() as Record<string, unknown>;
  // La réponse FedaPay REST a la clé littérale "v1/transaction" (avec slash)
  const txRaw = (
    json["v1/transaction"]
    ?? (json["v1"] as Record<string, unknown> | undefined)?.["transaction"]
    ?? json["transaction"]
    ?? json
  ) as Record<string, unknown>;
  const id = String(txRaw["id"] ?? "");
  const paymentUrl = String(txRaw["payment_url"] ?? "");
  if (!paymentUrl) {
    throw new Error(`FedaPay: payment_url absent dans la réponse: ${JSON.stringify(json)}`);
  }
  return { id, paymentUrl };
}

/** Vérifie le statut d'une transaction FedaPay et retourne ses métadonnées si approuvée */
async function verifyFedapayTransaction(transactionId: string): Promise<{
  approved: boolean;
  entityType: EntityType | null;
  entityId: number;
  amount: number;
  currency: string;
  customerPhone: string;
} | null> {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(transactionId)) return null;
  const baseUrl = getFedapayBaseUrl();
  try {
    const res = await fetch(`${baseUrl}/transactions/${transactionId}`, {
      headers: {
        Authorization: `Bearer ${FEDAPAY_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) return null;
    const json = await res.json() as Record<string, unknown>;
    const txRaw = (
      json["v1/transaction"]
      ?? (json["v1"] as Record<string, unknown> | undefined)?.["transaction"]
      ?? json["transaction"]
      ?? json
    ) as Record<string, unknown>;
    const status = String(txRaw["status"] ?? "");
    const metadata = (txRaw["custom_metadata"] ?? {}) as Record<string, string>;
    const rawEntityType = String(metadata?.entityType ?? "");
    const entityId = parseInt(String(metadata?.entityId ?? "0"), 10);
    const currencyRaw = txRaw["currency"];
    const currency = typeof currencyRaw === "object" && currencyRaw
      ? String((currencyRaw as Record<string, unknown>)["iso"] ?? "")
      : String(currencyRaw ?? "");
    const customer = txRaw["customer"] as Record<string, unknown> | undefined;
    const phoneNumber = customer?.["phone_number"] as Record<string, unknown> | undefined;
    return {
      approved: status === "approved",
      entityType: isEntityType(rawEntityType) ? rawEntityType : null,
      entityId,
      amount: Number(txRaw["amount"] ?? 0),
      currency,
      customerPhone: normalizePhone(String(phoneNumber?.["number"] ?? customer?.["phone"] ?? "")),
    };
  } catch {
    return null;
  }
}

/** Active une entité dans la base de données suite à un paiement confirmé */
async function bindTransaction(entityType: EntityType, entityId: number, transactionId: string): Promise<void> {
  if (entityType === "vendor") {
    await db.update(vendorsTable).set({ fedapayTransactionId: transactionId }).where(eq(vendorsTable.id, entityId));
  } else if (entityType === "ad") {
    await db.update(adsTable).set({ fedapayTransactionId: transactionId }).where(eq(adsTable.id, entityId));
  } else if (entityType === "event") {
    await db.update(eventsTable).set({ fedapayTransactionId: transactionId }).where(eq(eventsTable.id, entityId));
  } else {
    await db.update(servicesTable).set({ fedapayTransactionId: transactionId }).where(eq(servicesTable.id, entityId));
  }
}

async function getPaymentEntity(entityType: EntityType, entityId: number): Promise<{
  exists: boolean;
  transactionId: string | null;
  ownerPhone: string | null;
}> {
  if (entityType === "vendor") {
    const [row] = await db.select({ transactionId: vendorsTable.fedapayTransactionId, phone: vendorsTable.phone })
      .from(vendorsTable).where(eq(vendorsTable.id, entityId)).limit(1);
    return { exists: Boolean(row), transactionId: row?.transactionId ?? null, ownerPhone: row?.phone ?? null };
  }
  if (entityType === "ad") {
    const [row] = await db.select({ transactionId: adsTable.fedapayTransactionId, phone: adsTable.advertiserPhone })
      .from(adsTable).where(eq(adsTable.id, entityId)).limit(1);
    return { exists: Boolean(row), transactionId: row?.transactionId ?? null, ownerPhone: row?.phone ?? null };
  }
  if (entityType === "service") {
    const [row] = await db.select({ transactionId: servicesTable.fedapayTransactionId, phone: servicesTable.contact })
      .from(servicesTable).where(eq(servicesTable.id, entityId)).limit(1);
    return { exists: Boolean(row), transactionId: row?.transactionId ?? null, ownerPhone: row?.phone ?? null };
  }
  const [row] = await db.select({
    transactionId: eventsTable.fedapayTransactionId,
    phone: eventsTable.whatsappPhone,
  })
    .from(eventsTable).where(eq(eventsTable.id, entityId)).limit(1);
  return { exists: Boolean(row), transactionId: row?.transactionId ?? null, ownerPhone: row?.phone ?? null };
}

async function activateEntity(
  entityType: EntityType,
  entityId: number,
  transactionId: string,
  customerPhone: string,
): Promise<boolean> {
  const paymentEntity = await getPaymentEntity(entityType, entityId);
  if (!paymentEntity.exists) return false;
  if (paymentEntity.transactionId !== transactionId) {
    return false;
  }
  if (entityType === "vendor" && (!customerPhone || normalizePhone(paymentEntity.ownerPhone ?? "") !== normalizePhone(customerPhone))) return false;
  const now = new Date();
  const thirtyDays = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  if (entityType === "vendor") {
    await db
      .update(vendorsTable)
      .set({
        isPublished: true,
        paymentStatus: "paid",
        validationMethod: "fedapay",
        expiryDate: thirtyDays,
        verified: true,
      })
      .where(eq(vendorsTable.id, entityId));
  } else if (entityType === "ad") {
    await db
      .update(adsTable)
      .set({ isPublished: true, paymentStatus: "paid", validationMethod: "fedapay", endDate: thirtyDays })
      .where(eq(adsTable.id, entityId));
  } else if (entityType === "event") {
    await db
      .update(eventsTable)
      .set({ isPublished: true, paymentStatus: "paid", validationMethod: "fedapay" })
      .where(eq(eventsTable.id, entityId));
  } else if (entityType === "service") {
    await db
      .update(servicesTable)
      .set({ isPublished: true, paymentStatus: "paid", validationMethod: "fedapay", expiresAt: thirtyDays })
      .where(eq(servicesTable.id, entityId));
  }
  return true;
}

router.post("/fedapay/create-transaction", async (req, res) => {
  const { entityType, entityId, customerName, customerPhone, ownerCredential, actor } = req.body;
  if (!entityType || !entityId || !customerName || !customerPhone || !ownerCredential) {
    return res.status(400).json({ error: "Champs requis manquants" });
  }

  const parsedEntityId = Number(entityId);
  if (!isEntityType(entityType) || !Number.isInteger(parsedEntityId) || parsedEntityId <= 0) {
    return res.status(400).json({ error: "Type d'entité invalide" });
  }
  if (String(customerName).trim().length < 2 || String(customerName).length > 120) {
    return res.status(400).json({ error: "Nom client invalide" });
  }

  try {
    const paymentEntity = await getPaymentEntity(entityType, parsedEntityId);
    if (!paymentEntity.exists) return res.status(404).json({ error: "Élément à payer introuvable" });
    if (entityType === "vendor") {
      if (actor === "admin") {
        if (!await isAdminAny(String(ownerCredential))) {
          return res.status(403).json({ error: "Authentification administrateur requise" });
        }
      } else {
        const [vendor] = await db.select({ passwordHash: vendorsTable.passwordHash })
          .from(vendorsTable)
          .where(eq(vendorsTable.id, parsedEntityId))
          .limit(1);
        if (!vendor || !await bcrypt.compare(String(ownerCredential), vendor.passwordHash)) {
          return res.status(403).json({ error: "Authentification du propriétaire requise" });
        }
      }
    } else if (!await isAdminAny(String(ownerCredential))) {
      return res.status(403).json({ error: "Authentification administrateur requise" });
    }
    const expectedPhone = paymentEntity.ownerPhone ? normalizePhone(paymentEntity.ownerPhone) : "";
    const suppliedPhone = normalizePhone(String(customerPhone));
    if (entityType === "event" && expectedPhone.length < 8) {
      return res.status(400).json({ error: "Cet événement n'a pas encore de numéro WhatsApp enregistré" });
    }
    if (expectedPhone.length >= 8 && suppliedPhone !== expectedPhone) {
      return res.status(403).json({ error: "Le numéro ne correspond pas au propriétaire" });
    }
    // callback_url = URL de retour après paiement (GET redirect par FedaPay)
    // Le handler GET /api/fedapay-callback vérifie le paiement via l'API FedaPay
    const callbackUrl = `https://togomarket.site/api/fedapay-callback`;
    const data = await createFedapayTransaction({
      amount: EXPECTED_AMOUNT,
      description: `Abonnement TogoMarket - ${entityType} #${entityId}`,
      customerName,
      customerPhone,
      callbackUrl,
      metadata: { entityType, entityId: String(parsedEntityId) },
    });
    await bindTransaction(entityType, parsedEntityId, data.id);

    const txId = data.id;
    const widgetUrl = data.paymentUrl;

    return res.json({
      transactionId: txId,
      widgetUrl,
      environment: getFedapayEnv(),
      publicKey: FEDAPAY_PUBLIC_KEY,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to create FedaPay transaction");
    return res.status(500).json({ error: "Erreur lors de la création du paiement" });
  }
});

/**
 * GET /api/fedapay-callback
 * FedaPay redirige le navigateur du client ici après paiement avec ?id=TX_ID
 * On vérifie le statut via l'API FedaPay, on active l'entité, puis on redirige vers l'app.
 */
router.get("/fedapay-callback", async (req, res) => {
  const transactionId = String(req.query.id ?? "");

  if (!transactionId) {
    req.log.warn("FedaPay GET callback: missing transaction id");
    return res.redirect("https://togomarket.site/?payment=missing_id");
  }

  try {
    const result = await verifyFedapayTransaction(transactionId);

    if (!result) {
      req.log.warn({ transactionId }, "FedaPay GET callback: transaction verification failed");
      return res.redirect(paymentRedirect("verify_error"));
    }

    if (!result.approved) {
      req.log.info({ transactionId }, "FedaPay GET callback: transaction not approved");
      return res.redirect(paymentRedirect("not_approved"));
    }

    if (!result.entityType || !result.entityId) {
      req.log.warn({ transactionId }, "FedaPay GET callback: missing entity metadata");
      return res.redirect(paymentRedirect("missing_metadata"));
    }

    if (result.amount !== EXPECTED_AMOUNT || result.currency !== EXPECTED_CURRENCY) {
      req.log.warn({ transactionId, amount: result.amount, currency: result.currency }, "FedaPay GET callback: amount mismatch");
      return res.redirect(paymentRedirect("invalid_amount"));
    }
    const activated = await activateEntity(result.entityType, result.entityId, transactionId, result.customerPhone);
    req.log.info({ transactionId, entityType: result.entityType, entityId: result.entityId }, "FedaPay GET callback: entity activated");

    if (activated) {
      return res.redirect(paymentRedirect("success", result.entityType));
    } else {
      return res.redirect(paymentRedirect("transaction_mismatch"));
    }
  } catch (err) {
    req.log.error({ err, transactionId }, "FedaPay GET callback error");
    return res.redirect(paymentRedirect("error"));
  }
});

/**
 * POST /api/fedapay-callback
 * Webhook FedaPay configuré dans le tableau de bord FedaPay (server-to-server).
 * Supporte le format webhook officiel ET le format callback direct.
 */
router.post("/fedapay-callback", async (req, res) => {
  try {
    const rawBody = (req as typeof req & { rawBody?: Buffer }).rawBody;
    const signature = req.headers["x-fedapay-signature"];
    if (!rawBody || typeof signature !== "string" || !verifyWebhookSignature(rawBody, signature)) {
      req.log.warn("FedaPay webhook rejected: invalid signature");
      return res.status(400).json({ error: "Signature webhook invalide" });
    }
    const payload = JSON.parse(rawBody.toString("utf8")) as Record<string, unknown>;
    const eventName = String(payload["name"] ?? payload["event"] ?? "");
    if (eventName !== "transaction.approved") {
      req.log.info({ eventName }, "FedaPay POST callback: event skipped");
      return res.status(200).json({ received: true, skipped: true });
    }
    const data = payload["data"] as Record<string, unknown> | undefined;
    const transaction = (data?.["object"] ?? {}) as Record<string, unknown>;
    const txId = String(transaction["id"] ?? "");
    const verified = await verifyFedapayTransaction(txId);
    if (
      !verified?.approved ||
      !verified.entityType ||
      !verified.entityId ||
      verified.amount !== EXPECTED_AMOUNT ||
      verified.currency !== EXPECTED_CURRENCY
    ) {
      req.log.warn({ txId }, "FedaPay webhook rejected after API verification");
      return res.status(400).json({ error: "Transaction invalide" });
    }
    const activated = await activateEntity(verified.entityType, verified.entityId, txId, verified.customerPhone);
    if (!activated) return res.status(409).json({ error: "Transaction non liée à cet élément" });
    req.log.info({ txId, entityType: verified.entityType, entityId: verified.entityId }, "FedaPay webhook: entity activated");
    return res.status(200).json({ received: true });
  } catch (err) {
    req.log.error({ err }, "FedaPay POST callback error");
    return res.status(500).json({ error: "Erreur interne" });
  }
});

/**
 * GET /api/fedapay/verify/:transactionId
 * Permet au frontend de vérifier manuellement le statut d'un paiement
 * (utile si la redirection callback a échoué)
 */
router.get("/fedapay/verify/:transactionId", async (req, res) => {
  const { transactionId } = req.params;
  if (!transactionId) {
    return res.status(400).json({ error: "ID de transaction requis" });
  }
  try {
    const result = await verifyFedapayTransaction(transactionId);
    if (!result) {
      return res.status(404).json({ error: "Transaction introuvable ou erreur API" });
    }
    if (
      result.approved &&
      result.entityType &&
      result.entityId &&
      result.amount === EXPECTED_AMOUNT &&
      result.currency === EXPECTED_CURRENCY
    ) {
      const activated = await activateEntity(result.entityType, result.entityId, transactionId, result.customerPhone);
      if (!activated) return res.status(409).json({ error: "Transaction non liée à cet élément" });
      return res.json({ approved: true, activated: true, entityType: result.entityType, entityId: result.entityId });
    }
    return res.json({ approved: result.approved, activated: false });
  } catch (err) {
    req.log.error({ err }, "FedaPay verify error");
    return res.status(500).json({ error: "Erreur interne" });
  }
});

router.get("/fedapay/config", async (_req, res) => {
  return res.json({
    publicKey: FEDAPAY_PUBLIC_KEY,
    environment: getFedapayEnv(),
  });
});

export default router;
