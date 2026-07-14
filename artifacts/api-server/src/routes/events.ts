import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, eventsTable } from "@workspace/db";
import { isAdminOrSubAdmin } from "../lib/auth-sub";

const router: IRouter = Router();

function mapEvent(e: typeof eventsTable.$inferSelect) {
  return {
    id: e.id,
    title: e.title,
    description: e.description,
    flyerImage: e.flyerImage ?? null,
    videoPath: e.videoPath ?? null,
    date: e.date.toISOString(),
    endDate: e.endDate?.toISOString() ?? null,
    location: e.location,
    ticketLink: e.ticketLink ?? null,
    ticketPrice: e.ticketPrice ?? null,
    createdAt: e.createdAt.toISOString(),
    isPublished: e.isPublished,
    paymentStatus: e.paymentStatus,
    validationMethod: e.validationMethod,
    fedapayTransactionId: e.fedapayTransactionId ?? null,
  };
}

router.get("/events", async (req, res) => {
  try {
    const events = await db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.isPublished, true))
      .orderBy(desc(eventsTable.date));
    res.json(events.map(mapEvent));
  } catch (err) {
    req.log.error({ err }, "Failed to get events");
    res.status(500).json({ error: "Erreur interne" });
  }
});

router.post("/admin/events", async (req, res) => {
  const { password, title, description, flyerImage, videoPath, date, endDate, location, ticketLink, ticketPrice } = req.body;
  if (!await isAdminOrSubAdmin(password)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  if (!title?.trim() || !description?.trim() || !date || !location?.trim()) {
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
      .returning();
    req.log.info({ id: event.id }, "Event created");
    return res.status(201).json(mapEvent(event));
  } catch (err) {
    req.log.error({ err }, "Failed to create event");
    return res.status(500).json({ error: "Erreur interne" });
  }
});

router.post("/admin/events/all", async (req, res) => {
  const { password } = req.body;
  if (!await isAdminOrSubAdmin(password)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  try {
    const events = await db.select().from(eventsTable).orderBy(desc(eventsTable.date));
    return res.json(events.map(mapEvent));
  } catch (err) {
    req.log.error({ err }, "Failed to get all events");
    return res.status(500).json({ error: "Erreur interne" });
  }
});

router.post("/admin/events/delete", async (req, res) => {
  const { id, password } = req.body;
  if (!await isAdminOrSubAdmin(password)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  try {
    const deleted = await db.delete(eventsTable).where(eq(eventsTable.id, id)).returning();
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
