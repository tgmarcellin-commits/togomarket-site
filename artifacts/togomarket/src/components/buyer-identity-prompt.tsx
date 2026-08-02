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

/** Numéro officiel de la plateforme TogoMarket — toujours affiché comme "TogoMarket" */
const TOGOMARKET_PHONE = "22870703131";

export function normalizePhone(p: string) {
  return p.replace(/\D/g, "").replace(/^00/, "").replace(/^\+/, "");
}

function applyTogoMarketRule(identity: BuyerIdentity): BuyerIdentity {
  if (normalizePhone(identity.phone) === TOGOMARKET_PHONE && identity.name !== "TogoMarket") {
    const corrected = { ...identity, name: "TogoMarket" };
    // Persist the correction silently
    try { localStorage.setItem(BUYER_KEY, JSON.stringify(corrected)); } catch {}
    return corrected;
  }
  return identity;
}

export function loadBuyerIdentity(): BuyerIdentity | null {
  try {
    const raw = localStorage.getItem(BUYER_KEY);
    if (!raw) return null;
    return applyTogoMarketRule(JSON.parse(raw) as BuyerIdentity);
  } catch {
    return null;
  }
}

export function saveBuyerIdentity(identity: BuyerIdentity) {
  localStorage.setItem(BUYER_KEY, JSON.stringify(applyTogoMarketRule(identity)));
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

export function BuyerIdentityPrompt({ open, onOpenChange, onConfirm, defaultName = "", defaultPhone = "" }: BuyerIdentityPromptProps) {
  const { lang } = useSiteSettings();
  const [name, setName] = useState(defaultName);
  const [phone, setPhone] = useState(defaultPhone);
  const [error, setError] = useState("");

  // Re-populate fields whenever the dialog opens (handles re-use of the same component instance)
  useEffect(() => {
    if (open) {
      setName(defaultName);
      setPhone(defaultPhone);
      setError("");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleConfirm = () => {
    if (!phone.trim()) {
      setError(lang === "fr" ? "Votre numéro est requis." : "Your phone number is required.");
      return;
    }
    // Numéro TogoMarket → nom imposé automatiquement, pas de saisie requise
    const isTogoMarket = normalizePhone(phone.trim()) === TOGOMARKET_PHONE;
    const resolvedName = isTogoMarket ? "TogoMarket" : name.trim();
    if (!resolvedName) {
      setError(lang === "fr" ? "Votre prénom est requis." : "Your name is required.");
      return;
    }
    const identity: BuyerIdentity = { name: resolvedName, phone: phone.trim() };
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
              placeholder={lang === "fr" ? "Ex : 90123456" : "e.g. 90123456"}
              value={phone}
              onChange={(e) => { setPhone(e.target.value); setError(""); }}
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <Button className="w-full" onClick={handleConfirm}>
            {lang === "fr" ? "Commencer le chat" : "Start chat"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
