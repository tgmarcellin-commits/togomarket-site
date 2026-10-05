import { useCallback, useEffect, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { loadPhoneProof } from "@/lib/phone-proof-store";
import { useSiteSettings } from "@/lib/site-settings";

export const BUYER_PHONE_VERIFIED_EVENT = "tm-buyer-phone-verified";

type BuyerBalance = {
  /** false = portefeuille par conversation (mode actuel) : ce bloc n'a pas lieu d'être affiché. */
  enabled?: boolean;
  verified: boolean;
  phoneMasked: string | null;
  availableFcfa: number;
  lockedFcfa: number;
  pendingFcfa: number;
};

const REFRESH_MS = 30_000;

/**
 * Vérification du numéro de l'acheteur pour accéder à son portefeuille unique (tous vendeurs confondus).
 * Le numéro est saisi à la main : tant qu'il n'est pas vérifié par un code WhatsApp, aucun montant n'est montré,
 * dépensable ni retirable. Une fois vérifié, ce bloc disparaît : le bouton « Mon portefeuille » prend le relais.
 */
export function BuyerBalanceSummary({
  conversationId,
  buyerToken,
}: {
  conversationId: number;
  buyerToken: string;
}) {
  const { lang } = useSiteSettings();
  const isFrench = lang === "fr";
  const [balance, setBalance] = useState<BuyerBalance | null>(null);
  const [step, setStep] = useState<"idle" | "code">("idle");
  const [phoneMasked, setPhoneMasked] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/delivery/conversations/${conversationId}/buyer-balance`, {
        headers: { "x-buyer-token": buyerToken },
      });
      if (!response.ok) return;
      setBalance(await response.json() as BuyerBalance);
    } catch {
      // réseau instable : on réessaiera
    }
  }, [conversationId, buyerToken]);

  const featureEnabled = balance?.enabled !== false;

  const alreadyVerified = balance?.verified === true;

  useEffect(() => {
    // Fonction inactive côté serveur, ou numéro déjà vérifié : plus aucune requête
    if (!featureEnabled || alreadyVerified) return;
    void load();
    const timer = setInterval(() => { void load(); }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load, featureEnabled, alreadyVerified]);

  // Joueur du challenge « 10Défis » : son numéro a déjà été vérifié par WhatsApp sur cet appareil. On rattache cette
  // conversation à ce numéro SANS second code (le serveur n'accepte que si le numéro de la conversation est exactement
  // celui de la preuve). Une seule tentative par conversation et par session.
  useEffect(() => {
    const stored = loadPhoneProof();
    if (!stored) return;
    const guardKey = `tm_link_proof_${conversationId}`;
    try {
      if (window.sessionStorage.getItem(guardKey)) return;
      window.sessionStorage.setItem(guardKey, "1");
    } catch {
      // stockage de session indisponible : on tente quand même une fois
    }
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/delivery/conversations/${conversationId}/buyer-phone/link-proof`, {
          method: "POST",
          headers: { "x-buyer-token": buyerToken, "Content-Type": "application/json" },
          body: JSON.stringify({ proof: stored.proof }),
        });
        const data = await response.json().catch(() => null) as { linked?: boolean } | null;
        if (!cancelled && data?.linked === true) {
          await load();
          window.dispatchEvent(new Event(BUYER_PHONE_VERIFIED_EVENT));
        }
      } catch {
        // réseau instable : le code WhatsApp reste proposé comme avant
      }
    })();
    return () => { cancelled = true; };
  }, [conversationId, buyerToken, load]);

  const sendCode = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/delivery/conversations/${conversationId}/buyer-phone/send-code`, {
        method: "POST",
        headers: { "x-buyer-token": buyerToken, "Content-Type": "application/json" },
      });
      const data = await response.json().catch(() => null) as { phoneMasked?: string; error?: string } | null;
      if (!response.ok) throw new Error(data?.error ?? (isFrench ? "Envoi du code impossible." : "Could not send the code."));
      setPhoneMasked(data?.phoneMasked ?? null);
      setCode("");
      setStep("code");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/delivery/conversations/${conversationId}/buyer-phone/verify`, {
        method: "POST",
        headers: { "x-buyer-token": buyerToken, "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      const data = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(data?.error ?? (isFrench ? "Code incorrect." : "Wrong code."));
      setStep("idle");
      await load();
      // Le bouton « Solde » et le paiement de la course se rechargent avec le portefeuille débloqué
      window.dispatchEvent(new Event(BUYER_PHONE_VERIFIED_EVENT));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (!balance || balance.enabled === false) return null;

  // Numéro vérifié : plus d'encadré, le bouton « Mon portefeuille » affiche le solde actif total
  if (balance.verified) return null;

  return (
    <div className="mb-2 space-y-2 rounded-lg border bg-muted/40 px-3 py-2 text-xs" data-testid="buyer-total-balance">
      <p className="flex items-center gap-1.5 font-semibold text-foreground">
        <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
        {isFrench ? "Accédez à votre portefeuille" : "Access your wallet"}
      </p>
      {step === "idle" ? (
        <>
          <p className="text-muted-foreground">
            {isFrench
              ? "Votre solde est rattaché à votre numéro, chez tous les vendeurs. Vérifiez ce numéro avec un code WhatsApp pour le voir, l'utiliser pour payer vos courses et le retirer."
              : "Your balance is tied to your phone number, across all sellers. Verify this number with a WhatsApp code to see it, use it to pay your deliveries and withdraw it."}
          </p>
          {error && <p className="text-destructive" role="alert">{error}</p>}
          <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5 text-[11px]" onClick={() => { void sendCode(); }} disabled={busy}>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {isFrench ? "Recevoir le code sur WhatsApp" : "Get the code on WhatsApp"}
          </Button>
        </>
      ) : (
        <>
          <p className="text-muted-foreground">
            {isFrench
              ? `Un code à 6 chiffres a été envoyé sur WhatsApp au numéro ${phoneMasked ?? ""}. Il est valable 5 minutes.`
              : `A 6-digit code was sent on WhatsApp to ${phoneMasked ?? ""}. It is valid for 5 minutes.`}
          </p>
          <div className="flex items-center gap-2">
            <Input
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              className="h-9 w-32 bg-background text-center tracking-widest"
              aria-label={isFrench ? "Code de vérification" : "Verification code"}
            />
            <Button type="button" size="sm" className="h-9" onClick={() => { void verify(); }} disabled={busy || code.length !== 6}>
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {isFrench ? "Valider" : "Verify"}
            </Button>
          </div>
          {error && <p className="text-destructive" role="alert">{error}</p>}
          <button type="button" onClick={() => { void sendCode(); }} disabled={busy} className="text-muted-foreground underline underline-offset-2 hover:no-underline">
            {isFrench ? "Renvoyer un code" : "Send a new code"}
          </button>
        </>
      )}
    </div>
  );
}
