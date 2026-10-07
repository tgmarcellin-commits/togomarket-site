import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isAcceptablePhone, loadBuyerIdentity } from "@/components/buyer-identity-prompt";
import { GAME_RULES_VERSION, getGameContent } from "@/content/game-rules";
import { clearPhoneProof, loadPhoneProof, sameTypedPhone, savePhoneProof } from "@/lib/phone-proof-store";
import { useSiteSettings } from "@/lib/site-settings";

/** URL du mini-jeu (hébergé séparément) : variable Vite VITE_GAME_URL, lue à la construction du site. */
function resolveGameUrl(): string | null {
  const raw: unknown = import.meta.env.VITE_GAME_URL;
  if (typeof raw !== "string" || raw.trim() === "") return null;
  try {
    const url = new URL(raw.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

type ApiResult = { ok: boolean; status: number; data: Record<string, unknown> | null };

async function postJson(url: string, body: Record<string, unknown>): Promise<ApiResult> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null) as Record<string, unknown> | null;
  return { ok: response.ok, status: response.status, data };
}

/**
 * Fenêtre d'accès au challenge « 10Défis » : règlement, création du compte acheteur par numéro, redirection vers le jeu.
 *  1. le joueur lit le règlement, indique son nom et son numéro WhatsApp, coche « J'ai lu et j'accepte… » ;
 *  2. il reçoit un code sur WhatsApp et le saisit (étape sautée s'il a déjà vérifié CE numéro sur cet appareil) ;
 *  3. son compte acheteur est créé si besoin, l'acceptation est enregistrée par le serveur (qui re-contrôle tout),
 *     et la redirection vers VITE_GAME_URL n'a lieu QU'APRÈS la réponse positive du serveur, avec un jeton de
 *     lancement signé (#tm_launch=…) que le jeu échange contre le numéro prouvé : le joueur ne le ressaisit pas ;
 *  - accessibilité : Échap ferme la fenêtre, le focus passe au champ du code puis revient au bouton d'ouverture.
 */
export function GameRulesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { lang } = useSiteSettings();
  const content = getGameContent(lang);
  const ui = content.dialog;
  const baseId = useId();
  const nameId = `${baseId}-name`;
  const phoneId = `${baseId}-phone`;
  const codeId = `${baseId}-code`;
  const checkboxId = `${baseId}-accept`;
  const errorId = `${baseId}-error`;
  const codeInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<"form" | "code">("form");
  const [accepted, setAccepted] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [maskedPhone, setMaskedPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gameUrl = resolveGameUrl();

  // À chaque ouverture : retour au formulaire, case décochée (le consentement est donné à chaque fois), identité proposée
  useEffect(() => {
    if (!open) return;
    const identity = loadBuyerIdentity();
    setStep("form");
    setAccepted(false);
    setCode("");
    setError(null);
    setSubmitting(false);
    setName(identity?.name ?? "");
    setPhone(identity?.phone ?? "");
  }, [open]);

  // Le focus passe au champ du code quand l'étape de vérification s'affiche
  useEffect(() => {
    if (step === "code") codeInputRef.current?.focus();
  }, [step]);

  const phoneValid = isAcceptablePhone(phone);
  const nameValid = name.replace(/\s+/g, " ").trim().length >= 2;
  const stored = loadPhoneProof();
  const alreadyVerified = Boolean(stored && sameTypedPhone(stored.typedPhone, phone));
  const canContinue = accepted && phoneValid && nameValid && !submitting && gameUrl !== null;
  const codeReady = /^\d{6}$/.test(code.replace(/\s/g, ""));

  const errorText = (result: ApiResult): string =>
    typeof result.data?.["error"] === "string" ? (result.data["error"] as string) : ui.genericError;

  /** Enregistre l'acceptation (le serveur re-vérifie la case, la version du règlement et la preuve du numéro), puis redirige. */
  const acceptAndRedirect = async (proof: string): Promise<void> => {
    if (!gameUrl) {
      setError(ui.gameUnavailable);
      setSubmitting(false);
      return;
    }
    const result = await postJson("/api/game/accept-rules", {
      accepted: true,
      rulesVersion: GAME_RULES_VERSION,
      phoneNumber: phone.trim(),
      proof,
    });
    if (!result.ok || result.data?.["ok"] !== true) {
      if (result.data?.["code"] === "phone_not_verified") {
        // preuve refusée (expirée, autre numéro) : on repart d'une vérification par code
        clearPhoneProof();
        setStep("form");
        setCode("");
      }
      setError(errorText(result));
      setSubmitting(false);
      return;
    }
    // Le jeton de lancement est passé dans le FRAGMENT de l'adresse (#tm_launch=…) : un fragment n'est jamais envoyé aux
    // serveurs ni aux journaux. Le jeu le lit, l'efface de la barre d'adresse et l'échange auprès de TogoMarket.
    const launchToken = result.data["launchToken"];
    if (typeof launchToken !== "string" || launchToken.length < 20) {
      setError(ui.genericError);
      setSubmitting(false);
      return;
    }
    const target = new URL(gameUrl);
    target.hash = `tm_launch=${encodeURIComponent(launchToken)}`;
    window.location.assign(target.toString());
  };

  const sendCode = async (): Promise<void> => {
    const result = await postJson("/api/phone/send-code", { phoneNumber: phone.trim(), name: name.trim() });
    if (!result.ok || result.data?.["sent"] !== true) {
      setError(errorText(result));
      setSubmitting(false);
      return;
    }
    setMaskedPhone(typeof result.data["phoneMasked"] === "string" ? (result.data["phoneMasked"] as string) : "");
    setCode("");
    setStep("code");
    setSubmitting(false);
  };

  const verifyCode = async (): Promise<void> => {
    const result = await postJson("/api/phone/verify-code", {
      phoneNumber: phone.trim(),
      name: name.trim(),
      code: code.replace(/\s/g, ""),
    });
    const proof = result.data?.["proof"];
    const expiresAt = result.data?.["expiresAt"];
    if (!result.ok || result.data?.["ok"] !== true || typeof proof !== "string" || typeof expiresAt !== "number") {
      setError(errorText(result));
      setSubmitting(false);
      return;
    }
    savePhoneProof({ typedPhone: phone.trim(), proof, expiresAt });
    await acceptAndRedirect(proof);
  };

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (submitting) return;
    // Le bouton désactivé ne suffit pas : on re-contrôle ici, puis le serveur re-contrôle à son tour
    if (step === "form" && !(accepted && phoneValid && nameValid)) return;
    if (step === "code" && !codeReady) return;
    if (!gameUrl) {
      setError(ui.gameUnavailable);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      if (step === "form") {
        if (alreadyVerified && stored) await acceptAndRedirect(stored.proof);
        else await sendCode();
      } else {
        await verifyCode();
      }
    } catch {
      setError(ui.networkError);
      setSubmitting(false);
    }
  };

  const resend = async (): Promise<void> => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await sendCode();
    } catch {
      setError(ui.networkError);
      setSubmitting(false);
    }
  };

  // Fichier de contenu obsolète (content/game-rules.ts d'une ancienne livraison) : on le signale dès l'affichage de la carte,
  // AVANT que le joueur ne déclenche l'envoi d'un code WhatsApp, au lieu de planter plus tard sur un texte absent.
  // (Placé après tous les hooks ; l'erreur est contenue par GameDialogBoundary et ne touche pas le reste du site.)
  const missingContent = (["nameLabel", "sendCode", "codeLabel", "codeHelp", "verifyAndPlay"] as const)
    .filter((key) => typeof ui[key] !== "string");
  if (missingContent.length > 0) {
    throw new Error(`content/game-rules.ts obsolète : textes manquants (${missingContent.join(", ")}). Remplacez-le par la dernière version.`);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!submitting) onOpenChange(next); }}>
      <DialogContent translate="no" className="max-w-lg max-h-[90vh] overflow-y-auto" aria-describedby={`${baseId}-description`}>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <DialogHeader>
            <DialogTitle>{ui.title}</DialogTitle>
            <DialogDescription id={`${baseId}-description`}>{ui.description}</DialogDescription>
          </DialogHeader>

          {/* Texte du règlement : zone défilante accessible au clavier (Tab puis flèches) */}
          <div
            role="region"
            aria-label={ui.rulesRegionLabel}
            tabIndex={0}
            className="max-h-48 space-y-3 overflow-y-auto rounded-lg border bg-muted/40 p-3 text-sm leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {content.rules.map((rule) => (
              <p key={rule.title}>
                <strong className="text-foreground">{rule.title}</strong>
                <span className="text-muted-foreground"> — {rule.body}</span>
              </p>
            ))}
          </div>

          {step === "form" ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor={nameId}>{ui.nameLabel}</Label>
                <Input
                  id={nameId}
                  type="text"
                  autoComplete="name"
                  value={name}
                  onChange={(event) => { setName(event.target.value); setError(null); }}
                  placeholder={ui.namePlaceholder}
                  maxLength={60}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor={phoneId}>{ui.phoneLabel}</Label>
                <Input
                  id={phoneId}
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={phone}
                  onChange={(event) => { setPhone(event.target.value); setError(null); }}
                  placeholder={ui.phonePlaceholder}
                  aria-invalid={phone !== "" && !phoneValid}
                  aria-describedby={`${phoneId}-help`}
                />
                <p id={`${phoneId}-help`} className="text-xs text-muted-foreground">{ui.phoneHelp} {ui.accountNote}</p>
              </div>

              <div className="flex items-start gap-2">
                <Checkbox
                  id={checkboxId}
                  checked={accepted}
                  onCheckedChange={(value) => { setAccepted(value === true); setError(null); }}
                  className="mt-0.5"
                />
                <Label htmlFor={checkboxId} className="cursor-pointer text-sm font-medium leading-snug">
                  {ui.checkbox}
                </Label>
              </div>
            </>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor={codeId}>{ui.codeLabel}</Label>
              <Input
                id={codeId}
                ref={codeInputRef}
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(event) => { setCode(event.target.value.replace(/\D/g, "").slice(0, 6)); setError(null); }}
                placeholder={ui.codePlaceholder}
                className="max-w-40 text-center tracking-widest"
                aria-describedby={`${codeId}-help`}
              />
              <p id={`${codeId}-help`} className="text-xs text-muted-foreground">{ui.codeHelp.replace("{phone}", maskedPhone)}</p>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                <button type="button" onClick={() => { void resend(); }} disabled={submitting} className="text-muted-foreground underline underline-offset-2 hover:no-underline">
                  {ui.resend}
                </button>
                <button type="button" onClick={() => { setStep("form"); setError(null); }} disabled={submitting} className="text-muted-foreground underline underline-offset-2 hover:no-underline">
                  {ui.changeNumber}
                </button>
              </div>
            </div>
          )}

          {(error || (!gameUrl && open)) && (
            <p id={errorId} className="text-sm text-destructive" role="alert">
              {error ?? ui.gameUnavailable}
            </p>
          )}

          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              {ui.cancel}
            </Button>
            <Button
              type="submit"
              disabled={step === "form" ? !canContinue : !(codeReady && !submitting)}
              aria-describedby={error ? errorId : undefined}
            >
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              {submitting ? ui.playing : step === "code" ? ui.verifyAndPlay : alreadyVerified ? ui.play : ui.sendCode}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
