import { Router, type IRouter } from "express";
import { eq, desc, and, gt, lt, inArray, isNull, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import multer from "multer";
import {
  db,
  vendorsTable,
  publishCodesTable,
  otpCodesTable,
  listingsTable,
  conversationsTable,
  messagesTable,
  pushSubscriptionsTable,
} from "@workspace/db";
import { sendWhatsAppText } from "../lib/whatsapp-api";
import { dispatchVendorOTP, getOtpConfiguration } from "../lib/otp-provider";
import { normalizePhone, phoneEq } from "../lib/phone";
import { getIo } from "../lib/socket-io";
import { webpush, vapidReady } from "../lib/webpush";
import { logger } from "../lib/logger";
import { uploadCloudinaryMedia, deleteCloudinaryMedia } from "../lib/cloudinary-media";
import { validateFileBytes } from "../lib/file-security";
import { secureMessageFileUrl } from "../lib/message-file-access";
import {
  compatibleMessageColumns,
  compatibleMessageInsertColumns,
  compatibleMessagesInsertTable,
  withMessageListingContext,
} from "../lib/message-compat";
import { verifyVendorRenewalToken } from "../lib/vendor-renewal-token";
import { authenticateVendorRequest, findVendorByIdentifier, issueVendorSession, revokeAllVendorSessions, revokeVendorSession } from "../lib/vendor-auth";
import { isBrevoConfigured, sendVendorTemporaryPasswordEmail } from "../lib/brevo-mail";
import { generateTemporaryPassword, isUniqueViolation, isValidEmail, maskEmail, normalizeEmail } from "../lib/vendor-email";
import { createRateLimiter, maskPhone } from "../lib/phone-signup-core";
import { isValidProfilePhotoPath, normalizeProfilePhoto } from "../lib/profile-photo";

const adminUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 1, fields: 3 },
});

function getPhoneCountry(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.startsWith("228")) return "TG";
  if (d.startsWith("229")) return "BJ";
  if (d.startsWith("225")) return "CI";
  if (d.startsWith("221")) return "SN";
  if (d.startsWith("227")) return "NE";
  return "TG";
}
import {
  VendorRegisterBody,
  VendorLoginBody,
  VendorLoginResponse,
  VendorUpdateProfileBody,
  VendorUpdateProfileResponse,
  AdminGetVendorsBody,
  AdminGetVendorsResponse,
  AdminActivateVendorBody,
  AdminActivateVendorResponse,
  AdminGenerateVendorCodeBody,
  AdminGenerateVendorCodeResponse,
  AdminDeleteVendorBody,
  AdminResetVendorPasswordBody,
} from "@workspace/api-zod";
import { isSuperAdmin } from "../lib/admin-auth";
import { isVipVendor } from "../lib/vip-vendors";
import { fedapayHeaders, fedapayFetch } from "../lib/fedapay-headers";

const router: IRouter = Router();

function randomCode(digits: number): string {
  const min = Math.pow(10, digits - 1);
  const max = Math.pow(10, digits) - 1;
  return String(Math.floor(Math.random() * (max - min + 1)) + min);
}

async function generateAndStoreOTP(phone: string): Promise<string> {
  const code = randomCode(6);
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
  await db
    .update(otpCodesTable)
    .set({ used: true })
    .where(and(eq(otpCodesTable.phone, phone), eq(otpCodesTable.used, false)));
  await db.insert(otpCodesTable).values({ phone, code, expiresAt });
  return code;
}

async function getActivePublishCode(vendorId: number) {
  const now = new Date();
  const codes = await db
    .select()
    .from(publishCodesTable)
    .where(and(eq(publishCodesTable.vendorId, vendorId), gt(publishCodesTable.endDate, now)))
    .orderBy(desc(publishCodesTable.endDate))
    .limit(1);
  if (codes.length === 0) return null;
  const c = codes[0];
  const daysLeft = Math.ceil((c.endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  return { code: c.code, endDate: c.endDate.toISOString(), daysLeft };
}

function mapVendor(v: typeof vendorsTable.$inferSelect, publishCode: { code: string; endDate: string; daysLeft: number } | null) {
  const now = new Date();
  const expiry = v.expiryDate;
  const daysUntilExpiry = expiry
    ? Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    : null;

  return {
    id: v.id,
    firstName: v.firstName,
    lastName: v.lastName,
    shopName: v.shopName ?? null,
    phone: v.phone,
    verified: v.verified,
    profilePhoto: normalizeProfilePhoto(v.profilePhoto),
    createdAt: v.createdAt.toISOString(),
    publishCode,
    expiryDate: expiry?.toISOString() ?? null,
    isPublished: v.isPublished,
    paymentStatus: v.paymentStatus,
    validationMethod: v.validationMethod,
    daysUntilExpiry,
    referralDaysEarned: v.referralDaysEarned ?? 0,
  };
}

router.post("/vendors/register", async (req, res) => {
  const parsed = VendorRegisterBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.message });
  }
  const { firstName, lastName, password } = parsed.data;
  const shopName = parsed.data.shopName ? String(parsed.data.shopName).trim() || null : null;
  const profilePhoto = parsed.data.profilePhoto ? String(parsed.data.profilePhoto).trim() || null : null;
  if (profilePhoto && !isValidProfilePhotoPath(profilePhoto)) {
    return res.status(400).json({ error: "Chemin de photo de profil invalide." });
  }
  const wantsNotifications = parsed.data.wantsNotifications !== false;
  const phone = normalizePhone(parsed.data.phone);
  const referredBy = parsed.data.referredBy ? Number(parsed.data.referredBy) : null;

  const existing = await db
    .select()
    .from(vendorsTable)
    .where(phoneEq(vendorsTable.phone, phone))
    .limit(1);

  if (existing.length > 0) {
    const vendor = existing[0];
    if (vendor.verified) {
      return res.status(409).json({ error: "Ce numéro est déjà inscrit." });
    }
    // Vendor exists but not yet verified — resend OTP
    try {
      const code = await generateAndStoreOTP(phone);
      const delivery = await dispatchVendorOTP(phone, code, vendor.firstName);
      req.log.info({ id: vendor.id, ...delivery }, "OTP resent to existing unverified vendor");
      return res.status(201).json({ id: vendor.id, firstName: vendor.firstName, lastName: vendor.lastName, phone, ...delivery });
    } catch (err) {
      req.log.error({ err }, "Failed to resend OTP to existing vendor");
      return res.status(500).json({ error: "Impossible de créer le code. Réessayez." });
    }
  }

  let vendorId: number | null = null;
  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const now = new Date();
    const trialEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const [vendor] = await db
      .insert(vendorsTable)
      .values({
        firstName,
        lastName,
        shopName: shopName ?? undefined,
        phone,
        passwordHash,
        profilePhoto: profilePhoto ?? undefined,
        wantsNotifications,
        verified: false,
        expiryDate: trialEnd,
        isPublished: false,
        paymentStatus: "trial",
        validationMethod: "trial",
        referredBy: referredBy ?? undefined,
      })
      .returning();
    vendorId = vendor.id;

    const code = await generateAndStoreOTP(phone);
    const delivery = await dispatchVendorOTP(phone, code, firstName);

    if (referredBy) {
      const referrers = await db.select().from(vendorsTable).where(eq(vendorsTable.id, referredBy)).limit(1);
      const referrer = referrers[0];
      if (referrer) {
        const base = referrer.expiryDate && referrer.expiryDate.getTime() > now.getTime() ? referrer.expiryDate : now;
        const newExpiry = new Date(base.getTime() + 3 * 24 * 60 * 60 * 1000);
        await db
          .update(vendorsTable)
          .set({ expiryDate: newExpiry, referralDaysEarned: (referrer.referralDaysEarned ?? 0) + 3 })
          .where(eq(vendorsTable.id, referrer.id));
        req.log.info({ referrerId: referrer.id, newVendorId: vendor.id }, "Referrer credited +3 days for new signup");
      }
    }

    req.log.info({ id: vendor.id, ...delivery }, "Vendor registered");
    return res.status(201).json({ id: vendor.id, firstName, lastName, phone, ...delivery });
  } catch (err) {
    req.log.error({ err }, "Failed to register vendor or send OTP");
    if (vendorId) {
      await db.delete(vendorsTable).where(eq(vendorsTable.id, vendorId)).catch(() => {});
    }
    return res.status(500).json({ error: "Impossible de créer le compte. Réessayez." });
  }
});

router.post("/vendors/verify-otp", async (req, res) => {
  const phone = normalizePhone(String(req.body.phone ?? ""));
  const code = String(req.body.code ?? "").trim();
  if (!phone || !code) {
    return res.status(400).json({ error: "Numéro et code requis" });
  }

  const vendors = await db.select().from(vendorsTable).where(phoneEq(vendorsTable.phone, phone)).limit(1);
  if (vendors.length === 0) {
    return res.status(404).json({ error: "Compte introuvable" });
  }
  const vendor = vendors[0];

  if (vendor.verified) {
    return res.status(409).json({ error: "Compte déjà vérifié. Connectez-vous avec votre mot de passe." });
  }

  const now = new Date();
  const otps = await db
    .select()
    .from(otpCodesTable)
    .where(
      and(
        eq(otpCodesTable.phone, phone),
        eq(otpCodesTable.used, false),
        gt(otpCodesTable.expiresAt, now),
        lt(otpCodesTable.attempts, 3)
      )
    )
    .orderBy(desc(otpCodesTable.createdAt))
    .limit(1);

  if (otps.length === 0) {
    return res.status(400).json({ error: "Code expiré ou invalide. Demandez un nouveau code." });
  }

  const otp = otps[0];
  if (otp.code !== code) {
    await db
      .update(otpCodesTable)
      .set({ attempts: otp.attempts + 1 })
      .where(eq(otpCodesTable.id, otp.id));
    const remaining = 2 - otp.attempts;
    return res.status(400).json({ error: `Code incorrect. ${remaining > 0 ? `${remaining} tentative(s) restante(s).` : "Demandez un nouveau code."}` });
  }

  await db.update(otpCodesTable).set({ used: true }).where(eq(otpCodesTable.id, otp.id));
  const [updated] = await db
    .update(vendorsTable)
    .set({ verified: true, isPublished: true })
    .where(eq(vendorsTable.id, vendor.id))
    .returning();

  req.log.info({ id: vendor.id }, "Vendor OTP verified, account activated");
  const publishCode = await getActivePublishCode(updated.id);
  await issueVendorSession(res, updated.id);
  return res.json(VendorLoginResponse.parse(mapVendor(updated, publishCode)));
});

// Route : demande d'activation manuelle (utilisé quand le vendeur ne reçoit pas l'OTP)
// Marque le compte comme "manual_requested" et notifie l'admin via WhatsApp.
router.post("/vendors/request-manual-activation", async (req, res) => {
  const phone = normalizePhone(String(req.body.phone ?? ""));
  if (!phone) {
    return res.status(400).json({ error: "Numéro requis" });
  }

  const vendors = await db.select().from(vendorsTable).where(phoneEq(vendorsTable.phone, phone)).limit(1);
  if (vendors.length === 0) {
    return res.status(404).json({ error: "Compte introuvable" });
  }
  const vendor = vendors[0];

  if (vendor.verified) {
    return res.status(400).json({ error: "Ce compte est déjà vérifié." });
  }

  // Marquer comme demandant une activation manuelle
  await db
    .update(vendorsTable)
    .set({ validationMethod: "manual_requested" })
    .where(eq(vendorsTable.id, vendor.id));

  // Notifier l'admin via WhatsApp (non-fatal si échec)
  try {
    const { whatsappValidation: adminPhone } = await getOtpConfiguration();
    const msg =
      `🔔 *Demande d'activation manuelle TogoMarket*\n\n` +
      `Vendeur : ${vendor.firstName} ${vendor.lastName}\n` +
      `Téléphone : +${vendor.phone}\n` +
      `ID : #${vendor.id}\n\n` +
      `Ce vendeur n'a pas reçu son code OTP et demande une activation manuelle. ` +
      `Allez dans le panneau admin → onglet "Manuels" pour l'activer.`;
    await sendWhatsAppText(adminPhone, msg);
  } catch (err) {
    req.log.error({ err }, "request-manual-activation: échec notification WhatsApp admin");
  }

  req.log.info({ vendorId: vendor.id }, "Vendor requested manual activation");
  return res.json({ success: true });
});

router.post("/vendors/resend-otp", async (req, res) => {
  const phone = normalizePhone(String(req.body.phone ?? ""));
  if (!phone) {
    return res.status(400).json({ error: "Numéro requis" });
  }

  const vendors = await db.select().from(vendorsTable).where(phoneEq(vendorsTable.phone, phone)).limit(1);
  if (vendors.length === 0) {
    return res.status(404).json({ error: "Compte introuvable" });
  }
  const vendor = vendors[0];

  if (vendor.verified) {
    return res.status(400).json({ error: "Ce compte est déjà vérifié." });
  }

  // Throttle: max 1 OTP per 30 seconds
  const thirtySecondsAgo = new Date(Date.now() - 30 * 1000);
  const recent = await db
    .select({ id: otpCodesTable.id })
    .from(otpCodesTable)
    .where(and(eq(otpCodesTable.phone, phone), gt(otpCodesTable.createdAt, thirtySecondsAgo)))
    .limit(1);

  if (recent.length > 0) {
    return res.status(429).json({ error: "Veuillez patienter 30 secondes avant de renvoyer le code." });
  }

  try {
    const code = await generateAndStoreOTP(phone);
    const delivery = await dispatchVendorOTP(phone, code, vendor.firstName);
    req.log.info({ id: vendor.id }, "OTP resent");
    return res.json({ success: true, ...delivery });
  } catch (err) {
    req.log.error({ err }, "Failed to resend OTP");
    return res.status(500).json({ error: "Impossible de renvoyer le code. Réessayez." });
  }
});

router.post("/vendors/login", async (req, res) => {
  const parsed = VendorLoginBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.message });
  }
  // Le champ `phone` du contrat API peut contenir un numéro OU l'e-mail associé au compte.
  const identifier = parsed.data.phone.trim();
  const { password } = parsed.data;

  let vendor: Awaited<ReturnType<typeof findVendorByIdentifier>>;
  try {
    vendor = await findVendorByIdentifier(identifier);
  } catch (err) {
    req.log.error({ err }, "Failed to look up vendor for login");
    return res.status(500).json({ error: "Erreur interne" });
  }

  if (!vendor) {
    return res.status(401).json({ error: "Identifiant ou mot de passe incorrect." });
  }

  const match = await bcrypt.compare(password, vendor.passwordHash);
  if (!match) {
    return res.status(401).json({ error: "Identifiant ou mot de passe incorrect." });
  }

  try {
    const publishCode = await getActivePublishCode(vendor.id);
    await issueVendorSession(res, vendor.id);
    return res.json(VendorLoginResponse.parse(mapVendor(vendor, publishCode)));
  } catch (err) {
    req.log.error({ err }, "Failed to login vendor");
    return res.status(500).json({ error: "Erreur interne" });
  }
});

router.get("/vendors/session", async (req, res) => {
  const vendor = await authenticateVendorRequest(req);
  if (!vendor) return res.status(401).json({ error: "Session invalide ou expirée." });
  const publishCode = await getActivePublishCode(vendor.id);
  return res.json(VendorLoginResponse.parse(mapVendor(vendor, publishCode)));
});

router.post("/vendors/logout", async (req, res) => {
  await revokeVendorSession(req, res);
  return res.json({ success: true });
});

router.post("/vendors/profile/update", async (req, res) => {
  const parsed = VendorUpdateProfileBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.message });
  }
  const phone = normalizePhone(parsed.data.phone);
  const { password } = parsed.data;
  const profilePhoto = parsed.data.profilePhoto == null
    ? null
    : String(parsed.data.profilePhoto).trim() || null;
  if (profilePhoto && !isValidProfilePhotoPath(profilePhoto)) {
    return res.status(400).json({ error: "Chemin de photo de profil invalide." });
  }

  const vendor = await authenticateVendorRequest(req, { phone, password });
  if (!vendor) return res.status(401).json({ error: "Mot de passe incorrect." });

  try {
    const [updated] = await db
      .update(vendorsTable)
      .set({ profilePhoto })
      .where(eq(vendorsTable.id, vendor.id))
      .returning();
    const publishCode = await getActivePublishCode(updated.id);
    return res.json(VendorUpdateProfileResponse.parse(mapVendor(updated, publishCode)));
  } catch (err) {
    req.log.error({ err }, "Failed to update vendor profile");
    return res.status(500).json({ error: "Erreur interne" });
  }
});

router.post("/admin/vendors", async (req, res) => {
  const parsed = AdminGetVendorsBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  if (!await isSuperAdmin(parsed.data.password)) return res.status(403).json({ error: "Forbidden" });

  try {
    const vendors = await db.select().from(vendorsTable).orderBy(desc(vendorsTable.createdAt));
    const withCodes = await Promise.all(
      vendors.map(async (v) => {
        const publishCode = await getActivePublishCode(v.id);
        return mapVendor(v, publishCode);
      })
    );
    return res.json(AdminGetVendorsResponse.parse(withCodes));
  } catch (err) {
    req.log.error({ err }, "Failed to get vendors");
    return res.status(500).json({ error: "Erreur interne" });
  }
});

router.post("/admin/vendors/activate", async (req, res) => {
  const parsed = AdminActivateVendorBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  if (!await isSuperAdmin(parsed.data.password)) return res.status(403).json({ error: "Forbidden" });

  try {
    const vendors = await db.select().from(vendorsTable).where(eq(vendorsTable.id, parsed.data.vendorId)).limit(1);
    if (vendors.length === 0) return res.status(404).json({ error: "Vendeur introuvable" });

    const vendor = vendors[0];
    const now = new Date();
    const endDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const keepVipExpiry = await isVipVendor(vendor.id);
    await db.update(vendorsTable)
      .set({ verified: true, isPublished: true, validationMethod: "admin", ...(keepVipExpiry ? {} : { expiryDate: endDate }) })
      .where(eq(vendorsTable.id, vendor.id));

    const code = randomCode(4);
    await db.insert(publishCodesTable).values({ vendorId: vendor.id, code, startDate: now, endDate });

    req.log.info({ vendorId: vendor.id, code }, "Vendor activated by admin");
    return res.json(AdminActivateVendorResponse.parse({ success: true, code, vendorPhone: vendor.phone }));
  } catch (err) {
    req.log.error({ err }, "Failed to activate vendor");
    return res.status(500).json({ error: "Erreur interne" });
  }
});

router.post("/admin/vendors/generate-code", async (req, res) => {
  const parsed = AdminGenerateVendorCodeBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  if (!await isSuperAdmin(parsed.data.password)) return res.status(403).json({ error: "Forbidden" });

  try {
    const vendors = await db.select().from(vendorsTable).where(eq(vendorsTable.id, parsed.data.vendorId)).limit(1);
    if (vendors.length === 0) return res.status(404).json({ error: "Vendeur introuvable" });

    const vendor = vendors[0];
    const code = randomCode(4);
    const now = new Date();
    const endDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    await db.insert(publishCodesTable).values({ vendorId: vendor.id, code, startDate: now, endDate });

    req.log.info({ vendorId: vendor.id, code }, "New publish code generated for vendor");
    return res.json(AdminGenerateVendorCodeResponse.parse({ success: true, code, vendorPhone: vendor.phone }));
  } catch (err) {
    req.log.error({ err }, "Failed to generate vendor code");
    return res.status(500).json({ error: "Erreur interne" });
  }
});

router.post("/vendors/listings", async (req, res) => {
  const { password } = req.body;
  const phone = normalizePhone(String(req.body.phone ?? ""));
  if (!phone || !password) return res.status(400).json({ error: "Champs requis manquants" });

  const vendor = await authenticateVendorRequest(req, { phone, password });
  if (!vendor) return res.status(401).json({ error: "Mot de passe incorrect." });

  try {
    const { listingsTable } = await import("@workspace/db");
    const { eq: eqL, desc: descL } = await import("drizzle-orm");
    const listings = await db
      .select()
      .from(listingsTable)
      .where(eqL(listingsTable.phone, vendor.phone))
      .orderBy(descL(listingsTable.createdAt));

    return res.json(
      listings.map((l) => ({
        id: l.id, name: l.name, price: parseFloat(l.price),
        promoPrice: l.promoPrice != null ? parseFloat(l.promoPrice) : null,
        description: l.description ?? null,
        location: l.location, country: l.country ?? "Togo", sector: l.sector, images: l.images,
        createdAt: l.createdAt.toISOString(), phone: l.phone, approved: l.approved,
        vendorId: vendor.id, avgRating: null, reviewCount: 0,
      }))
    );
  } catch (err) {
    req.log.error({ err }, "Failed to get vendor listings");
    return res.status(500).json({ error: "Erreur interne" });
  }
});

router.post("/vendors/profile/update-name", async (req, res) => {
  const { password, firstName, lastName } = req.body;
  const shopNameRaw = req.body.shopName;
  const phone = normalizePhone(String(req.body.phone ?? ""));
  if (!phone || !password || !firstName?.trim() || !lastName?.trim()) {
    return res.status(400).json({ error: "Champs requis manquants" });
  }

  const vendor = await authenticateVendorRequest(req, { phone, password });
  if (!vendor) return res.status(401).json({ error: "Mot de passe incorrect." });

  const newShopName = shopNameRaw !== undefined
    ? (String(shopNameRaw).trim() || null)
    : vendor.shopName;

  try {
    const [updated] = await db
      .update(vendorsTable)
      .set({ firstName: firstName.trim(), lastName: lastName.trim(), shopName: newShopName })
      .where(eq(vendorsTable.id, vendor.id))
      .returning();
    const publishCode = await getActivePublishCode(updated.id);
    req.log.info({ id: vendor.id }, "Vendor name updated");
    return res.json(VendorLoginResponse.parse(mapVendor(updated, publishCode)));
  } catch (err) {
    req.log.error({ err }, "Failed to update vendor name");
    return res.status(500).json({ error: "Erreur interne" });
  }
});

router.post("/vendors/profile/change-password", async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!newPassword) {
    return res.status(400).json({ error: "Champs requis manquants" });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: "Le nouveau mot de passe doit faire au moins 6 caractères." });
  }

  const vendor = await authenticateVendorRequest(req, {
    phone: typeof req.body.phone === "string" ? req.body.phone : undefined,
    password: typeof oldPassword === "string" ? oldPassword : undefined,
  });
  if (!vendor) return res.status(401).json({ error: "Ancien mot de passe incorrect." });

  try {
    const newHash = await bcrypt.hash(newPassword, 10);
    await db.update(vendorsTable).set({ passwordHash: newHash }).where(eq(vendorsTable.id, vendor.id));
    await revokeAllVendorSessions(vendor.id);
    await issueVendorSession(res, vendor.id);
    req.log.info({ id: vendor.id }, "Vendor password changed");
    return res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to change vendor password");
    return res.status(500).json({ error: "Erreur interne" });
  }
});

// =============================================================================
// E-MAIL VENDEUR — association (vérifiée par OTP sur le téléphone) et
// réinitialisation automatique du mot de passe par e-mail (Brevo)
// =============================================================================
// Flux « mot de passe oublié » (non authentifié) :
//   1. POST /vendors/password-reset/start   { email, phone? }
//        → { status: "verified" }  e-mail déjà associé : on peut réinitialiser
//        → { status: "otp_sent" }  première association : OTP envoyé sur le téléphone du compte
//   2. POST /vendors/password-reset/verify  { email, phone, code } → associe l'e-mail → { status: "verified" }
//   3. POST /vendors/password-reset/send    { email } → mot de passe temporaire envoyé par Brevo
// Flux profil (authentifié, session ou en-têtes hérités) :
//   GET  /vendors/profile/email
//   POST /vendors/profile/email/request     { email }       → OTP sur le téléphone
//   POST /vendors/profile/email/verify      { email, code } → associe / remplace l'e-mail
// L'e-mail n'est écrit en base qu'après vérification OTP : `vendors.email` est donc toujours un e-mail vérifié.
// =============================================================================
type VendorRow = typeof vendorsTable.$inferSelect;

const resetStartLimiter = createRateLimiter({ max: 10, windowMs: 60 * 60 * 1000 });
const resetVerifyLimiter = createRateLimiter({ max: 30, windowMs: 60 * 60 * 1000 });
const resetSendIpLimiter = createRateLimiter({ max: 5, windowMs: 60 * 60 * 1000 });
const resetSendVendorLimiter = createRateLimiter({ max: 3, windowMs: 60 * 60 * 1000 });
const profileEmailLimiter = createRateLimiter({ max: 15, windowMs: 60 * 60 * 1000 });

const EMAIL_ALREADY_USED = "Cet e-mail est déjà lié à un autre compte vendeur.";
const OTP_INVALID = "Code expiré ou invalide. Demandez un nouveau code.";
const OTP_THROTTLED = "Veuillez patienter 30 secondes avant de renvoyer le code.";

async function findVendorByEmail(email: string): Promise<VendorRow | null> {
  const [vendor] = await db.select().from(vendorsTable).where(eq(vendorsTable.email, email)).limit(1);
  return vendor ?? null;
}

async function findVendorByPhone(rawPhone: string): Promise<VendorRow | null> {
  const [vendor] = await db.select().from(vendorsTable).where(phoneEq(vendorsTable.phone, normalizePhone(rawPhone))).limit(1);
  return vendor ?? null;
}

/** Envoie un OTP sur le téléphone du compte (anti-spam : 1 code toutes les 30 secondes). */
async function sendEmailAssociationOtp(vendor: VendorRow): Promise<
  { throttled: true } | { throttled: false; provider: string; sent: boolean }
> {
  const phone = normalizePhone(vendor.phone);
  const thirtySecondsAgo = new Date(Date.now() - 30 * 1000);
  const recent = await db
    .select({ id: otpCodesTable.id })
    .from(otpCodesTable)
    .where(and(eq(otpCodesTable.phone, phone), gt(otpCodesTable.createdAt, thirtySecondsAgo)))
    .limit(1);
  if (recent.length > 0) return { throttled: true };

  const code = await generateAndStoreOTP(phone);
  const delivery = await dispatchVendorOTP(phone, code, vendor.firstName);
  return { throttled: false, provider: delivery.provider, sent: delivery.sent };
}

/** Vérifie et consomme un OTP (3 essais max, usage unique). Renvoie un message d'erreur, ou null si le code est bon. */
async function consumeVendorOtp(rawPhone: string, code: string): Promise<string | null> {
  const phone = normalizePhone(rawPhone);
  const [otp] = await db
    .select()
    .from(otpCodesTable)
    .where(
      and(
        eq(otpCodesTable.phone, phone),
        eq(otpCodesTable.used, false),
        gt(otpCodesTable.expiresAt, new Date()),
        lt(otpCodesTable.attempts, 3),
      ),
    )
    .orderBy(desc(otpCodesTable.createdAt))
    .limit(1);
  if (!otp) return OTP_INVALID;

  if (otp.code !== code) {
    await db.update(otpCodesTable).set({ attempts: otp.attempts + 1 }).where(eq(otpCodesTable.id, otp.id));
    const remaining = 2 - otp.attempts;
    return `Code incorrect. ${remaining > 0 ? `${remaining} tentative(s) restante(s).` : "Demandez un nouveau code."}`;
  }

  // Consommation atomique : un même code ne peut pas servir deux fois en parallèle.
  const claimed = await db
    .update(otpCodesTable)
    .set({ used: true })
    .where(and(eq(otpCodesTable.id, otp.id), eq(otpCodesTable.used, false)))
    .returning({ id: otpCodesTable.id });
  return claimed.length > 0 ? null : OTP_INVALID;
}

/** Écrit l'e-mail (déjà vérifié) sur le compte ; l'index unique protège contre une course entre deux comptes. */
async function associateEmail(vendorId: number, email: string): Promise<"ok" | "taken"> {
  try {
    await db.update(vendorsTable).set({ email }).where(eq(vendorsTable.id, vendorId));
    return "ok";
  } catch (err) {
    if (isUniqueViolation(err)) return "taken";
    throw err;
  }
}

router.post("/vendors/password-reset/start", async (req, res) => {
  if (resetStartLimiter.hit(req.ip ?? "inconnue")) {
    return res.status(429).json({ error: "Trop de demandes. Réessayez dans une heure." });
  }
  const email = normalizeEmail(String(req.body?.email ?? ""));
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: "Adresse e-mail invalide." });
  }
  const rawPhone = String(req.body?.phone ?? "").trim();

  try {
    const linked = await findVendorByEmail(email);
    if (linked) {
      // E-mail déjà associé : si le vendeur a aussi saisi un numéro, il doit être celui de ce compte.
      if (rawPhone && normalizePhone(linked.phone) !== normalizePhone(rawPhone)) {
        return res.status(409).json({ error: EMAIL_ALREADY_USED });
      }
      return res.json({ status: "verified" });
    }

    // Première association : le numéro du compte est indispensable pour envoyer l'OTP.
    if (!rawPhone) {
      return res.status(400).json({ error: "Saisissez le numéro de votre compte vendeur pour associer cet e-mail." });
    }
    const vendor = await findVendorByPhone(rawPhone);
    if (!vendor) {
      return res.status(404).json({ error: "Aucun compte vendeur avec ce numéro." });
    }
    if (!vendor.verified) {
      return res.status(403).json({ error: "Ce compte n'est pas encore activé. Terminez d'abord la vérification de votre numéro." });
    }

    const otp = await sendEmailAssociationOtp(vendor);
    if (otp.throttled) return res.status(429).json({ error: OTP_THROTTLED });
    req.log.info({ id: vendor.id }, "Password reset: e-mail association OTP requested");
    return res.json({ status: "otp_sent", phoneMasked: maskPhone(vendor.phone), provider: otp.provider, sent: otp.sent });
  } catch (err) {
    req.log.error({ err }, "Failed to start vendor password reset");
    return res.status(500).json({ error: "Erreur interne" });
  }
});

router.post("/vendors/password-reset/verify", async (req, res) => {
  if (resetVerifyLimiter.hit(req.ip ?? "inconnue")) {
    return res.status(429).json({ error: "Trop de tentatives. Réessayez dans une heure." });
  }
  const email = normalizeEmail(String(req.body?.email ?? ""));
  const rawPhone = String(req.body?.phone ?? "").trim();
  const code = String(req.body?.code ?? "").trim();
  if (!isValidEmail(email)) return res.status(400).json({ error: "Adresse e-mail invalide." });
  if (!rawPhone || !code) return res.status(400).json({ error: "Numéro et code requis" });

  try {
    const vendor = await findVendorByPhone(rawPhone);
    if (!vendor) return res.status(404).json({ error: "Compte introuvable" });
    if (!vendor.verified) return res.status(403).json({ error: "Ce compte n'est pas encore activé." });

    const owner = await findVendorByEmail(email);
    if (owner && owner.id !== vendor.id) return res.status(409).json({ error: EMAIL_ALREADY_USED });
    if (owner) return res.json({ status: "verified" });

    const otpError = await consumeVendorOtp(vendor.phone, code);
    if (otpError) return res.status(400).json({ error: otpError });

    if (await associateEmail(vendor.id, email) === "taken") {
      return res.status(409).json({ error: EMAIL_ALREADY_USED });
    }
    req.log.info({ id: vendor.id }, "Vendor e-mail associated (password reset flow)");
    return res.json({ status: "verified" });
  } catch (err) {
    req.log.error({ err }, "Failed to verify vendor e-mail association");
    return res.status(500).json({ error: "Erreur interne" });
  }
});

router.post("/vendors/password-reset/send", async (req, res) => {
  if (resetSendIpLimiter.hit(req.ip ?? "inconnue")) {
    return res.status(429).json({ error: "Trop de demandes. Réessayez dans une heure." });
  }
  const email = normalizeEmail(String(req.body?.email ?? ""));
  if (!isValidEmail(email)) return res.status(400).json({ error: "Adresse e-mail invalide." });
  if (!isBrevoConfigured()) {
    req.log.error("Password reset requested but Brevo is not configured");
    return res.status(503).json({ error: "L'envoi d'e-mails est momentanément indisponible. Utilisez « Autre méthode »." });
  }

  try {
    // `vendors.email` ne contient que des e-mails vérifiés : le mot de passe part uniquement vers la boîte du propriétaire.
    const vendor = await findVendorByEmail(email);
    if (!vendor) {
      return res.status(404).json({ error: "Cet e-mail n'est associé à aucun compte vendeur. Vérifiez-le d'abord." });
    }
    if (resetSendVendorLimiter.hit(String(vendor.id))) {
      return res.status(429).json({ error: "Plusieurs mots de passe temporaires ont déjà été envoyés. Consultez votre boîte e-mail (spams compris) ou réessayez dans une heure." });
    }

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);

    // L'e-mail part AVANT la mise à jour : si l'envoi échoue, l'ancien mot de passe reste valable (pas de compte verrouillé).
    try {
      await sendVendorTemporaryPasswordEmail({ to: email, firstName: vendor.firstName, temporaryPassword });
    } catch (err) {
      req.log.error({ err, id: vendor.id }, "Brevo: échec d'envoi du mot de passe temporaire");
      return res.status(502).json({ error: "L'e-mail n'a pas pu être envoyé. Réessayez ou utilisez « Autre méthode »." });
    }

    await db.update(vendorsTable).set({ passwordHash }).where(eq(vendorsTable.id, vendor.id));
    await revokeAllVendorSessions(vendor.id);
    req.log.info({ id: vendor.id }, "Vendor password reset by e-mail (temporary password sent)");
    return res.json({ success: true, emailMasked: maskEmail(email) });
  } catch (err) {
    req.log.error({ err }, "Failed to reset vendor password by e-mail");
    return res.status(500).json({ error: "Erreur interne" });
  }
});

router.get("/vendors/profile/email", async (req, res) => {
  const vendor = await authenticateVendorRequest(req);
  if (!vendor) return res.status(401).json({ error: "Session invalide ou expirée." });
  return res.json({ email: vendor.email ?? null });
});

router.post("/vendors/profile/email/request", async (req, res) => {
  const vendor = await authenticateVendorRequest(req);
  if (!vendor) return res.status(401).json({ error: "Session invalide ou expirée." });
  if (!vendor.verified) return res.status(403).json({ error: "Ce compte n'est pas encore activé." });
  if (profileEmailLimiter.hit(`request:${vendor.id}`)) {
    return res.status(429).json({ error: "Trop de demandes. Réessayez dans une heure." });
  }
  const email = normalizeEmail(String(req.body?.email ?? ""));
  if (!isValidEmail(email)) return res.status(400).json({ error: "Adresse e-mail invalide." });
  if (vendor.email === email) return res.status(400).json({ error: "Cet e-mail est déjà associé à votre compte." });

  try {
    if (await findVendorByEmail(email)) return res.status(409).json({ error: EMAIL_ALREADY_USED });

    const otp = await sendEmailAssociationOtp(vendor);
    if (otp.throttled) return res.status(429).json({ error: OTP_THROTTLED });
    return res.json({ status: "otp_sent", phoneMasked: maskPhone(vendor.phone), provider: otp.provider, sent: otp.sent });
  } catch (err) {
    req.log.error({ err }, "Failed to request vendor e-mail association");
    return res.status(500).json({ error: "Erreur interne" });
  }
});

router.post("/vendors/profile/email/verify", async (req, res) => {
  const vendor = await authenticateVendorRequest(req);
  if (!vendor) return res.status(401).json({ error: "Session invalide ou expirée." });
  if (!vendor.verified) return res.status(403).json({ error: "Ce compte n'est pas encore activé." });
  if (profileEmailLimiter.hit(`verify:${vendor.id}`)) {
    return res.status(429).json({ error: "Trop de tentatives. Réessayez dans une heure." });
  }
  const email = normalizeEmail(String(req.body?.email ?? ""));
  const code = String(req.body?.code ?? "").trim();
  if (!isValidEmail(email)) return res.status(400).json({ error: "Adresse e-mail invalide." });
  if (!code) return res.status(400).json({ error: "Code requis" });

  try {
    const owner = await findVendorByEmail(email);
    if (owner && owner.id !== vendor.id) return res.status(409).json({ error: EMAIL_ALREADY_USED });

    const otpError = await consumeVendorOtp(vendor.phone, code);
    if (otpError) return res.status(400).json({ error: otpError });

    if (await associateEmail(vendor.id, email) === "taken") {
      return res.status(409).json({ error: EMAIL_ALREADY_USED });
    }
    req.log.info({ id: vendor.id }, "Vendor e-mail updated from profile");
    return res.json({ status: "verified", email });
  } catch (err) {
    req.log.error({ err }, "Failed to verify vendor e-mail from profile");
    return res.status(500).json({ error: "Erreur interne" });
  }
});

// =============================================================================
// LIEN DE RENOUVELLEMENT — Utilisé dans le bouton CTA des rappels WhatsApp
// =============================================================================
// GET /api/vendors/renewal-link/:vendorId
// Crée une transaction FedaPay pour le vendeur et redirige vers la page de paiement.
// Ce lien est envoyé dans les rappels WhatsApp 3 jours avant l'expiration.
// Sécurité : la création de transaction FedaPay est gratuite — le vendeur doit
// quand même payer pour que son abonnement soit renouvelé.
// =============================================================================
const FEDAPAY_SECRET_KEY_V = process.env.FEDAPAY_SECRET_KEY ?? "";
const FEDAPAY_PUBLIC_KEY_V = process.env.FEDAPAY_PUBLIC_KEY ?? "";

function getFedapayBaseUrlV(): string {
  return FEDAPAY_PUBLIC_KEY_V.startsWith("pk_live")
    ? "https://api.fedapay.com/v1"
    : "https://sandbox-api.fedapay.com/v1";
}

router.get("/vendors/renewal-link/:vendorId", async (req, res) => {
  const vendorId = parseInt(req.params.vendorId, 10);
  if (isNaN(vendorId) || vendorId <= 0) {
    return res.status(400).send("Identifiant vendeur invalide");
  }
  if (!verifyVendorRenewalToken(vendorId, String(req.query.token ?? ""))) {
    return res.status(403).send("Lien de renouvellement invalide ou expiré");
  }

  const vendors = await db.select().from(vendorsTable).where(eq(vendorsTable.id, vendorId)).limit(1);
  if (vendors.length === 0) {
    return res.status(404).send("Boutique introuvable");
  }
  const vendor = vendors[0];

  try {
    const callbackUrl = `https://togomarket.site/api/fedapay-callback`;
    const txRes = await fedapayFetch(`${getFedapayBaseUrlV()}/transactions`, {
      method: "POST",
      headers: fedapayHeaders(FEDAPAY_SECRET_KEY_V),
      body: JSON.stringify({
        description: `Renouvellement abonnement TogoMarket — boutique #${vendor.id}`,
        amount: 1000,
        currency: { iso: "XOF" },
        callback_url: callbackUrl,
        customer: {
          firstname: `${vendor.firstName} ${vendor.lastName}`,
          phone_number: { number: vendor.phone, country: getPhoneCountry(vendor.phone) },
        },
        custom_metadata: { entityType: "vendor", entityId: String(vendor.id) },
        include_fees: true,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!txRes.ok) {
      const errText = await txRes.text().catch(() => "");
      req.log.error({ vendorId, status: txRes.status, errText }, "Renewal link: FedaPay error");
      return res.redirect("https://togomarket.site");
    }

    const json = await txRes.json() as Record<string, unknown>;
    const txRaw = (
      json["v1/transaction"] ??
      (json["v1"] as Record<string, unknown> | undefined)?.["transaction"] ??
      json["transaction"] ?? json
    ) as Record<string, unknown>;
    const paymentUrl = String(txRaw["payment_url"] ?? "");
    const transactionId = String(txRaw["id"] ?? "");

    if (!paymentUrl || !transactionId) {
      req.log.error({ vendorId, json }, "Renewal link: no payment_url in FedaPay response");
      return res.redirect("https://togomarket.site");
    }
    await db
      .update(vendorsTable)
      .set({ fedapayTransactionId: transactionId })
      .where(eq(vendorsTable.id, vendor.id));

    req.log.info({ vendorId }, "Renewal link: redirecting to FedaPay payment page");
    return res.redirect(302, paymentUrl);
  } catch (err) {
    req.log.error({ err, vendorId }, "Renewal link: unexpected error, fallback redirect");
    return res.redirect("https://togomarket.site");
  }
});

router.get("/vendors/shop-status", async (req, res) => {
  const vendorId = parseInt(String(req.query.vendorId ?? ""), 10);

  if (isNaN(vendorId) || vendorId <= 0) {
    return res.status(400).json({ error: "Paramètres manquants ou invalides" });
  }

  try {
    const vendorRows = await db
      .select()
      .from(vendorsTable)
      .where(eq(vendorsTable.id, vendorId))
      .limit(1);

    if (vendorRows.length === 0) return res.json({ active: false, exists: false });

    const vendor = vendorRows[0];
    const now = new Date();
    // La validité du lien de boutique est liée à la durée de l'abonnement actif
    // (isPublished + expiryDate), et non plus au code de publication (obsolète).
    const isActive = vendor.isPublished && (!vendor.expiryDate || vendor.expiryDate > now);

    return res.json({ active: isActive, exists: true, vendorId, firstName: vendor.firstName });
  } catch (err) {
    req.log.error({ err }, "Failed to check shop status");
    return res.status(500).json({ error: "Erreur interne" });
  }
});

const VALID_SECTORS = ["Tourisme", "AgriMarket", "Immobilier", "Automobile", "Repas", "Divers"] as const;

router.get("/vendors/sector/:sector", async (req, res) => {
  const { sector } = req.params;
  if (!VALID_SECTORS.includes(sector as (typeof VALID_SECTORS)[number])) {
    return res.status(400).json({ error: "Secteur invalide" });
  }
  try {
    const vendors = await db
      .selectDistinct({
        id: vendorsTable.id,
        firstName: vendorsTable.firstName,
        lastName: vendorsTable.lastName,
        shopName: vendorsTable.shopName,
        profilePhoto: vendorsTable.profilePhoto,
      })
      .from(vendorsTable)
      .innerJoin(listingsTable, eq(listingsTable.phone, vendorsTable.phone))
      .where(and(
        eq(listingsTable.sector, sector),
        eq(listingsTable.approved, true),
        eq(vendorsTable.isPublished, true),
        gt(vendorsTable.expiryDate, new Date()),
      ))
      .orderBy(vendorsTable.id);
    return res.json(vendors.map((vendor) => ({
      ...vendor,
      profilePhoto: normalizeProfilePhoto(vendor.profilePhoto),
    })));
  } catch (err) {
    req.log.error({ err }, "Failed to get vendors by sector");
    return res.status(500).json({ error: "Erreur interne" });
  }
});

router.post("/admin/vendors/reset-password", async (req, res) => {
  const parsed = AdminResetVendorPasswordBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  if (!await isSuperAdmin(parsed.data.password)) return res.status(403).json({ error: "Forbidden" });

  const normalizedPhone = normalizePhone(parsed.data.vendorPhone);
  try {
    const existing = await db.select({ id: vendorsTable.id }).from(vendorsTable).where(phoneEq(vendorsTable.phone, normalizedPhone)).limit(1);
    if (existing.length === 0) return res.status(404).json({ error: "Vendeur introuvable" });

    const hashedPassword = await bcrypt.hash(parsed.data.newPassword, 10);
    await db.update(vendorsTable).set({ passwordHash: hashedPassword }).where(phoneEq(vendorsTable.phone, normalizedPhone));

    req.log.info({ phone: normalizedPhone }, "Vendor password reset by admin");
    return res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to reset vendor password");
    return res.status(500).json({ error: "Erreur interne" });
  }
});

router.post("/admin/vendors/delete", async (req, res) => {
  const parsed = AdminDeleteVendorBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  if (!await isSuperAdmin(parsed.data.password)) return res.status(403).json({ error: "Forbidden" });

  try {
    const existing = await db.select({ id: vendorsTable.id }).from(vendorsTable).where(eq(vendorsTable.id, parsed.data.vendorId)).limit(1);
    if (existing.length === 0) return res.status(404).json({ error: "Vendeur introuvable" });

    await db.delete(publishCodesTable).where(eq(publishCodesTable.vendorId, parsed.data.vendorId));
    await db.delete(vendorsTable).where(eq(vendorsTable.id, parsed.data.vendorId));

    req.log.info({ vendorId: parsed.data.vendorId }, "Vendor deleted by admin");
    return res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete vendor");
    return res.status(500).json({ error: "Erreur interne" });
  }
});

/* ──────────────────────────────────────────────────────────────
   BROADCAST INBOX — Super-admin lit les réponses vendeurs
   ────────────────────────────────────────────────────────────── */

// POST /api/admin/broadcast-inbox  — liste des conversations broadcast avec info vendeur
router.post("/admin/broadcast-inbox", async (req, res) => {
  const { password } = req.body as { password?: string };
  if (!await isSuperAdmin(password ?? "")) return res.status(403).json({ error: "superadmin only" });

  const convs = await db
    .select({
      id: conversationsTable.id,
      vendorId: conversationsTable.vendorId,
      vendorFirstName: vendorsTable.firstName,
      vendorLastName: vendorsTable.lastName,
      vendorPhone: vendorsTable.phone,
      updatedAt: conversationsTable.updatedAt,
      adminUnreadCount: conversationsTable.adminUnreadCount,
    })
    .from(conversationsTable)
    .innerJoin(vendorsTable, eq(conversationsTable.vendorId, vendorsTable.id))
    .where(eq(conversationsTable.buyerPhone, "##007##"))
    .orderBy(desc(conversationsTable.updatedAt));

  if (!convs.length) return res.json({ conversations: [] });

  // Récupérer le dernier message par conversation en 2 requêtes (pas de N+1)
  const convIds = convs.map(c => c.id);
  const maxMsgIds = await db
    .select({
      conversationId: messagesTable.conversationId,
      maxId: sql<number>`MAX(${messagesTable.id})`.as("max_id"),
    })
    .from(messagesTable)
    .where(and(inArray(messagesTable.conversationId, convIds), isNull(messagesTable.deletedAt)))
    .groupBy(messagesTable.conversationId);

  const lastMessages = maxMsgIds.length > 0
    ? await db.select({
        id: messagesTable.id,
        conversationId: messagesTable.conversationId,
        content: messagesTable.content,
        fileType: messagesTable.fileType,
        senderType: messagesTable.senderType,
      })
      .from(messagesTable)
      .where(inArray(messagesTable.id, maxMsgIds.map(r => r.maxId)))
    : [];

  const lastMsgMap = new Map(lastMessages.map(m => [m.conversationId, m]));
  const result = convs.map(c => ({
    ...c,
    lastMessage: lastMsgMap.get(c.id)?.content ?? null,
    lastFileType: lastMsgMap.get(c.id)?.fileType ?? null,
    lastSenderType: lastMsgMap.get(c.id)?.senderType ?? null,
  }));

  return res.json({ conversations: result });
});

// POST /api/admin/broadcast-inbox/:id/messages  — messages d'une conversation
router.post("/admin/broadcast-inbox/:id/messages", async (req, res) => {
  const { password } = req.body as { password?: string };
  if (!await isSuperAdmin(password ?? "")) return res.status(403).json({ error: "superadmin only" });

  const convId = parseInt(req.params["id"] ?? "", 10);
  if (isNaN(convId)) return res.status(400).json({ error: "invalid id" });

  const [conv] = await db.select({ id: conversationsTable.id })
    .from(conversationsTable)
    .where(and(eq(conversationsTable.id, convId), eq(conversationsTable.buyerPhone, "##007##")))
    .limit(1);
  if (!conv) return res.status(404).json({ error: "conversation not found" });

  const msgs = await db.select(compatibleMessageColumns)
    .from(messagesTable)
    .where(and(eq(messagesTable.conversationId, convId), isNull(messagesTable.deletedAt)))
    .orderBy(messagesTable.createdAt);

  return res.json({
    messages: msgs.map((message) => secureMessageFileUrl(withMessageListingContext(message))),
  });
});

// POST /api/admin/broadcast-inbox/:id/reply  — admin répond en tant que TogoMarket
router.post("/admin/broadcast-inbox/:id/reply", async (req, res) => {
  const { password, content } = req.body as { password?: string; content?: string };
  if (!await isSuperAdmin(password ?? "")) return res.status(403).json({ error: "superadmin only" });
  if (!content?.trim()) return res.status(400).json({ error: "content required" });

  const convId = parseInt(req.params["id"] ?? "", 10);
  if (isNaN(convId)) return res.status(400).json({ error: "invalid id" });

  const [conv] = await db.select()
    .from(conversationsTable)
    .where(and(eq(conversationsTable.id, convId), eq(conversationsTable.buyerPhone, "##007##")))
    .limit(1);
  if (!conv) return res.status(404).json({ error: "conversation not found" });

  const [msg] = await db.insert(compatibleMessagesInsertTable).values({
    conversationId: convId,
    senderType: "buyer",
    content: content.trim(),
  }).returning(compatibleMessageInsertColumns);

  const [conversationState] = await db.update(conversationsTable).set({
    updatedAt: new Date(),
    vendorUnreadCount: sql`${conversationsTable.vendorUnreadCount} + 1`,
    vendorDeletedAt: null,
  }).where(eq(conversationsTable.id, convId)).returning({
    updatedAt: conversationsTable.updatedAt,
    vendorUnreadCount: conversationsTable.vendorUnreadCount,
    buyerUnreadCount: conversationsTable.buyerUnreadCount,
    adminUnreadCount: conversationsTable.adminUnreadCount,
  });

  try {
    const io = getIo();
    io.to(`vendor:${conv.vendorId}`).emit("new_message", {
      conversationId: convId,
      message: msg,
      conversation: conversationState,
    });
  } catch { /* non-fatal */ }

  return res.status(201).json({ message: msg });
});

// POST /api/admin/broadcast-inbox/:id/upload  — admin envoie un fichier (image/pdf/audio)
router.post(
  "/admin/broadcast-inbox/:id/upload",
  adminUpload.single("file"),
  async (req, res) => {
    const { password } = req.body as { password?: string };
    if (!await isSuperAdmin(password ?? "")) return res.status(403).json({ error: "superadmin only" });

    const rawConversationId = req.params["id"];
    const convId = parseInt(Array.isArray(rawConversationId) ? rawConversationId[0] ?? "" : rawConversationId ?? "", 10);
    if (isNaN(convId)) return res.status(400).json({ error: "invalid id" });

    const file = req.file;
    if (!file) return res.status(400).json({ error: "file required" });

    let safeFile;
    try {
      safeFile = validateFileBytes(file.buffer, file.mimetype, ["image", "audio", "pdf"]);
    } catch {
      return res.status(400).json({ error: "Le contenu réel du fichier n'est pas autorisé" });
    }
    if (safeFile.kind === "image" && file.size > 2 * 1024 * 1024) {
      return res.status(400).json({ error: "L'image dépasse la limite de 2 Mo" });
    }
    const fileType = safeFile.kind;

    const [conv] = await db.select()
      .from(conversationsTable)
      .where(and(eq(conversationsTable.id, convId), eq(conversationsTable.buyerPhone, "##007##")))
      .limit(1);
    if (!conv) return res.status(404).json({ error: "conversation not found" });

    const objectPath = await uploadCloudinaryMedia(file.buffer, fileType, `conversation:${convId}`, true);
    let msg;
    try {
      [msg] = await db.insert(compatibleMessagesInsertTable).values({
        conversationId: convId,
        senderType: "buyer",
        fileUrl: objectPath,
        fileType,
        content: null,
      }).returning(compatibleMessageInsertColumns);
    } catch (error) {
      await deleteCloudinaryMedia(objectPath).catch(() => {});
      throw error;
    }

    const [conversationState] = await db.update(conversationsTable).set({
      updatedAt: new Date(),
      vendorUnreadCount: sql`${conversationsTable.vendorUnreadCount} + 1`,
      vendorDeletedAt: null,
    }).where(eq(conversationsTable.id, convId)).returning({
      updatedAt: conversationsTable.updatedAt,
      vendorUnreadCount: conversationsTable.vendorUnreadCount,
      buyerUnreadCount: conversationsTable.buyerUnreadCount,
      adminUnreadCount: conversationsTable.adminUnreadCount,
    });

    try {
      const io = getIo();
      io.to(`vendor:${conv.vendorId}`).emit("new_message", {
        conversationId: convId,
        message: secureMessageFileUrl(msg),
        conversation: conversationState,
      });
    } catch { /* non-fatal */ }

    return res.status(201).json({ message: secureMessageFileUrl(msg) });
  },
);

// POST /api/admin/broadcast-inbox/:convId/messages/:msgId/edit  — modifier un message TogoMarket
router.post("/admin/broadcast-inbox/:convId/messages/:msgId/edit", async (req, res) => {
  const { password, content } = req.body as { password?: string; content?: string };
  if (!await isSuperAdmin(password ?? "")) return res.status(403).json({ error: "superadmin only" });
  if (!content?.trim()) return res.status(400).json({ error: "content required" });

  const convId = parseInt(req.params["convId"] ?? "", 10);
  const msgId = parseInt(req.params["msgId"] ?? "", 10);
  if (isNaN(convId) || isNaN(msgId)) return res.status(400).json({ error: "invalid id" });

  const [conv] = await db.select({ id: conversationsTable.id, vendorId: conversationsTable.vendorId })
    .from(conversationsTable)
    .where(and(eq(conversationsTable.id, convId), eq(conversationsTable.buyerPhone, "##007##")))
    .limit(1);
  if (!conv) return res.status(404).json({ error: "conversation not found" });

  const [msg] = await db.select(compatibleMessageColumns).from(messagesTable)
    .where(and(eq(messagesTable.id, msgId), eq(messagesTable.conversationId, convId))).limit(1);
  if (!msg || msg.deletedAt) return res.status(404).json({ error: "message not found" });
  if (msg.fileUrl) return res.status(400).json({ error: "cannot edit file messages" });
  if (msg.senderType !== "buyer") return res.status(403).json({ error: "can only edit TogoMarket messages" });

  const editedAt = new Date();
  await db.update(messagesTable).set({ content: content.trim(), editedAt }).where(eq(messagesTable.id, msgId));

  try {
    const io = getIo();
    io.to(`vendor:${conv.vendorId}`).emit("message_edited", {
      messageId: msgId, content: content.trim(), editedAt: editedAt.toISOString(), conversationId: convId,
    });
  } catch { /* non-fatal */ }

  return res.json({ content: content.trim(), editedAt: editedAt.toISOString() });
});

// POST /api/admin/broadcast-inbox/:convId/messages/:msgId/delete  — supprimer pour les deux parties
router.post("/admin/broadcast-inbox/:convId/messages/:msgId/delete", async (req, res) => {
  const { password } = req.body as { password?: string };
  if (!await isSuperAdmin(password ?? "")) return res.status(403).json({ error: "superadmin only" });

  const convId = parseInt(req.params["convId"] ?? "", 10);
  const msgId = parseInt(req.params["msgId"] ?? "", 10);
  if (isNaN(convId) || isNaN(msgId)) return res.status(400).json({ error: "invalid id" });

  const [conv] = await db.select({ id: conversationsTable.id, vendorId: conversationsTable.vendorId })
    .from(conversationsTable)
    .where(and(eq(conversationsTable.id, convId), eq(conversationsTable.buyerPhone, "##007##")))
    .limit(1);
  if (!conv) return res.status(404).json({ error: "conversation not found" });

  const [msg] = await db.select(compatibleMessageColumns).from(messagesTable)
    .where(and(eq(messagesTable.id, msgId), eq(messagesTable.conversationId, convId))).limit(1);
  if (!msg) return res.status(404).json({ error: "message not found" });
  if (msg.deletedAt) return res.status(410).json({ error: "already deleted" });

  await db.update(messagesTable).set({ deletedAt: new Date() }).where(eq(messagesTable.id, msgId));

  try {
    const io = getIo();
    io.to(`vendor:${conv.vendorId}`).emit("message_deleted", { messageId: msgId, conversationId: convId });
    io.to(`conv:${convId}`).emit("message_deleted", { messageId: msgId, conversationId: convId });
  } catch { /* non-fatal */ }

  return res.json({ ok: true });
});

// POST /api/admin/broadcast-inbox/:id/read  — marquer comme lu (reset adminUnreadCount)
router.post("/admin/broadcast-inbox/:id/read", async (req, res) => {
  const { password } = req.body as { password?: string };
  if (!await isSuperAdmin(password ?? "")) return res.status(403).json({ error: "superadmin only" });

  const convId = parseInt(req.params["id"] ?? "", 10);
  if (isNaN(convId)) return res.status(400).json({ error: "invalid id" });

  await db.update(conversationsTable)
    .set({ adminUnreadCount: 0 })
    .where(and(eq(conversationsTable.id, convId), eq(conversationsTable.buyerPhone, "##007##")));

  return res.json({ ok: true });
});

/* ──────────────────────────────────────────────────────────────
   POST /api/admin/broadcast-message
   Superadmin only — sends a message from "TogoMarket" to every verified vendor.
   Uses or creates one TogoMarket conversation per vendor, then appends the message.
   Body: { password: string, message: string }
   ────────────────────────────────────────────────────────────── */
router.post("/admin/broadcast-message", async (req, res) => {
  const { password, message } = req.body as { password?: string; message?: string };
  if (!password || !message?.trim()) {
    return res.status(400).json({ error: "password and message required" });
  }

  const isSuper = await isSuperAdmin(password);
  if (!isSuper) {
    return res.status(403).json({ error: "superadmin only" });
  }

  const allVendors = await db
    .select({ id: vendorsTable.id, wantsNotifications: vendorsTable.wantsNotifications })
    .from(vendorsTable)
    .where(eq(vendorsTable.verified, true));

  let io: ReturnType<typeof getIo> | null = null;
  try { io = getIo(); } catch { /* socket not ready – non-fatal */ }

  // Réponse immédiate : envoyer à des centaines de vendeurs prend plusieurs minutes, ce qui dépasse
  // le délai du proxy / d'une connexion mobile et faisait afficher « Erreur lors de l'envoi ».
  // La livraison continue en arrière-plan sur le serveur (voir plus bas).
  res.json({ ok: true, sent: allVendors.length, queued: true });

  const deliverToVendor = async (vendor: (typeof allVendors)[number]): Promise<boolean> => {
    try {
      // Reuse the most recent TogoMarket conversation or create a fresh one
      const existing = await db
        .select({ id: conversationsTable.id })
        .from(conversationsTable)
        .where(and(eq(conversationsTable.vendorId, vendor.id), eq(conversationsTable.buyerPhone, "##007##")))
        .orderBy(desc(conversationsTable.createdAt))
        .limit(1);

      let convId: number;

      if (existing.length > 0) {
        convId = existing[0].id;
      } else {
        const [conv] = await db.insert(conversationsTable).values({
          vendorId: vendor.id,
          buyerName: "TogoMarket",
          buyerPhone: "##007##",
          buyerToken: randomUUID(),
        }).returning({ id: conversationsTable.id });
        convId = conv.id;
      }

      const [msg] = await db.insert(compatibleMessagesInsertTable).values({
        conversationId: convId,
        senderType: "buyer",
        content: message.trim(),
      }).returning(compatibleMessageInsertColumns);

      // Notifier le vendeur par push même si son application est fermée
      if (vapidReady && vendor.wantsNotifications) {
        try {
          const subs = await db
            .select()
            .from(pushSubscriptionsTable)
            .where(eq(pushSubscriptionsTable.vendorId, vendor.id));

          if (subs.length > 0) {
            const payload = JSON.stringify({
              title: "💬 TogoMarket",
              body: message.trim().length > 80 ? message.trim().slice(0, 80) + "…" : message.trim(),
              conversationId: convId,
            });

            await Promise.allSettled(
              subs.map((sub) =>
                webpush.sendNotification(
                  { endpoint: sub.endpoint, keys: sub.keys as { auth: string; p256dh: string } },
                  payload,
                ).catch(async (err: { statusCode?: number }) => {
                  if (err.statusCode === 404 || err.statusCode === 410) {
                    await db
                      .delete(pushSubscriptionsTable)
                      .where(and(
                        eq(pushSubscriptionsTable.endpoint, sub.endpoint),
                        eq(pushSubscriptionsTable.vendorId, vendor.id),
                      ));
                  }
                }),
              ),
            );
          }
        } catch (err) {
          logger.warn({ err, vendorId: vendor.id }, "Notification push broadcast vendeur : erreur non fatale");
        }
      }

      // Reset vendor-deleted flag so broadcast always surfaces
      await db.update(conversationsTable).set({
        updatedAt: new Date(),
        vendorUnreadCount: sql`${conversationsTable.vendorUnreadCount} + 1`,
        vendorDeletedAt: null,
      }).where(eq(conversationsTable.id, convId));

      io?.to(`vendor:${vendor.id}`).emit("new_message", { conversationId: convId, message: msg });

      return true;
    } catch (err) {
      // Non-fatal: skip this vendor and continue
      logger.warn({ err, vendorId: vendor.id }, "Broadcast : échec pour ce vendeur (non fatal)");
      return false;
    }
  };

  // Livraison en arrière-plan, par lots de 5 vendeurs en parallèle (plus rapide, sans saturer la base)
  void (async () => {
    const BATCH_SIZE = 5;
    let sent = 0;
    for (let i = 0; i < allVendors.length; i += BATCH_SIZE) {
      const results = await Promise.all(allVendors.slice(i, i + BATCH_SIZE).map(deliverToVendor));
      sent += results.filter(Boolean).length;
    }
    logger.info({ sent, total: allVendors.length }, "Broadcast terminé");
  })().catch((err) => logger.error({ err }, "Broadcast : erreur inattendue"));
});

export default router;
