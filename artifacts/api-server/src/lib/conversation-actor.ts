import type { Request } from "express";
import { authenticateVendorRequest } from "./vendor-auth";
import { resolveBuyerConversationId, resolveVendorConversationId } from "./conversation-access";

/** Identifie l'appelant d'une conversation : acheteur (x-buyer-token) ou vendeur de la conversation. */
export async function resolveConversationActor(
  req: Request,
  conversationId: number,
): Promise<{ conversationId: number; actor: "buyer" | "seller" } | null> {
  if (!Number.isInteger(conversationId) || conversationId <= 0) return null;
  const buyerToken = req.headers["x-buyer-token"];
  if (typeof buyerToken === "string" && buyerToken) {
    const id = await resolveBuyerConversationId(conversationId, buyerToken);
    return id ? { conversationId: id, actor: "buyer" } : null;
  }
  const vendor = await authenticateVendorRequest(req);
  if (!vendor) return null;
  const id = await resolveVendorConversationId(conversationId, vendor.id);
  return id ? { conversationId: id, actor: "seller" } : null;
}
