import { useState } from "react";
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

export function loadBuyerIdentity(): BuyerIdentity | null {
  try {
    const raw = localStorage.getItem(BUYER_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveBuyerIdentity(identity: BuyerIdentity) {
  localStorage.setItem(BUYER_KEY, JSON.stringify(identity));
}

interface BuyerIdentityPromptProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: (identity: BuyerIdentity) => void;
}

export function BuyerIdentityPrompt({ open, onOpenChange, onConfirm }: BuyerIdentityPromptProps) {
  const { lang } = useSiteSettings();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");

  const handleConfirm = () => {
    if (!name.trim()) {
      setError(lang === "fr" ? "Votre prénom est requis." : "Your name is required.");
      return;
    }
    if (!phone.trim()) {
      setError(lang === "fr" ? "Votre numéro est requis." : "Your phone number is required.");
      return;
    }
    const identity: BuyerIdentity = { name: name.trim(), phone: phone.trim() };
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
