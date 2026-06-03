import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, eventsTable } from "@workspace/db";

const router: IRouter = Router();

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "17210";

function mapEvent(e: typeof eventsTable.$inferSelect) {
  return {
    id: e.id,
    title: e.title,
    description: e.description,
    flyerImage: e.flyerImage ?? null,
    date: e.date.toISOString(),
    location: e.location,
    ticketLink: e.ticketLink ?? null,
    ticketPrice: e.ticketPrice ?? null,
    createdAt: e.createdAt.toISOString(),
  };
}

router.get("/events", async (req, res) => {
  try {
    const events = await db.select().from(eventsTable).orderBy(desc(eventsTable.date));
    res.json(events.map(mapEvent));
  } catch (err) {
    req.log.error({ err }, "Failed to get events");
    res.status(500).json({ error: "Erreur interne" });
  }
});

router.post("/admin/events", async (req, res) => {
  const { password, title, description, flyerImage, date, location, ticketLink, ticketPrice } = req.body;
  if (password !== ADMIN_PASSWORD) {
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
        date: new Date(date),
        location: location.trim(),
        ticketLink: ticketLink ?? null,
        ticketPrice: ticketPrice ?? null,
      })
      .returning();
    req.log.info({ id: event.id }, "Event created");
    return res.status(201).json(mapEvent(event));
  } catch (err) {
    req.log.error({ err }, "Failed to create event");
    return res.status(500).json({ error: "Erreur interne" });
  }
});

router.post("/admin/events/delete", async (req, res) => {
  const { id, password } = req.body;
  if (password !== ADMIN_PASSWORD) {
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
