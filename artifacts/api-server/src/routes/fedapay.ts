import { Router, type IRouter } from "express";
import { db, vendorsTable, adsTable, eventsTable, servicesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import crypto from "crypto";

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

async function createFedapayTransaction(opts: {
  amount: number;
  description: string;
  customerName: string;
  customerPhone: string;
  callbackUrl: string;
  metadata: Record<string, string>;
}) {
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
        phone_number: { number: opts.customerPhone, country: "TG" },
      },
      custom_metadata: opts.metadata,
      include_fees: true,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`FedaPay error ${res.status}: ${text}`);
  }
  return res.json() as Promise<{ v1: { transaction: { id: number; token: string } } }>;
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
    const callbackUrl = `https://togomarket.site/api/fedapay-callback`;
    const data = await createFedapayTransaction({
      amount: 1000,
      description: `Abonnement TogoMarket - ${entityType} #${entityId}`,
      customerName,
      customerPhone,
      callbackUrl,
      metadata: { entityType, entityId: String(entityId) },
    });

    const raw = data as unknown as Record<string, unknown>;
    const tx: Record<string, unknown> =
      (raw["v1"] as Record<string, unknown>)?.["transaction"] as Record<string, unknown>
      ?? raw["transaction"] as Record<string, unknown>
      ?? raw;
    const txId = String(tx["id"] ?? "");
    const token = String(tx["token"] ?? "");

    const widgetUrl =
      getFedapayEnv() === "live"
        ? `https://checkout.fedapay.com/${token}`
        : `https://sandbox-checkout.fedapay.com/${token}`;

    return res.json({
      transactionId: txId,
      token,
      widgetUrl,
      environment: getFedapayEnv(),
      publicKey: FEDAPAY_PUBLIC_KEY,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to create FedaPay transaction");
    return res.status(500).json({ error: "Erreur lors de la création du paiement" });
  }
});

router.post("/fedapay-callback", async (req, res) => {
  try {
    const payload = req.body;
    const event = payload?.name ?? payload?.["event"] ?? "";

    if (event !== "transaction.approved") {
      return res.status(200).json({ received: true, skipped: true });
    }

    const transaction = payload?.data?.object ?? payload?.transaction ?? {};
    const metadata = transaction?.custom_metadata ?? {};
    const entityType: string = String(metadata?.entityType ?? "");
    const entityId: number = parseInt(String(metadata?.entityId ?? "0"), 10);

    if (!entityType || !entityId) {
      req.log.warn({ metadata }, "FedaPay callback: missing entityType or entityId");
      return res.status(200).json({ received: true });
    }

    const now = new Date();

    if (entityType === "vendor") {
      const thirtyDays = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
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

      const vendor = await db.select().from(vendorsTable).where(eq(vendorsTable.id, entityId)).limit(1);
      if (vendor[0]?.referredBy) {
        const referrerId = vendor[0].referredBy;
        const referrer = await db.select().from(vendorsTable).where(eq(vendorsTable.id, referrerId)).limit(1);
        if (referrer[0]?.expiryDate) {
          const newExpiry = new Date(referrer[0].expiryDate.getTime() + 3 * 24 * 60 * 60 * 1000);
          await db
            .update(vendorsTable)
            .set({
              expiryDate: newExpiry,
              referralDaysEarned: (referrer[0].referralDaysEarned ?? 0) + 3,
            })
            .where(eq(vendorsTable.id, referrerId));
        }
      }
    } else if (entityType === "ad") {
      const thirtyDays = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      await db
        .update(adsTable)
        .set({ isPublished: true, paymentStatus: "paid", validationMethod: "fedapay", endDate: thirtyDays })
        .where(eq(adsTable.id, entityId));
    } else if (entityType === "event") {
      const event = await db.select().from(eventsTable).where(eq(eventsTable.id, entityId)).limit(1);
      if (event[0]) {
        const expiry = event[0].endDate ?? event[0].date;
        await db
          .update(eventsTable)
          .set({ isPublished: true, paymentStatus: "paid", validationMethod: "fedapay" })
          .where(eq(eventsTable.id, entityId));
      }
    } else if (entityType === "service") {
      const thirtyDays = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      await db
        .update(servicesTable)
        .set({ isPublished: true, paymentStatus: "paid", validationMethod: "fedapay", expiresAt: thirtyDays })
        .where(eq(servicesTable.id, entityId));
    }

    req.log.info({ entityType, entityId }, "FedaPay payment approved, entity published");
    return res.status(200).json({ received: true, entityType, entityId });
  } catch (err) {
    req.log.error({ err }, "FedaPay callback error");
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
