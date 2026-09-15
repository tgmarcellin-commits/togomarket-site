import { Router, type IRouter } from "express";
import { eq, desc, and, sql } from "drizzle-orm";
import { db, eventsTable } from "@workspace/db";
import { getAdminRole } from "../lib/admin-auth";

async function canManageEvents(password: unknown): Promise<boolean> {
  const role = await getAdminRole(String(password ?? ""));
  return role === "superadmin" || role === "admin_event";
}

const router: IRouter = Router();

const compatibleEventColumns = {
  id: eventsTable.id,
  title: eventsTable.title,
  description: eventsTable.description,
  flyerImage: eventsTable.flyerImage,
  videoPath: eventsTable.videoPath,
  date: eventsTable.date,
  endDate: eventsTable.endDate,
  location: eventsTable.location,
  ticketLink: eventsTable.ticketLink,
  ticketPrice: eventsTable.ticketPrice,
  createdAt: eventsTable.createdAt,
  isPublished: eventsTable.isPublished,
  paymentStatus: eventsTable.paymentStatus,
  validationMethod: eventsTable.validationMethod,
  fedapayTransactionId: eventsTable.fedapayTransactionId,
  subscriptionExpiresAt: eventsTable.subscriptionExpiresAt,
};

type CompatibleEvent = Omit<typeof eventsTable.$inferSelect, "whatsappPhone"> & {
  whatsappPhone?: string | null;
};

async function hasEventWhatsappColumn(): Promise<boolean> {
  const result = await db.execute(sql`
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'events'
      and column_name = 'whatsapp_phone'
    limit 1
  `);
  return result.rows.length > 0;
}

async function attachWhatsappPhones<T extends { id: number }>(
  events: T[],
): Promise<Array<T & { whatsappPhone: string | null }>> {
  if (events.length === 0 || !await hasEventWhatsappColumn()) {
    return events.map((event) => ({ ...event, whatsappPhone: null }));
  }
  const result = await db.execute(sql`
    select id, whatsapp_phone
    from public.events
  `);
  const phones = new Map(
    result.rows.map((row) => {
      const value = row as { id: number; whatsapp_phone: string | null };
      return [Number(value.id), value.whatsapp_phone] as const;
    }),
  );
  return events.map((event) => ({
    ...event,
    whatsappPhone: phones.get(event.id) ?? null,
  }));
}

async function writeEventWhatsappPhone(id: number, phone: string): Promise<boolean> {
  if (!await hasEventWhatsappColumn()) return false;
  await db.execute(sql`
    update public.events
    set whatsapp_phone = ${phone}
    where id = ${id}
  `);
  return true;
}

function mapEvent(e: CompatibleEvent) {
  return {
    id: e.id,
    title: e.title,
    description: e.description,
    flyerImage: e.flyerImage ?? null,
    videoPath: e.videoPath ?? null,
    date: e.date.toISOString(),
    endDate: e.endDate?.toISOString() ?? null,
    location: e.location,
    whatsappPhone: e.whatsappPhone ?? null,
    ticketLink: e.ticketLink ?? null,
    ticketPrice: e.ticketPrice ?? null,
    createdAt: e.createdAt.toISOString(),
    isPublished: e.isPublished,
    paymentStatus: e.paymentStatus,
    validationMethod: e.validationMethod,
    fedapayTransactionId: e.fedapayTransactionId ?? null,
    subscriptionExpiresAt: e.subscriptionExpiresAt?.toISOString() ?? null,
  };
}

router.get("/events", async (req, res) => {
  try {
    const events = await db
      .select(compatibleEventColumns)
      .from(eventsTable)
      .where(and(
        eq(eventsTable.isPublished, true),
        // Masquer les évènements passés : expirés à 00h le lendemain du jour de la date de fin (ou de la date)
        sql`date_trunc('day', COALESCE(${eventsTable.endDate}, ${eventsTable.date})) + interval '1 day' > now()`,
      ))
      .orderBy(desc(eventsTable.date));
    res.json((await attachWhatsappPhones(events)).map(mapEvent));
  } catch (err) {
    req.log.error({ err }, "Failed to get events");
    res.status(500).json({ error: "Erreur interne" });
  }
});

router.post("/admin/events", async (req, res) => {
  const { password, title, description, flyerImage, videoPath, date, endDate, location, whatsappPhone, ticketLink, ticketPrice } = req.body;
  if (!await canManageEvents(password)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  if (!title?.trim() || !description?.trim() || !date || !location?.trim() || !whatsappPhone?.trim()) {
    return res.status(400).json({ error: "Champs requis manquants" });
  }
  try {
    const [event] = await db
      .insert(eventsTable)
      .values({
        title: title.trim(),
        description: description.trim(),
        flyerImage: flyerImage ?? null,
        videoPath: videoPath ?? null,
        date: new Date(date),
        endDate: endDate ? new Date(endDate) : null,
        location: location.trim(),
        ticketLink: ticketLink ?? null,
        ticketPrice: ticketPrice ?? null,
        isPublished: false,
        paymentStatus: "unpaid",
        validationMethod: "pending",
      })
      .returning(compatibleEventColumns);
    await writeEventWhatsappPhone(event.id, whatsappPhone.trim());
    req.log.info({ id: event.id }, "Event created");
    return res.status(201).json(mapEvent({ ...event, whatsappPhone: whatsappPhone.trim() }));
  } catch (err) {
    req.log.error({ err }, "Failed to create event");
    return res.status(500).json({ error: "Erreur interne" });
  }
});

router.post("/admin/events/all", async (req, res) => {
  const { password } = req.body;
  if (!await canManageEvents(password)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  try {
    const events = await db.select(compatibleEventColumns).from(eventsTable).orderBy(desc(eventsTable.date));
    return res.json((await attachWhatsappPhones(events)).map(mapEvent));
  } catch (err) {
    req.log.error({ err }, "Failed to get all events");
    return res.status(500).json({ error: "Erreur interne" });
  }
});

router.post("/admin/events/whatsapp", async (req, res) => {
  const { password, id, whatsappPhone } = req.body;
  if (!await canManageEvents(password)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const eventId = Number(id);
  if (!Number.isInteger(eventId) || eventId <= 0 || typeof whatsappPhone !== "string" || whatsappPhone.trim().length < 8) {
    return res.status(400).json({ error: "Numéro WhatsApp invalide" });
  }
  try {
    const [event] = await db.select(compatibleEventColumns)
      .from(eventsTable)
      .where(eq(eventsTable.id, eventId))
      .limit(1);
    if (!event) {
      return res.status(404).json({ error: "Événement introuvable" });
    }
    if (!await writeEventWhatsappPhone(eventId, whatsappPhone.trim())) {
      return res.status(409).json({
        error: "Le numéro WhatsApp sera modifiable après la mise à jour du schéma de production",
      });
    }
    return res.json(mapEvent({ ...event, whatsappPhone: whatsappPhone.trim() }));
  } catch (err) {
    req.log.error({ err }, "Failed to update event WhatsApp number");
    return res.status(500).json({ error: "Erreur interne" });
  }
});

router.post("/admin/events/delete", async (req, res) => {
  const { id, password } = req.body;
  if (!await canManageEvents(password)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  try {
    const deleted = await db.delete(eventsTable)
      .where(eq(eventsTable.id, id))
      .returning({ id: eventsTable.id });
    if (deleted.length === 0) {
      return res.status(404).json({ error: "Événement introuvable" });
    }
    req.log.info({ id }, "Event deleted");
    return res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete event");
    return res.status(500).json({ error: "Erreur interne" });
  }
});

export default router;
