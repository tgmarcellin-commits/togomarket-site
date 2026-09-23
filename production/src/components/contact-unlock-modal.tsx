import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCreateContactRequest, type Listing } from "@workspace/api-client-react";
import { openWhatsApp } from "@/lib/whatsapp";
import { Phone, AlertTriangle, MessageCircle } from "lucide-react";
import { useSiteSettings } from "@/lib/site-settings";
import { useT } from "@/lib/i18n";

interface ContactUnlockModalProps {
  open: boolean;
  onClose: () => void;
  listing: Listing;
  commissionRate: number;
}

function calcCommission(price: number, rate: number): number {
  if (rate === 0) return 0;
  return Math.round(Math.min(Number(price), 100000) * rate / 100);
}

const WhatsAppIcon = () => (
  <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current flex-shrink-0">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
  </svg>
);

export function ContactUnlockModal({ open, onClose, listing, commissionRate }: ContactUnlockModalProps) {
  const { lang } = useSiteSettings();
  const t = useT(lang);

  const [step, setStep] = useState<"form" | "payment" | "reveal">("form");
  const [buyerName, setBuyerName] = useState("");
  const [buyerPhone, setBuyerPhone] = useState("");
  const [error, setError] = useState("");

  const createRequest = useCreateContactRequest();
  const commission = calcCommission(Number(listing.price), commissionRate);
  const isFree = commissionRate === 0;
  const commissionFormatted = new Intl.NumberFormat("fr-FR").format(commission);
  const vendorPhone = (listing.phone ?? "").replace(/\D/g, "");

  const whatsappMessage = lang === "fr"
    ? `Prénom: ${buyerName}\nBonjour Mr/Mme je souhaite avoir plus de renseignements sur l'article: ${listing.name} publié sur TogoMarket.`
    : `First name: ${buyerName}\nHello, I would like more information about the item: ${listing.name} listed on TogoMarket.`;

  const handleClose = () => {
    setStep("form");
    setBuyerName("");
    setBuyerPhone("");
    setError("");
    onClose();
  };

  const handleSubmit = () => {
    if (!buyerName.trim()) { setError(t.enterFirstNameError); return; }
    if (!buyerPhone.trim()) { setError(t.enterPhoneError); return; }
    setError("");

    createRequest.mutate(
      { data: { listingId: listing.id, buyerName: buyerName.trim(), buyerPhone: buyerPhone.trim() } },
      {
        onSuccess: () => {
          if (isFree) {
            setStep("reveal");
          } else {
            setStep("payment");
          }
        },
        onError: () => setError(t.errorOccurred),
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="sm:max-w-[400px]">

        {step === "form" && (
          <>
            <DialogHeader>
              <DialogTitle>{t.unlockContactTitle}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-1">
              <p className="text-sm leading-relaxed">
                {lang === "fr" ? (
                  <>
                    Vous êtes sur le point de débloquer{" "}
                    {isFree ? (
                      <span className="font-semibold text-green-600">gratuitement</span>
                    ) : (
                      <>à <span className="font-semibold text-primary">{commissionFormatted} FCFA</span></>
                    )}{" "}
                    le contact du vendeur de l'article :{" "}
                    <span className="font-semibold">« {listing.name} »</span>
                  </>
                ) : (
                  <>
                    You are about to unlock the seller's contact for "{listing.name}"{" "}
                    {isFree ? (
                      <span className="font-semibold text-green-600">for free</span>
                    ) : (
                      <>for <span className="font-semibold text-primary">{commissionFormatted} FCFA</span></>
                    )}.
                  </>
                )}
              </p>

              <div className="space-y-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {t.clientInfo}
                </p>
                <Input
                  placeholder={t.yourFirstName}
                  value={buyerName}
                  onChange={(e) => setBuyerName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                />
                <Input
                  placeholder={t.yourPhone}
                  type="tel"
                  value={buyerPhone}
                  onChange={(e) => setBuyerPhone(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                />
                {error && <p className="text-sm text-destructive">{error}</p>}
              </div>

              <Button className="w-full" onClick={handleSubmit} disabled={createRequest.isPending}>
                {createRequest.isPending
                  ? t.registering
                  : isFree
                  ? t.continue_
                  : t.payAmount(commission)}
              </Button>
            </div>
          </>
        )}

        {step === "payment" && (
          <>
            <DialogHeader>
              <DialogTitle>{t.paymentTitle}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-1">
              <div className="rounded-lg bg-muted p-4 text-center space-y-1">
                <p className="text-xs text-muted-foreground">{t.amountToPay}</p>
                <p className="text-2xl font-extrabold text-primary">{commissionFormatted} FCFA</p>
                <p className="text-xs text-muted-foreground">{t.articleLabel} : {listing.name}</p>
              </div>

              <div className="rounded-lg border-2 border-dashed border-muted-foreground/30 p-6 text-center text-muted-foreground text-sm">
                <MessageCircle className="w-8 h-8 mx-auto mb-2 opacity-40" />
                {t.paymentIntegration}
              </div>

              <p className="text-xs text-center text-muted-foreground">{t.afterPayment}</p>
              <Button variant="outline" className="w-full" onClick={handleClose}>
                {t.cancel}
              </Button>
            </div>
          </>
        )}

        {step === "reveal" && (
          <>
            <DialogHeader>
              <DialogTitle>{t.contactUnlocked}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-1">
              <p className="text-sm text-muted-foreground">{t.contactVendorAt}</p>

              <div className="flex items-center gap-3 bg-primary/5 border border-primary/20 rounded-xl p-4">
                <Phone className="w-6 h-6 text-primary flex-shrink-0" />
                <span className="text-2xl font-extrabold tracking-wider text-primary">
                  {listing.phone}
                </span>
              </div>

              <div className="flex items-start gap-2 bg-destructive/10 rounded-lg p-3">
                <AlertTriangle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
                <p className="text-xs text-destructive font-semibold leading-relaxed">
                  {t.warningNoPayShort}
                </p>
              </div>

              <Button
                className="w-full bg-green-600 hover:bg-green-700 text-white gap-2"
                onClick={() =>
                  openWhatsApp(
                    `https://wa.me/${vendorPhone}?text=${encodeURIComponent(whatsappMessage)}`
                  )
                }
              >
                <WhatsAppIcon />
                {t.startWhatsApp}
              </Button>

              <Button variant="outline" className="w-full" onClick={handleClose}>
                {t.close}
              </Button>
            </div>
          </>
        )}

      </DialogContent>
    </Dialog>
  );
}
