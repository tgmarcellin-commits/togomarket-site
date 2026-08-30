import { createHash } from "node:crypto";
import { and, eq, inArray, or } from "drizzle-orm";
import {
  conversationBuyerTokensTable,
  conversationsTable,
  db,
} from "@workspace/db";

export function hashBuyerKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function isValidBuyerKey(value: unknown): value is string {
  return typeof value === "string" && value.length >= 20 && value.length <= 200;
}

export async function resolveBuyerConversationId(
  requestedConversationId: number,
  token: string,
): Promise<number | null> {
  const [direct] = await db
    .select({ id: conversationsTable.id })
    .from(conversationsTable)
    .where(and(
      eq(conversationsTable.id, requestedConversationId),
      eq(conversationsTable.buyerToken, token),
    ))
    .limit(1);
  if (direct) return direct.id;

  const [alias] = await db
    .select({ conversationId: conversationBuyerTokensTable.conversationId })
    .from(conversationBuyerTokensTable)
    .where(and(
      eq(conversationBuyerTokensTable.token, token),
      or(
        eq(conversationBuyerTokensTable.conversationId, requestedConversationId),
        eq(conversationBuyerTokensTable.legacyConversationId, requestedConversationId),
      ),
    ))
    .limit(1);
  return alias?.conversationId ?? null;
}

export async function resolveVendorConversationId(
  requestedConversationId: number,
  vendorId: number,
): Promise<number | null> {
  const [direct] = await db
    .select({ id: conversationsTable.id })
    .from(conversationsTable)
    .where(and(
      eq(conversationsTable.id, requestedConversationId),
      eq(conversationsTable.vendorId, vendorId),
    ))
    .limit(1);
  if (direct) return direct.id;

  const [alias] = await db
    .select({ conversationId: conversationsTable.id })
    .from(conversationBuyerTokensTable)
    .innerJoin(
      conversationsTable,
      eq(conversationBuyerTokensTable.conversationId, conversationsTable.id),
    )
    .where(and(
      eq(conversationBuyerTokensTable.legacyConversationId, requestedConversationId),
      eq(conversationsTable.vendorId, vendorId),
    ))
    .limit(1);
  return alias?.conversationId ?? null;
}

export async function findConversationsForBuyerTokens(tokens: string[]) {
  if (tokens.length === 0) return [];
  const [direct, aliased] = await Promise.all([
    db
      .select({ conversation: conversationsTable, accessToken: conversationsTable.buyerToken })
      .from(conversationsTable)
      .where(inArray(conversationsTable.buyerToken, tokens)),
    db
      .select({
        conversation: conversationsTable,
        accessToken: conversationBuyerTokensTable.token,
      })
      .from(conversationBuyerTokensTable)
      .innerJoin(
        conversationsTable,
        eq(conversationBuyerTokensTable.conversationId, conversationsTable.id),
      )
      .where(inArray(conversationBuyerTokensTable.token, tokens)),
  ]);

  const byConversation = new Map<number, (typeof direct)[number]>();
  for (const row of [...direct, ...aliased]) {
    if (!byConversation.has(row.conversation.id)) byConversation.set(row.conversation.id, row);
  }
  return [...byConversation.values()];
}