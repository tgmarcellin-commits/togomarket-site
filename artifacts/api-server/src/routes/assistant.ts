import { Router, type IRouter } from "express";
import OpenAI from "openai";
import { ilike, eq, and, sql } from "drizzle-orm";
import { db, listingsTable } from "@workspace/db";
import { ASSISTANT_SYSTEM_PROMPT } from "../lib/assistant-prompt";

const router: IRouter = Router();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY ?? "" });

type ChatRole = "user" | "assistant";
interface ChatMessage { role: ChatRole; content: string; }

function validateBody(body: unknown): { messages: ChatMessage[] } | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.messages) || b.messages.length === 0 || b.messages.length > 50) return null;
  const messages: ChatMessage[] = [];
  for (const m of b.messages) {
    if (!m || typeof m !== "object") return null;
    const msg = m as Record<string, unknown>;
    if (msg.role !== "user" && msg.role !== "assistant") return null;
    if (typeof msg.content !== "string" || msg.content.length === 0 || msg.content.length > 2000) return null;
    messages.push({ role: msg.role as ChatRole, content: msg.content });
  }
  return { messages };
}

async function buildDbContext(userMessage: string): Promise<string> {
  try {
    const countsBySector = await db
      .select({
        sector: listingsTable.sector,
        count: sql<number>`cast(count(*) as int)`,
      })
      .from(listingsTable)
      .where(eq(listingsTable.approved, true))
      .groupBy(listingsTable.sector);

    const totalApproved = countsBySector.reduce((s, r) => s + r.count, 0);
    const sectorSummary = countsBySector
      .map((r) => `${r.sector}: ${r.count} annonce(s)`)
      .join(", ");

    const keyword = userMessage.replace(/[^\w\s]/gi, " ").trim().split(/\s+/).filter(w => w.length > 2).join(" ");

    let searchResults: Array<{ name: string; price: string; location: string; sector: string }> = [];
    if (keyword.length > 0) {
      const words = keyword.split(/\s+/).slice(0, 5);
      const conditions = words.map(w => ilike(listingsTable.name, `%${w}%`));
      const rows = await db
        .select({
          name: listingsTable.name,
          price: listingsTable.price,
          location: listingsTable.location,
          sector: listingsTable.sector,
        })
        .from(listingsTable)
        .where(and(eq(listingsTable.approved, true), ...conditions))
        .limit(8);
      searchResults = rows.map(r => ({
        name: r.name,
        price: r.price,
        location: r.location,
        sector: r.sector,
      }));
    }

    let context = `\n━━━━ DONNÉES EN TEMPS RÉEL (base de données TogoMarket) ━━━━\n`;
    context += `Total annonces approuvées : ${totalApproved}\n`;
    if (sectorSummary) context += `Répartition : ${sectorSummary}\n`;

    if (searchResults.length > 0) {
      context += `\nAnnonces correspondant à "${keyword}" :\n`;
      for (const r of searchResults) {
        context += `• [${r.sector}] ${r.name} — ${Number(r.price).toLocaleString("fr-FR")} FCFA — ${r.location}\n`;
      }
    } else if (keyword.length > 0) {
      context += `\nAucune annonce trouvée pour "${keyword}" en ce moment.\n`;
    }

    context += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    return context;
  } catch {
    return "";
  }
}

router.post("/assistant/chat", async (req, res) => {
  const validated = validateBody(req.body);
  if (!validated) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  const { messages } = validated;
  const lastUserMessage = messages.filter(m => m.role === "user").at(-1)?.content ?? "";

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");

  try {
    const dbContext = await buildDbContext(lastUserMessage);
    const systemPrompt = ASSISTANT_SYSTEM_PROMPT + (dbContext ? `\n${dbContext}` : "");

    const stream = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      stream: true,
      max_tokens: 1024,
      messages: [
        { role: "system", content: systemPrompt },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
      ],
    });

    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content;
      if (text) {
        res.write(`data: ${JSON.stringify({ content: text })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "AI error";
    req.log?.error({ err }, "Assistant chat error");
    res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
    res.end();
  }
});

export default router;
