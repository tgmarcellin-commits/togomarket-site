import { Router, type IRouter } from "express";
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";
import OpenAI from "openai";
import { ilike, eq, and, sql, gt, inArray } from "drizzle-orm";
import { db, listingsTable, vendorsTable } from "@workspace/db";
import { ASSISTANT_SYSTEM_PROMPT } from "../lib/assistant-prompt";

const router: IRouter = Router();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? "");
const SECURITY_REFUSAL =
  "Je ne peux pas vous aider avec ça. Pour toute question d'ordre administratif, contactez l'équipe via le bouton WhatsApp de support.";
const SENSITIVE_OUTPUT_PATTERNS = [
  /\b(?:system|developer)\s+(?:prompt|instruction|message)\b/i,
  /\b(?:prompt|instruction)\s+syst[eè]me\b/i,
  /\b(?:GEMINI|OPENAI|SESSION|ADMIN|SUB_ADMIN|FEDAPAY|WHATSAPP|VAPID)_[A-Z0-9_]+\b/i,
  /\/api\/(?:admin|security|storage|vendors\/session)\b/i,
  /\b(?:api[_ -]?key|secret[_ -]?key|csrf|bearer|jwt|cookie|postgres(?:ql)?|sql|database|base de donn[ée]es)\b/i,
  /\b(?:superadmin|sous-admin)\b/i,
];
const OUTPUT_HOLD_BACK_CHARS = 96;
const MODEL_TIMEOUT_MS = 12_000;
const openAI = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: MODEL_TIMEOUT_MS })
  : null;

type ChatRole = "user" | "assistant";
interface ChatMessage { role: ChatRole; content: string; }

function validateBody(body: unknown): { messages: ChatMessage[] } | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.messages) || b.messages.length === 0 || b.messages.length > 20) return null;
  const messages: ChatMessage[] = [];
  let totalLength = 0;
  for (const m of b.messages) {
    if (!m || typeof m !== "object") return null;
    const msg = m as Record<string, unknown>;
    if (msg.role !== "user" && msg.role !== "assistant") return null;
    if (typeof msg.content !== "string" || msg.content.length === 0 || msg.content.length > 2000) return null;
    totalLength += msg.content.length;
    if (totalLength > 12000) return null;
    messages.push({ role: msg.role as ChatRole, content: msg.content });
  }
  if (messages.at(-1)?.role !== "user") return null;
  return { messages };
}

function protectAssistantOutput(text: string): string {
  const normalized = text.trim();
  if (!normalized || SENSITIVE_OUTPUT_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return SECURITY_REFUSAL;
  }
  return normalized;
}

function containsSensitiveOutput(text: string): boolean {
  return SENSITIVE_OUTPUT_PATTERNS.some((pattern) => pattern.test(text));
}

function isSensitiveRequest(text: string): boolean {
  return [
    /(?:ignore|oublie|désactive).*(?:règle|instruction|consigne)/i,
    /(?:prompt|consigne|instruction).*(?:système|interne)/i,
    /\b(?:secret|clé\s+(?:api|secrète)|mot\s+de\s+passe|token|bearer|jwt)\b/i,
    /\b(?:superadmin|sous-admin|base\s+de\s+données|postgres|sql)\b/i,
  ].some((pattern) => pattern.test(text));
}

function isTransientProviderError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const status = "status" in error ? Number(error.status) : NaN;
  return [408, 429, 500, 502, 503, 504].includes(status);
}

function isQuotaExceededError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const status = "status" in error ? Number(error.status) : NaN;
  const details = JSON.stringify(error);
  return status === 429 && /(quota|free[_ -]?tier|billing|exceeded)/i.test(details);
}

const RETRY_DELAYS_MS = [0, 500, 1500];

function buildLocalFallbackResponse(userMessage: string): string {
  const normalized = userMessage.toLocaleLowerCase("fr-FR");

  if (/^\s*(bonjour|salut|hello|bonsoir|coucou)\b/.test(normalized)) {
    return "Bonjour ! Je suis l'assistante TogoMarket. Comment puis-je vous aider à trouver un article, une boutique ou un service ?";
  }
  if (/(?:article|annonce|produit|chercher|trouver|recherche)/.test(normalized)) {
    return "Pour trouver un article, ouvrez l'onglet « Market Place », puis utilisez la barre de recherche. Vous pouvez aussi ouvrir « Stand » pour parcourir les boutiques par secteur.";
  }
  if (/(?:boutique|vendeur|stand|magasin)/.test(normalized)) {
    return "Vous pouvez découvrir les boutiques dans l'onglet « Stand ». Sélectionnez un secteur, puis une boutique pour voir ses annonces et contacter le vendeur.";
  }
  if (/(?:commande|acheter|livraison|prix)/.test(normalized)) {
    return "Pour une commande, ouvrez l'annonce concernée et contactez directement le vendeur avec les coordonnées indiquées. Pour une aide complémentaire, utilisez le bouton WhatsApp du support.";
  }
  if (/(?:introuvable|service|besoin)/.test(normalized)) {
    return "Si vous ne trouvez pas ce que vous cherchez, utilisez le service « Introuvable » pour envoyer votre demande à l'équipe TogoMarket.";
  }
  return "Je peux vous aider à naviguer sur TogoMarket. Consultez « Market Place » pour les articles, « Stand » pour les boutiques, ou utilisez le bouton WhatsApp du support pour une demande précise.";
}

// Sous-requête réutilisable : téléphones des vendeurs actifs
function activeVendorPhonesSubquery() {
  return db
    .select({ phone: vendorsTable.phone })
    .from(vendorsTable)
    .where(and(
      eq(vendorsTable.isPublished, true),
      gt(vendorsTable.expiryDate, sql`now()`),
    ));
}

async function buildDbContext(userMessage: string): Promise<string> {
  try {
    const keyword = userMessage.replace(/[^\w\s]/gi, " ").trim().split(/\s+/).filter(w => w.length > 2).join(" ");

    const countsPromise = db
      .select({
        sector: listingsTable.sector,
        count: sql<number>`cast(count(*) as int)`,
      })
      .from(listingsTable)
      .where(and(
        eq(listingsTable.approved, true),
        inArray(listingsTable.phone, activeVendorPhonesSubquery()),
      ))
      .groupBy(listingsTable.sector);

    const searchPromise = keyword.length > 0
      ? db
        .select({
          name: listingsTable.name,
          price: listingsTable.price,
          location: listingsTable.location,
          sector: listingsTable.sector,
        })
        .from(listingsTable)
        .where(and(
          eq(listingsTable.approved, true),
          inArray(listingsTable.phone, activeVendorPhonesSubquery()),
          ...keyword.split(/\s+/).slice(0, 5).map(w => ilike(listingsTable.name, `%${w}%`)),
        ))
        .limit(8)
      : Promise.resolve([]);

    const [countsBySector, rows] = await Promise.all([countsPromise, searchPromise]);
    const totalApproved = countsBySector.reduce((s, r) => s + r.count, 0);
    const sectorSummary = countsBySector
      .map((r) => `${r.sector}: ${r.count} annonce(s)`)
      .join(", ");

    const searchResults = rows.map(r => ({
      name: r.name,
      price: r.price,
      location: r.location,
      sector: r.sector,
    }));

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
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ status: "thinking" })}\n\n`);

  try {
    const dbContext = await buildDbContext(lastUserMessage);
    const systemPrompt = ASSISTANT_SYSTEM_PROMPT + (dbContext ? `\n${dbContext}` : "");

    // Gemini requires: history starts with 'user' and strictly alternates user/model
    const rawHistory = messages.slice(0, -1).map((m) => ({
      role: m.role === "assistant" ? "model" : ("user" as const),
      parts: [{ text: m.content }],
    }));

    // Drop any leading 'model' entries — Gemini rejects history not starting with 'user'
    const firstUserIdx = rawHistory.findIndex((m) => m.role === "user");
    const history = firstUserIdx >= 0 ? rawHistory.slice(firstUserIdx) : [];

    const lastMessage = messages[messages.length - 1];
    let fullResponse = "";
    let pendingOutput = "";
    let outputWasStreamed = false;
    let blockedOutput = false;
    let providerSucceeded = false;
    let providerError: unknown;

    for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt += 1) {
      if (RETRY_DELAYS_MS[attempt] > 0) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
      }

      try {
        const model = genAI.getGenerativeModel({
          model: "gemini-2.5-flash",
          systemInstruction: systemPrompt,
          safetySettings: [
            { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
          ],
        }, { timeout: MODEL_TIMEOUT_MS });
        const chat = model.startChat({
          history,
          generationConfig: { maxOutputTokens: 1024 },
        });
        const result = await chat.sendMessageStream(lastMessage.content);
        fullResponse = "";
        pendingOutput = "";
        for await (const chunk of result.stream) {
          const text = chunk.text();
          if (!text) continue;
          fullResponse += text;
          pendingOutput += text;

          if (containsSensitiveOutput(fullResponse)) {
            blockedOutput = true;
            res.write(`data: ${JSON.stringify({
              replaceContent: SECURITY_REFUSAL,
              security: true,
            })}\n\n`);
            break;
          }

          if (pendingOutput.length > OUTPUT_HOLD_BACK_CHARS) {
            const safeText = pendingOutput.slice(0, -OUTPUT_HOLD_BACK_CHARS);
            pendingOutput = pendingOutput.slice(-OUTPUT_HOLD_BACK_CHARS);
            if (safeText) {
              res.write(`data: ${JSON.stringify({ content: safeText })}\n\n`);
              outputWasStreamed = true;
            }
          }
        }
        if (blockedOutput) break;
        providerSucceeded = true;
        break;
      } catch (error) {
        providerError = error;
        if (isQuotaExceededError(error)) break;
        if (!isTransientProviderError(error) || attempt === RETRY_DELAYS_MS.length - 1) {
          throw error;
        }
      }
    }

    if (!providerSucceeded && !blockedOutput) {
      if (!isQuotaExceededError(providerError) || !openAI) {
        throw providerError ?? new Error("Assistant provider unavailable");
      }

      const completion = await openAI.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          ...messages.slice(0, -1).map((message) => ({
            role: message.role,
            content: message.content,
          })),
          { role: "user", content: lastMessage.content },
        ],
        max_tokens: 1024,
        temperature: 0.2,
      });
      fullResponse = completion.choices[0]?.message?.content ?? "";
      pendingOutput = "";
    }

    if (!blockedOutput) {
      const protectedResponse = protectAssistantOutput(fullResponse);
      if (protectedResponse === SECURITY_REFUSAL) {
        res.write(`data: ${JSON.stringify({
          replaceContent: SECURITY_REFUSAL,
          security: true,
        })}\n\n`);
      } else if (pendingOutput) {
        res.write(`data: ${JSON.stringify({ content: pendingOutput })}\n\n`);
      } else if (!outputWasStreamed) {
        res.write(`data: ${JSON.stringify({ content: protectedResponse })}\n\n`);
      }
    }
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err: unknown) {
    req.log?.error({ err }, "Assistant chat error");
    // Never expose provider errors, request details, or configuration values.
    res.write(`data: ${JSON.stringify({ error: "assistant_unavailable" })}\n\n`);
    res.end();
  }
});

export default router;
