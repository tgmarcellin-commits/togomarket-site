export interface BuyerBalanceContextInput {
  conversationId: number;
  buyerName: string;
  buyerPhone: string;
  authKind: "buyer" | "vendor";
  showAssignDriver: boolean;
}

export interface BuyerBalanceContextProps {
  loadUrl: string;
  withdrawBody: { ownerType: "buyer"; ownerId: number };
  phoneNumber: string;
  identityLabel: { name: string; phone: string };
}

/**
 * Decides whether the connected buyer's identity + wallet balance context
 * should be shown in Messages (next to the "connecté en tant que ... au
 * numéro ..." identity line), and if so, which conversation-scoped wallet
 * endpoint to load it from.
 *
 * Returns null for the vendor side of the same conversation (or when
 * delivery/wallet features are disabled for this conversation), so a buyer's
 * balance is never exposed to another participant. The wallet endpoint is
 * always scoped to this exact conversationId, never another conversation's.
 */
export function getBuyerBalanceContext(
  input: BuyerBalanceContextInput,
): BuyerBalanceContextProps | null {
  if (!input.showAssignDriver || input.authKind !== "buyer") return null;
  return {
    loadUrl: `/api/wallets/buyer/${input.conversationId}`,
    withdrawBody: { ownerType: "buyer", ownerId: input.conversationId },
    phoneNumber: input.buyerPhone,
    identityLabel: { name: input.buyerName, phone: input.buyerPhone },
  };
}
