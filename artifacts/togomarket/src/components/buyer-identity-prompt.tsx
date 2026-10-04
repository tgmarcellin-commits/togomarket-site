import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSiteSettings } from "@/lib/site-settings";
import { MessageCircle } from "lucide-react";

export interface BuyerIdentity {
  name: string;
  phone: string;
}

const BUYER_KEY = "tm_buyer";

/**
 * Combinaison secrète exclusive pour l'identité TogoMarket.
 * Seule cette combinaison exacte (prénom + code) est acceptée pour afficher "TogoMarket".
 * Toute tentative d'utiliser l'un sans l'autre est rejetée.
 */
const TM_SECRET_NAME  = "TogoMarket";
const TM_SECRET_PHONE = "##007##";

export function normalizePhone(p: string) {
  return p.replace(/\D/g, "").replace(/^00/, "").replace(/^\+/, "");
}

/**
 * Un numéro est accepté s'il est écrit avec son indicatif international (« + » ou « 00 »), de n'importe quel pays,
 * ou s'il est reconnaissable sans « + » : 8 chiffres (Togo, +228), 01 + 8 chiffres (Bénin) ou un numéro qui commence
 * déjà par l'indicatif togolais, béninois, ivoirien, sénégalais, nigérien, malien ou burkinabè.
 * Le texte saisi est conservé tel quel : le serveur le normalise, et la clé acheteur en dépend.
 */
const KNOWN_DIAL_CODES = /^(228|229|225|221|227|223|226)/;

export function isAcceptablePhone(raw: string): boolean {
  const compact = raw.trim().replace(/[\s\-.()]/g, "");
  const digits = compact.replace(/\D/g, "");
  if (!/^[+\d]+$/.test(compact) || digits.length < 8 || digits.length > 15) return false;
  if (/^(\+|00)/.test(compact)) return true;
  if (digits.length === 8) return true; // numéro local togolais
  if (/^01\d{8}$/.test(digits)) return true; // Bénin, nouveau format local
  return KNOWN_DIAL_CODES.test(digits) && digits.length >= 11;
}

/** Returns true if the identity is the authentic TogoMarket secret combo */
function isTogoMarketCombo(name: string, phone: string): boolean {
  return name.trim() === TM_SECRET_NAME && phone.trim() === TM_SECRET_PHONE;
}

export function loadBuyerIdentity(): BuyerIdentity | null {
  try {
    const raw = localStorage.getItem(BUYER_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as BuyerIdentity;
  } catch {
    return null;
  }
}

export function saveBuyerIdentity(identity: BuyerIdentity) {
  try {
    localStorage.setItem(BUYER_KEY, JSON.stringify(identity));
  } catch {}
}

interface BuyerIdentityPromptProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: (identity: BuyerIdentity) => void;
  /** Pre-fill the name field (e.g. from a previously saved identity) */
  defaultName?: string;
  /** Pre-fill the phone field */
  defaultPhone?: string;
}

export function BuyerIdentityPrompt({
  open, onOpenChange, onConfirm,
  defaultName = "", defaultPhone = "",
}: BuyerIdentityPromptProps) {
  const { lang } = useSiteSettings();
  const [name, setName] = useState(defaultName);
  const [phone, setPhone] = useState(defaultPhone);
  const [error, setError] = useState("");

  // Re-populate fields whenever the dialog opens
  useEffect(() => {
    if (open) {
      setName(defaultName);
      setPhone(defaultPhone);
      setError("");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleConfirm = () => {
    const trimName  = name.trim();
    const trimPhone = phone.trim();

    if (!trimPhone) {
      setError(lang === "fr" ? "Votre numéro est requis." : "Your phone number is required.");
      return;
    }

    // ── Règles de protection de l'identité TogoMarket ──────────────────────
    // "TogoMarket" comme prénom → accepté UNIQUEMENT avec le code secret complet
    if (trimName.toLowerCase() === TM_SECRET_NAME.toLowerCase() && trimPhone !== TM_SECRET_PHONE) {
      setError(lang === "fr" ? "Identifiant réservé. Échec." : "Reserved identity. Failed.");
      return;
    }
    // Code secret seul (sans le bon prénom) → refusé
    if (trimPhone === TM_SECRET_PHONE && trimName !== TM_SECRET_NAME) {
      setError(lang === "fr" ? "Code réservé. Échec." : "Reserved code. Failed.");
      return;
    }
    // ── Fin des règles ──────────────────────────────────────────────────────

    // Combinaison secrète valide → identité TogoMarket
    if (isTogoMarketCombo(trimName, trimPhone)) {
      const identity: BuyerIdentity = { name: TM_SECRET_NAME, phone: TM_SECRET_PHONE };
      saveBuyerIdentity(identity);
      onConfirm(identity);
      return;
    }

    // Utilisateur normal
    if (!trimName) {
      setError(lang === "fr" ? "Votre prénom est requis." : "Your name is required.");
      return;
    }

    if (!isAcceptablePhone(trimPhone)) {
      setError(lang === "fr"
        ? "Numéro invalide. Saisissez-le avec l'indicatif de votre pays, par exemple +22897000000."
        : "Invalid number. Enter it with your country code, for example +22897000000.");
      return;
    }

    const identity: BuyerIdentity = { name: trimName, phone: trimPhone };
    saveBuyerIdentity(identity);
    onConfirm(identity);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageCircle className="w-5 h-5 text-primary" />
            {lang === "fr" ? "Votre identité" : "Your identity"}
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground -mt-1">
          {lang === "fr"
            ? "Pour contacter le vendeur, merci de vous identifier."
            : "To contact the seller, please identify yourself."}
        </p>
        <div className="space-y-3 pt-1">
          <div>
            <label className="text-sm font-medium block mb-1">
              {lang === "fr" ? "Votre prénom *" : "Your first name *"}
            </label>
            <Input
              placeholder={lang === "fr" ? "Ex : Koffi" : "e.g. John"}
              value={name}
              onChange={(e) => { setName(e.target.value); setError(""); }}
            />
          </div>
          <div>
            <label className="text-sm font-medium block mb-1">
              {lang === "fr" ? "Votre téléphone *" : "Your phone *"}
            </label>
            <Input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder={lang === "fr" ? "Ex : +22897000000" : "e.g. +22897000000"}
              value={phone}
              onChange={(e) => { setPhone(e.target.value); setError(""); }}
            />
            <p className="text-xs text-muted-foreground mt-1">
              {lang === "fr"
                ? "Numéro WhatsApp avec l'indicatif de votre pays (+228 Togo, +229 Bénin, +33 France…). Un numéro à 8 chiffres sans indicatif est considéré comme togolais."
                : "WhatsApp number with your country code (+228 Togo, +229 Benin, +33 France…). An 8-digit number without a code is treated as a Togo number."}
            </p>
          </div>
          {error && <p className="text-xs text-destructive font-medium">{error}</p>}
          <Button className="w-full" onClick={handleConfirm}>
            {lang === "fr" ? "Commencer le chat" : "Start chat"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
