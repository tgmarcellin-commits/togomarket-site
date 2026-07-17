import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { db, adminAccountsTable, vendorsTable, adsTable, eventsTable, servicesTable, publishCodesTable } from "@workspace/db";
import { eq, and, lt, gte, lte, sql, count } from "drizzle-orm";
import { isSuperAdmin, verifyAdminCode, getAdminRole, initDefaultSuperAdmin } from "../lib/admin-auth";
import { isAdminOrSubAdmin } from "../lib/auth-sub";

const router: IRouter = Router();

initDefaultSuperAdmin().catch(() => {});

router.post("/admin/login", async (req, res): Promise<void> => {
  const { code } = req.body;
  if (!code) {
    res.status(400).json({ error: "Code requis" });
    return;
  }
  const result = await verifyAdminCode(String(code));
  if (!result) {
    res.status(403).json({ error: "Code incorrect" });
    return;
  }
  res.json({ success: true, role: result.role, username: result.username });
});

router.post("/admin/verify", async (req, res): Promise<void> => {
  const { password, code } = req.body;
  const codeToCheck = code ?? password;
  if (!codeToCheck) {
    res.status(400).json({ error: "Code requis" });
    return;
  }
  const result = await verifyAdminCode(String(codeToCheck));
  res.json({ success: result !== null, role: result?.role ?? null });
});

router.post("/admin/accounts", async (req, res): Promise<void> => {
  const { code } = req.body;
  if (!await isSuperAdmin(String(code ?? ""))) {
    res.status(403).json({ error: "Accès refusé — superadmin requis" });
    return;
  }
  const accounts = await db
    .select({ id: adminAccountsTable.id, username: adminAccountsTable.username, role: adminAccountsTable.role, createdAt: adminAccountsTable.createdAt })
    .from(adminAccountsTable);
  res.json(accounts);
});

router.post("/admin/accounts/create", async (req, res): Promise<void> => {
  const { code, username, role, newCode } = req.body;
  if (!await isSuperAdmin(String(code ?? ""))) {
    res.status(403).json({ error: "Accès refusé — superadmin requis" });
    return;
  }
  const validRoles = ["superadmin", "admin_pub", "admin_event", "admin_service", "admin_stats"];
  if (!validRoles.includes(role)) {
    res.status(400).json({ error: "Rôle invalide" });
    return;
  }
  if (!username?.trim() || !newCode?.trim()) {
    res.status(400).json({ error: "Champs requis manquants" });
    return;
  }
  const codeHash = await bcrypt.hash(String(newCode), 10);
  const [account] = await db
    .insert(adminAccountsTable)
    .values({ username: username.trim(), role, codeHash })
    .returning({ id: adminAccountsTable.id, username: adminAccountsTable.username, role: adminAccountsTable.role });
  res.status(201).json(account);
});

router.post("/admin/accounts/update", async (req, res): Promise<void> => {
  const { code, accountId, newCode } = req.body;
  if (!await isSuperAdmin(String(code ?? ""))) {
    res.status(403).json({ error: "Accès refusé — superadmin requis" });
    return;
  }
  if (!accountId || !newCode?.trim()) {
    res.status(400).json({ error: "Champs requis manquants" });
    return;
  }
  const codeHash = await bcrypt.hash(String(newCode), 10);
  await db.update(adminAccountsTable).set({ codeHash }).where(eq(adminAccountsTable.id, accountId));
  res.json({ success: true });
});

router.post("/admin/accounts/delete", async (req, res): Promise<void> => {
  const { code, accountId } = req.body;
  if (!await isSuperAdmin(String(code ?? ""))) {
    res.status(403).json({ error: "Accès refusé — superadmin requis" });
    return;
  }
  const account = await db.select().from(adminAccountsTable).where(eq(adminAccountsTable.id, accountId)).limit(1);
  if (account[0]?.role === "superadmin") {
    res.status(400).json({ error: "Impossible de supprimer le superadmin" });
    return;
  }
  await db.delete(adminAccountsTable).where(eq(adminAccountsTable.id, accountId));
  res.json({ success: true });
});

router.post("/admin/stats", async (req, res): Promise<void> => {
  const { code, dateFrom, dateTo } = req.body;
  const codeStr = String(code ?? "");
  if (!await isAdminOrSubAdmin(codeStr)) {
    res.status(403).json({ error: "Accès refusé" });
    return;
  }

  const now = new Date();
  const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

  const fromDate = dateFrom ? new Date(String(dateFrom) + "T00:00:00.000Z") : undefined;
  const toDate = dateTo ? new Date(String(dateTo) + "T23:59:59.999Z") : undefined;

  const vendorDateFilter = and(
    fromDate ? gte(vendorsTable.createdAt, fromDate) : undefined,
    toDate ? lte(vendorsTable.createdAt, toDate) : undefined,
  );
  const adDateFilter = and(
    fromDate ? gte(adsTable.startDate, fromDate) : undefined,
    toDate ? lte(adsTable.startDate, toDate) : undefined,
  );
  const eventDateFilter = and(
    fromDate ? gte(eventsTable.createdAt, fromDate) : undefined,
    toDate ? lte(eventsTable.createdAt, toDate) : undefined,
  );
  const serviceDateFilter = and(
    fromDate ? gte(servicesTable.createdAt, fromDate) : undefined,
    toDate ? lte(servicesTable.createdAt, toDate) : undefined,
  );

  const [vendorStats] = await db
    .select({
      total: sql<number>`cast(count(*) as int)`,
      paid: sql<number>`cast(sum(case when validation_method = 'fedapay' then 1 else 0 end) as int)`,
      admin: sql<number>`cast(sum(case when validation_method = 'admin' then 1 else 0 end) as int)`,
    })
    .from(vendorsTable)
    .where(vendorDateFilter);

  const expiringSoon = await db
    .select({ id: vendorsTable.id, firstName: vendorsTable.firstName, lastName: vendorsTable.lastName, phone: vendorsTable.phone, expiryDate: vendorsTable.expiryDate })
    .from(vendorsTable)
    .where(and(gte(vendorsTable.expiryDate, now), lt(vendorsTable.expiryDate, threeDaysFromNow)));

  const [adStats] = await db
    .select({
      total: sql<number>`cast(count(*) as int)`,
      paid: sql<number>`cast(sum(case when payment_status = 'paid' then 1 else 0 end) as int)`,
      admin: sql<number>`cast(sum(case when validation_method = 'admin' then 1 else 0 end) as int)`,
    })
    .from(adsTable)
    .where(adDateFilter);

  const [eventStats] = await db
    .select({
      total: sql<number>`cast(count(*) as int)`,
      paid: sql<number>`cast(sum(case when payment_status = 'paid' then 1 else 0 end) as int)`,
      admin: sql<number>`cast(sum(case when validation_method = 'admin' then 1 else 0 end) as int)`,
    })
    .from(eventsTable)
    .where(eventDateFilter);

  const [serviceStats] = await db
    .select({
      total: sql<number>`cast(count(*) as int)`,
      paid: sql<number>`cast(sum(case when payment_status = 'paid' then 1 else 0 end) as int)`,
      admin: sql<number>`cast(sum(case when validation_method = 'admin' then 1 else 0 end) as int)`,
    })
    .from(servicesTable)
    .where(serviceDateFilter);

  res.json({
    vendors: { total: vendorStats.total ?? 0, paid: vendorStats.paid ?? 0, admin: vendorStats.admin ?? 0 },
    ads: { total: adStats.total ?? 0, paid: adStats.paid ?? 0, admin: adStats.admin ?? 0 },
    events: { total: eventStats.total ?? 0, paid: eventStats.paid ?? 0, admin: eventStats.admin ?? 0 },
    services: { total: serviceStats.total ?? 0, paid: serviceStats.paid ?? 0, admin: serviceStats.admin ?? 0 },
    expiringSoon: expiringSoon.map((v) => ({
      id: v.id, firstName: v.firstName, lastName: v.lastName, phone: v.phone,
      expiryDate: v.expiryDate?.toISOString() ?? null,
    })),
    dateFrom: dateFrom ?? null,
    dateTo: dateTo ?? null,
  });
});

router.post("/admin/vendors/force-publish", async (req, res): Promise<void> => {
  const { code, vendorId } = req.body;
  if (!await isSuperAdmin(String(code ?? ""))) {
    res.status(403).json({ error: "Accès refusé" });
    return;
  }
  const now = new Date();
  const thirtyDays = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  await db
    .update(vendorsTable)
    .set({ isPublished: true, validationMethod: "admin", verified: true, expiryDate: thirtyDays, paymentStatus: "paid" })
    .where(eq(vendorsTable.id, vendorId));
  res.json({ success: true });
});

router.post("/admin/ads/force-publish", async (req, res): Promise<void> => {
  const { code, id } = req.body;
  const role = await getAdminRole(String(code ?? ""));
  if (!role || (role !== "superadmin" && role !== "admin_pub")) {
    res.status(403).json({ error: "Accès refusé" });
    return;
  }
  const now = new Date();
  const thirtyDays = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  await db
    .update(adsTable)
    .set({ isPublished: true, validationMethod: "admin", endDate: thirtyDays })
    .where(eq(adsTable.id, id));
  res.json({ success: true });
});

router.post("/admin/events/force-publish", async (req, res): Promise<void> => {
  const { code, id } = req.body;
  const role = await getAdminRole(String(code ?? ""));
  if (!role || (role !== "superadmin" && role !== "admin_event")) {
    res.status(403).json({ error: "Accès refusé" });
    return;
  }
  const event = await db.select().from(eventsTable).where(eq(eventsTable.id, id)).limit(1);
  if (!event[0]) { res.status(404).json({ error: "Événement introuvable" }); return; }
  await db
    .update(eventsTable)
    .set({ isPublished: true, validationMethod: "admin" })
    .where(eq(eventsTable.id, id));
  res.json({ success: true, expiryDate: (event[0].endDate ?? event[0].date).toISOString() });
});

router.post("/admin/services/force-publish", async (req, res): Promise<void> => {
  const { code, id } = req.body;
  const role = await getAdminRole(String(code ?? ""));
  if (!role || (role !== "superadmin" && role !== "admin_service")) {
    res.status(403).json({ error: "Accès refusé" });
    return;
  }
  const now = new Date();
  const thirtyDays = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  await db
    .update(servicesTable)
    .set({ isPublished: true, validationMethod: "admin", expiresAt: thirtyDays })
    .where(eq(servicesTable.id, id));
  res.json({ success: true });
});

export { verifyAdminCode };
export default router;
