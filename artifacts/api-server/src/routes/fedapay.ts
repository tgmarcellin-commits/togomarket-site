import { Router, type IRouter } from "express";
import { db, vendorsTable, adsTable, eventsTable, servicesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

const FEDAPAY_SECRET_KEY = process.env.FEDAPAY_SECRET_KEY ?? "";
const FEDAPAY_PUBLIC_KEY = process.env.FEDAPAY_PUBLIC_KEY ?? "";

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
        phone_number: { number: opts.customerPhone, country: getPhoneCountry(opts.customerPhone) },
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
  entityType: string;
  entityId: number;
} | null> {
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
    const entityType = String(metadata?.entityType ?? "");
    const entityId = parseInt(String(metadata?.entityId ?? "0"), 10);
    return {
      approved: status === "approved",
      entityType,
      entityId,
    };
  } catch {
    return null;
  }
}

/** Active une entité dans la base de données suite à un paiement confirmé */
async function activateEntity(entityType: string, entityId: number): Promise<boolean> {
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
  } else {
    return false;
  }
  return true;
}

router.post("/fedapay/create-transaction", async (req, res) => {
  const { entityType, entityId, customerName, customerPhone } = req.body;
  if (!entityType || !entityId || !customerName || !customerPhone) {
    return res.status(400).json({ error: "Champs requis manquants" });
  }

  const validTypes = ["vendor", "ad", "event", "service"];
  if (!validTypes.includes(entityType)) {
    return res.status(400).json({ error: "Type d'entité invalide" });
  }

  try {
    // callback_url = URL de retour après paiement (GET redirect par FedaPay)
    // Le handler GET /api/fedapay-callback vérifie le paiement via l'API FedaPay
    const callbackUrl = `https://togomarket.site/api/fedapay-callback`;
    const data = await createFedapayTransaction({
      amount: 1000,
      description: `Abonnement TogoMarket - ${entityType} #${entityId}`,
      customerName,
      customerPhone,
      callbackUrl,
      metadata: { entityType, entityId: String(entityId) },
    });

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
      return res.redirect("https://togomarket.site/?payment=verify_error");
    }

    if (!result.approved) {
      req.log.info({ transactionId }, "FedaPay GET callback: transaction not approved");
      return res.redirect("https://togomarket.site/?payment=not_approved");
    }

    if (!result.entityType || !result.entityId) {
      req.log.warn({ transactionId }, "FedaPay GET callback: missing entity metadata");
      return res.redirect("https://togomarket.site/?payment=missing_metadata");
    }

    const activated = await activateEntity(result.entityType, result.entityId);
    req.log.info({ transactionId, entityType: result.entityType, entityId: result.entityId }, "FedaPay GET callback: entity activated");

    if (activated) {
      return res.redirect(`https://togomarket.site/?payment=success&type=${result.entityType}`);
    } else {
      return res.redirect("https://togomarket.site/?payment=unknown_type");
    }
  } catch (err) {
    req.log.error({ err, transactionId }, "FedaPay GET callback error");
    return res.redirect("https://togomarket.site/?payment=error");
  }
});

/**
 * POST /api/fedapay-callback
 * Webhook FedaPay configuré dans le tableau de bord FedaPay (server-to-server).
 * Supporte le format webhook officiel ET le format callback direct.
 */
router.post("/fedapay-callback", async (req, res) => {
  try {
    const payload = req.body;

    // Format 1 : webhook dashboard FedaPay → { name: "transaction.approved", data: { object: { ... } } }
    // Format 2 : callback direct → { status: "approved", custom_metadata: { ... } }
    const eventName: string = payload?.name ?? payload?.event ?? "";
    const isWebhookFormat = eventName !== "";
    const directStatus: string = payload?.status ?? "";

    const isApproved =
      eventName === "transaction.approved" ||
      directStatus === "approved";

    if (!isApproved) {
      req.log.info({ eventName, directStatus }, "FedaPay POST callback: not approved, skipped");
      return res.status(200).json({ received: true, skipped: true });
    }

    // Extraire la transaction selon le format
    let transaction: Record<string, unknown>;
    if (isWebhookFormat) {
      transaction = (payload?.data?.object ?? {}) as Record<string, unknown>;
    } else {
      transaction = payload as Record<string, unknown>;
    }

    const metadata = (transaction?.custom_metadata ?? {}) as Record<string, string>;
    const entityType: string = String(metadata?.entityType ?? "");
    const entityId: number = parseInt(String(metadata?.entityId ?? "0"), 10);

    if (!entityType || !entityId) {
      // Peut-être le format simple sans metadata : on essaie de récupérer depuis l'id de transaction
      const txId = String(transaction?.id ?? "");
      if (txId) {
        const verified = await verifyFedapayTransaction(txId);
        if (verified?.approved && verified.entityType && verified.entityId) {
          await activateEntity(verified.entityType, verified.entityId);
          req.log.info({ txId, entityType: verified.entityType, entityId: verified.entityId }, "FedaPay POST callback (verified via API): entity activated");
          return res.status(200).json({ received: true });
        }
      }
      req.log.warn({ metadata }, "FedaPay POST callback: missing entityType or entityId");
      return res.status(200).json({ received: true });
    }

    await activateEntity(entityType, entityId);
    req.log.info({ entityType, entityId }, "FedaPay POST callback: entity activated");
    return res.status(200).json({ received: true, entityType, entityId });
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
    if (result.approved && result.entityType && result.entityId) {
      await activateEntity(result.entityType, result.entityId);
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
