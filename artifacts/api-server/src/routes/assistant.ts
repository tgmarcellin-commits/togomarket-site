import { Router, type IRouter } from "express";
import OpenAI from "openai";
import { ASSISTANT_SYSTEM_PROMPT } from "../lib/assistant-prompt";

const router: IRouter = Router();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

router.post("/assistant/chat", async (req, res) => {
  const validated = validateBody(req.body);
  if (!validated) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  const { messages } = validated;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");

  try {
    const stream = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_completion_tokens: 1024,
      messages: [
        { role: "system", content: ASSISTANT_SYSTEM_PROMPT },
        ...messages,
      ],
      stream: true,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
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
