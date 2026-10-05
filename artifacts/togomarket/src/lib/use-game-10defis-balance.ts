import { useEffect, useState } from "react";

export type Game10defisBalance = {
  /** Solde 10défis en FCFA (0 tant que le numéro n'est pas prouvé ou que la lecture n'est pas terminée). */
  balance: number;
  /** Le numéro de cette conversation a-t-il été prouvé par code WhatsApp ? Sans cela, le solde n'est pas montré. */
  verified: boolean;
  /** La première lecture est-elle terminée ? */
  loaded: boolean;
};

const REFRESH_MS = 60_000;

/**
 * Solde « 10défis » de l'acheteur d'une conversation, pour « Mon portefeuille ». Ne fait rien pour un vendeur
 * (buyerToken null). `refreshKey` force une relecture (par exemple après la vérification du numéro).
 */
export function useGame10defisBalance(
  conversationId: number,
  buyerToken: string | null,
  active: boolean,
  refreshKey: number,
): Game10defisBalance {
  const [state, setState] = useState<Game10defisBalance>({ balance: 0, verified: false, loaded: false });

  useEffect(() => {
    if (!active || !buyerToken) return;
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch(`/api/delivery/conversations/${conversationId}/game-balance`, {
          headers: { "x-buyer-token": buyerToken },
        });
        if (!response.ok) return;
        const data = await response.json() as { verified?: unknown; balanceFcfa?: unknown };
        if (cancelled) return;
        setState({
          balance: typeof data.balanceFcfa === "number" && Number.isFinite(data.balanceFcfa) ? Math.max(0, Math.round(data.balanceFcfa)) : 0,
          verified: data.verified === true,
          loaded: true,
        });
      } catch {
        // réseau instable : on réessaiera à la prochaine échéance
      }
    };

    void load();
    const timer = setInterval(() => { void load(); }, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [conversationId, buyerToken, active, refreshKey]);

  return state;
}
