import { useState, useEffect } from "react";
import {
  useVendorGetListings,
  useVendorUpdateListingPrice,
  useVendorDeleteListing,
  useGetVendorContactRequests,
  getGetListingsQueryKey,
  type VendorProfile,
  type Listing,
  type ContactRequestStat,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { UserCircle2, Package, Clock, Trash2, Pencil, LogIn, Store, Bell, Copy, Check, Link2, AlertTriangle, XCircle, CreditCard } from "lucide-react";
import { resolveImageUrl, isVideoMedia, resolveMediaUrl } from "@/lib/image";
import { encodeShopToken } from "@/lib/shop-token";
import { useSiteSettings } from "@/lib/site-settings";
import { useT } from "@/lib/i18n";
import { PublishModal } from "@/components/publish-modal";

function BoutiqueMediaThumb({ path, alt }: { path: string; alt: string }) {
  const [isVid, setIsVid] = useState(isVideoMedia(path));
  if (isVid) {
    return (
      <div className="w-16 h-16 rounded-lg bg-black flex-shrink-0 relative overflow-hidden">
        <video src={resolveMediaUrl(path)} className="w-full h-full object-cover" muted playsInline />
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="bg-black/50 rounded-full w-6 h-6 flex items-center justify-center">
            <svg className="w-3 h-3 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
          </div>
        </div>
      </div>
    );
  }
  return (
    <img
      src={resolveImageUrl(path)}
      alt={alt}
      className="w-16 h-16 rounded-lg object-contain bg-black flex-shrink-0"
      onError={() => setIsVid(true)}
    />
  );
}

interface BoutiqueViewProps {
  vendor: VendorProfile | null;
  vendorPassword: string;
  onNeedLogin: () => void;
}

function ConfirmDialog({
  open,
  title,
  description,
  onConfirm,
  onCancel,
  confirmLabel,
  cancelLabel,
  loading,
  destructive,
}: {
  open: boolean;
  title: string;
  description: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
  loading?: boolean;
  destructive?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="sm:max-w-[360px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{description}</p>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onCancel} disabled={loading}>
            {cancelLabel ?? "Annuler"}
          </Button>
          <Button
            onClick={onConfirm}
            disabled={loading}
            variant={destructive ? "destructive" : "default"}
          >
            {loading ? "..." : (confirmLabel ?? "Confirmer")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PaymentButton({
  vendor,
  vendorPassword,
  label,
  onSuccess,
}: {
  vendor: VendorProfile;
  vendorPassword: string;
  label?: string;
  onSuccess?: () => void;
}) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  const handlePay = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/fedapay/create-transaction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityType: "vendor",
          entityId: vendor.id,
          customerName: `${vendor.firstName} ${vendor.lastName}`,
          customerPhone: vendor.phone,
          ownerCredential: vendorPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: "Erreur de paiement", description: data.error ?? "Réessayez", variant: "destructive" });
        return;
      }
      if (data.widgetUrl) {
        window.open(data.widgetUrl, "_blank");
        toast({ title: "Paiement ouvert", description: "Complétez le paiement dans l'onglet ouvert. Votre boutique sera activée automatiquement." });
        onSuccess?.();
      }
    } catch {
      toast({ title: "Erreur réseau", description: "Impossible de créer la transaction FedaPay", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      onClick={handlePay}
      disabled={loading}
      className="gap-2 bg-green-600 hover:bg-green-700 text-white"
    >
      <CreditCard className="w-4 h-4" />
      {loading ? "Chargement…" : (label ?? "Payer 1 000 FCFA/mois")}
    </Button>
  );
}

export function BoutiqueView({ vendor, vendorPassword, onNeedLogin }: BoutiqueViewProps) {
  const { lang } = useSiteSettings();
  const t = useT(lang);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [listings, setListings] = useState<Listing[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Listing | null>(null);
  const [tourismeEditTarget, setTourismeEditTarget] = useState<Listing | null>(null);
  const [priceTarget, setPriceTarget] = useState<Listing | null>(null);
  const [newPrice, setNewPrice] = useState("");
  const [newPromoPrice, setNewPromoPrice] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [contactStats, setContactStats] = useState<ContactRequestStat[]>([]);

  const updatePrice = useVendorUpdateListingPrice();
  const deleteListing = useVendorDeleteListing();
  const getListings = useVendorGetListings();
  const getContactRequests = useGetVendorContactRequests();

  const refetch = () => {
    if (!vendor) return;
    setIsLoading(true);
    getListings.mutate(
      { data: { phone: vendor.phone, password: vendorPassword } },
      {
        onSuccess: (data) => { setListings(data); setIsLoading(false); },
        onError: () => setIsLoading(false),
      }
    );
    getContactRequests.mutate(
      { data: { phone: vendor.phone, password: vendorPassword } },
      { onSuccess: (data) => setContactStats(data) }
    );
  };

  useEffect(() => {
    if (vendor) refetch();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendor?.phone]);

  if (!vendor) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
        <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
          <Store className="w-8 h-8 text-muted-foreground" />
        </div>
        <h2 className="text-xl font-bold mb-2">{t.yourShop}</h2>
        <p className="text-muted-foreground mb-6 max-w-xs">{t.shopLoginDesc}</p>
        <Button onClick={onNeedLogin} className="gap-2">
          <LogIn className="w-4 h-4" />
          {t.signIn}
        </Button>
      </div>
    );
  }

  const managedListings = (() => {
    const result: Listing[] = [];
    const tourismeByName = new Map<string, Listing>();

    for (const listing of listings ?? []) {
      if (listing.sector !== "Tourisme") {
        result.push(listing);
        continue;
      }

      const key = listing.name.toLowerCase().trim();
      const existing = tourismeByName.get(key);
      if (existing) {
        existing.images = Array.from(new Set([...(existing.images ?? []), ...(listing.images ?? [])]));
        existing.approved = existing.approved || listing.approved;
        existing.pinned = existing.pinned || listing.pinned;
      } else {
        const catalog = { ...listing, images: [...(listing.images ?? [])] };
        tourismeByName.set(key, catalog);
        result.push(catalog);
      }
    }

    return result;
  })();
  const tourismeCatalogs = managedListings.filter((listing) => listing.sector === "Tourisme");

  const handleDeleteConfirm = () => {
    if (!deleteTarget) return;
    deleteListing.mutate(
      { data: { id: deleteTarget.id, phone: vendor.phone, password: vendorPassword } },
      {
        onSuccess: () => {
          toast({ title: t.listingDeleted });
          setDeleteTarget(null);
          queryClient.invalidateQueries({ queryKey: getGetListingsQueryKey() });
          refetch();
        },
        onError: () => toast({ title: t.deletionError, variant: "destructive" }),
      }
    );
  };

  const daysUntilExpiry = vendor.daysUntilExpiry ?? null;
  const isInactive = vendor.isPublished === false;
  const isExpired = isInactive || (daysUntilExpiry !== null && daysUntilExpiry <= 0);
  const isExpiringSoon = !isInactive && daysUntilExpiry !== null && daysUntilExpiry > 0 && daysUntilExpiry <= 3;

  if (isExpired) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-6 text-center min-h-[70vh]">
        <div className="w-20 h-20 bg-destructive/10 rounded-full flex items-center justify-center mb-6">
          <XCircle className="w-10 h-10 text-destructive" />
        </div>
        <h2 className="text-2xl font-bold text-destructive mb-2">
          {isInactive && daysUntilExpiry !== null && daysUntilExpiry > 0
            ? "Boutique désactivée"
            : "Boutique expirée"}
        </h2>
        <p className="text-muted-foreground mb-2 max-w-xs">
          {isInactive && daysUntilExpiry !== null && daysUntilExpiry > 0
            ? "Votre boutique a été désactivée par l'administrateur. Contactez l'admin ou renouvelez votre abonnement pour la réactiver."
            : "Votre abonnement a expiré. Renouvelez maintenant pour remettre votre boutique en ligne et continuer à vendre."}
        </p>
        <div className="bg-muted rounded-xl p-4 mb-6 max-w-xs text-sm text-left space-y-1">
          <p className="font-semibold">{vendor.firstName} {vendor.lastName} — N°{vendor.id}</p>
          <p className="text-muted-foreground text-xs">Abonnement mensuel · 1 000 FCFA</p>
          <p className="text-muted-foreground text-xs">Les frais de transaction FedaPay sont à votre charge.</p>
        </div>
        <PaymentButton vendor={vendor} vendorPassword={vendorPassword} label="Renouveler mon abonnement" onSuccess={refetch} />
        <p className="text-xs text-muted-foreground mt-4 max-w-xs">
          Votre boutique sera réactivée automatiquement après confirmation du paiement.
        </p>
        {(isLoading || tourismeCatalogs.length > 0) && (
          <div className="w-full mt-8 pt-6 border-t text-left">
            <h3 className="font-semibold text-sm mb-1">Mes catalogues Tourisme</h3>
            <p className="text-xs text-muted-foreground mb-3">
              Vos catalogues Tourisme restent publics et peuvent être gérés même si la boutique est expirée.
            </p>
            {isLoading ? (
              <div className="rounded-xl border bg-card h-24 animate-pulse" />
            ) : (
              <div className="space-y-3">
                {tourismeCatalogs.map((catalog) => (
                  <div key={catalog.id} className="rounded-xl border bg-card p-3 flex gap-3">
                    {catalog.images?.[0] ? (
                      <BoutiqueMediaThumb path={catalog.images[0]} alt={catalog.name} />
                    ) : (
                      <div className="w-16 h-16 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                        <Package className="w-6 h-6 text-muted-foreground" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm break-words">{catalog.name}</p>
                      <p className="text-xs text-muted-foreground break-words">{catalog.location}</p>
                      <div className="flex gap-2 mt-2 flex-wrap">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs gap-1"
                          onClick={() => setTourismeEditTarget(catalog)}
                        >
                          <Pencil className="w-3 h-3" />
                          Modifier le catalogue
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs gap-1 text-destructive border-destructive/30 hover:bg-destructive/10"
                          onClick={() => setDeleteTarget(catalog)}
                        >
                          <Trash2 className="w-3 h-3" />
                          Supprimer le catalogue
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <ConfirmDialog
          open={!!deleteTarget}
          title="Supprimer le catalogue ?"
          description={`Êtes-vous sûr de vouloir supprimer le catalogue « ${deleteTarget?.name ?? ""} » ? Toutes ses photos et vidéos seront supprimées.`}
          confirmLabel={t.delete}
          cancelLabel={t.cancel}
          destructive
          loading={deleteListing.isPending}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteTarget(null)}
        />
        <PublishModal
          open={!!tourismeEditTarget}
          onOpenChange={(open) => {
            if (!open) setTourismeEditTarget(null);
          }}
          vendor={vendor}
          vendorPassword={vendorPassword}
          onNeedLogin={onNeedLogin}
          onVendorRefresh={() => {}}
          editListing={tourismeEditTarget}
          onEditSuccess={() => {
            setTourismeEditTarget(null);
            refetch();
          }}
        />
      </div>
    );
  }

  const published = managedListings.filter((l) => l.approved);
  const pending = managedListings.filter((l) => !l.approved);

  const handlePriceConfirm = () => {
    if (!priceTarget || !newPrice) return;
    const parsed = parseFloat(newPrice.replace(",", "."));
    if (isNaN(parsed) || parsed <= 0) {
      toast({ title: t.invalidPrice, variant: "destructive" });
      return;
    }
    let promo: number | null = null;
    if (newPromoPrice.trim()) {
      promo = parseFloat(newPromoPrice.replace(",", "."));
      if (isNaN(promo) || promo <= 0) {
        toast({ title: "Prix promotionnel invalide", variant: "destructive" });
        return;
      }
      if (promo >= parsed) {
        toast({ title: "Le prix promo doit être inférieur au prix réel", variant: "destructive" });
        return;
      }
    }
    updatePrice.mutate(
      { data: { id: priceTarget.id, phone: vendor.phone, password: vendorPassword, newPrice: parsed, promoPrice: promo, description: newDescription.trim() || null } },
      {
        onSuccess: () => {
          toast({ title: t.priceUpdated });
          setPriceTarget(null);
          setNewPrice("");
          queryClient.invalidateQueries({ queryKey: getGetListingsQueryKey() });
          refetch();
        },
        onError: () => toast({ title: t.updateError, variant: "destructive" }),
      }
    );
  };

  return (
    <div className="container mx-auto px-4 py-6 max-w-2xl">
      {/* Expiry warning banner */}
      {isExpiringSoon && (
        <div className="rounded-xl border border-orange-300 bg-orange-50 p-4 mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-orange-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-orange-800 text-sm">
                Abonnement expire dans {daysUntilExpiry} jour{daysUntilExpiry > 1 ? "s" : ""}
              </p>
              <p className="text-orange-600 text-xs mt-0.5">
                Renouvelez maintenant pour éviter l'interruption de votre boutique.
              </p>
            </div>
          </div>
          <PaymentButton vendor={vendor} vendorPassword={vendorPassword} label="Renouveler (1 000 FCFA)" onSuccess={refetch} />
        </div>
      )}

      {/* Profile header */}
      <div className="flex items-center gap-4 mb-6">
        <div className="w-14 h-14 rounded-full border-2 border-primary/30 overflow-hidden flex-shrink-0 bg-muted flex items-center justify-center">
          {vendor.profilePhoto ? (
            <img src={resolveImageUrl(vendor.profilePhoto)} alt={vendor.firstName} className="w-full h-full object-cover" />
          ) : (
            <UserCircle2 className="w-8 h-8 text-muted-foreground" />
          )}
        </div>
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="font-bold text-lg leading-tight">{vendor.firstName} {vendor.lastName}</h2>
            <span className="text-xs bg-primary text-primary-foreground font-bold px-2.5 py-0.5 rounded-full">N°{vendor.id}</span>
          </div>
          <p className="text-sm text-muted-foreground">{vendor.phone}</p>
          {daysUntilExpiry !== null && daysUntilExpiry > 0 && (
            <p className={`text-xs mt-0.5 font-medium ${isExpiringSoon ? "text-orange-600" : "text-green-600"}`}>
              {daysUntilExpiry > 30
                ? `Essai gratuit — expire dans ${daysUntilExpiry} jours`
                : `Abonnement actif — expire dans ${daysUntilExpiry} jour${daysUntilExpiry > 1 ? "s" : ""}`}
            </p>
          )}
        </div>
      </div>

      {/* Lien partageable de la boutique — validité liée à l'abonnement actif */}
      {vendor.isPublished ? (() => {
        const shopUrl = `${window.location.origin}/?shop=${encodeShopToken(vendor.id)}`;
        const daysLeft = vendor.daysUntilExpiry ?? 0;
        const isCodeExpired = !vendor.isPublished || daysLeft <= 0;
        const handleCopy = () => {
          navigator.clipboard.writeText(shopUrl).then(() => {
            setCopied(true);
            toast({ title: t.shopLinkCopied });
            setTimeout(() => setCopied(false), 2000);
          });
        };
        return (
          <div className={`rounded-xl border p-3 mb-4 ${isCodeExpired ? "border-destructive/30 bg-destructive/5" : "bg-card"}`}>
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <Link2 className={`w-3.5 h-3.5 flex-shrink-0 ${isCodeExpired ? "text-destructive" : "text-primary"}`} />
                <span className={`text-xs font-semibold ${isCodeExpired ? "text-destructive" : "text-primary"}`}>{t.shopLinkLabel}</span>
              </div>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                isCodeExpired
                  ? "bg-destructive/15 text-destructive"
                  : daysLeft <= 3
                    ? "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400"
                    : "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
              }`}>
                {isCodeExpired
                  ? t.shopLinkExpiredBadge
                  : daysLeft === 0
                    ? t.shopLinkExpiresToday
                    : t.shopLinkExpiresIn(daysLeft)}
              </span>
            </div>
            {!isCodeExpired && (
              <>
                <p className="text-xs text-muted-foreground break-all font-mono bg-muted rounded px-2 py-1.5 mb-2">
                  {shopUrl}
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={handleCopy}
                    className="flex-shrink-0 w-8 h-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 transition-colors"
                  >
                    {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  </button>
                  <a
                    href={`https://wa.me/?text=${encodeURIComponent(`Visitez ma boutique TogoMarket N°${vendor.id} : ${shopUrl}`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-shrink-0 w-8 h-8 rounded-lg bg-[#25D366] flex items-center justify-center hover:bg-[#1eb355] transition-colors"
                    title={t.shareViaWhatsApp}
                  >
                    <svg viewBox="0 0 24 24" className="w-4 h-4 fill-white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.123.554 4.114 1.526 5.843L.057 23.617a.5.5 0 0 0 .611.64l5.975-1.566A11.945 11.945 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.885 0-3.645-.52-5.148-1.426l-.369-.221-3.821 1.001.982-3.713-.24-.381A9.944 9.944 0 0 1 2 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/></svg>
                  </a>
                  <a
                    href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shopUrl)}&quote=${encodeURIComponent(`Visitez ma boutique TogoMarket N°${vendor.id} : ${shopUrl}`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-shrink-0 w-8 h-8 rounded-lg bg-[#1877F2] flex items-center justify-center hover:bg-[#0f65d8] transition-colors"
                    title={t.shareViaFacebook}
                  >
                    <svg viewBox="0 0 24 24" className="w-4 h-4 fill-white"><path d="M24 12.073C24 5.404 18.627 0 12 0S0 5.404 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.41c0-3.025 1.792-4.697 4.533-4.697 1.312 0 2.686.236 2.686.236v2.97h-1.513c-1.491 0-1.956.93-1.956 1.886v2.267h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"/></svg>
                  </a>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1.5">{t.shopLinkDesc}</p>
              </>
            )}
            {isCodeExpired && (
              <p className="text-[11px] text-muted-foreground mt-0.5">{t.shopNoCode}</p>
            )}
          </div>
        );
      })() : (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 mb-4">
          <div className="flex items-center gap-2 mb-1">
            <Link2 className="w-3.5 h-3.5 text-destructive flex-shrink-0" />
            <span className="text-xs font-semibold text-destructive">{t.shopLinkLabel}</span>
          </div>
          <p className="text-[11px] text-muted-foreground">{t.shopNoCode}</p>
        </div>
      )}

      {/* Notification demandes de contact */}
      {contactStats.some((s) => s.count > 0) && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 mb-4 flex items-start gap-3">
          <Bell className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-primary">
              {t.contactRequestsReceived(contactStats.reduce((acc, s) => acc + s.count, 0))}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">{t.buyersContactedDesc}</p>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="rounded-xl border bg-card p-4 text-center">
          <div className="flex items-center justify-center gap-1.5 mb-1">
            <Package className="w-4 h-4 text-primary" />
            <span className="text-2xl font-bold text-primary">{published.length}</span>
          </div>
          <p className="text-xs text-muted-foreground">{t.published}</p>
        </div>
        <div className="rounded-xl border bg-card p-4 text-center">
          <div className="flex items-center justify-center gap-1.5 mb-1">
            <Clock className="w-4 h-4 text-amber-500" />
            <span className="text-2xl font-bold text-amber-500">{pending.length}</span>
          </div>
          <p className="text-xs text-muted-foreground">{t.pending}</p>
        </div>
      </div>

      {/* Listings */}
      <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wider mb-3">
        {t.myListings}
      </h3>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((n) => (
            <div key={n} className="rounded-xl border bg-card h-24 animate-pulse" />
          ))}
        </div>
      ) : managedListings.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground">
          <Package className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">{t.noListingsYet}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {managedListings.map((listing) => (
            <div key={listing.id} className="rounded-xl border bg-card p-3 flex gap-3">
              {listing.images?.[0] ? (
                <BoutiqueMediaThumb path={listing.images[0]} alt={listing.name} />
              ) : (
                <div className="w-16 h-16 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                  <Package className="w-6 h-6 text-muted-foreground" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold text-sm break-words">{listing.name}</p>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {(() => {
                      const stat = contactStats.find((s) => s.listingId === listing.id);
                      return stat && stat.count > 0 ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold bg-primary text-primary-foreground flex items-center gap-0.5">
                          <Bell className="w-2.5 h-2.5" />
                          {stat.count}
                        </span>
                      ) : null;
                    })()}
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                      listing.approved
                        ? "bg-green-100 text-green-700"
                        : "bg-amber-100 text-amber-700"
                    }`}>
                      {listing.approved ? t.published : t.pending}
                    </span>
                  </div>
                </div>
                {listing.promoPrice != null ? (
                  <p className="text-sm mt-0.5 flex items-baseline gap-1.5 flex-wrap">
                    <span className="text-red-600 font-bold">{listing.promoPrice.toLocaleString("fr-FR")} FCFA</span>
                    <span className="text-muted-foreground line-through text-xs">{listing.price.toLocaleString("fr-FR")} FCFA</span>
                    <span className="text-[9px] bg-red-100 text-red-700 rounded-full px-1.5 py-0.5 font-bold">PROMO</span>
                  </p>
                ) : (
                  <p className="text-primary font-bold text-sm mt-0.5">
                    {listing.price.toLocaleString("fr-FR")} FCFA
                  </p>
                )}
                <p className="text-xs text-muted-foreground break-words">{listing.location} · {listing.sector}</p>
                <div className="flex gap-2 mt-2">
                  {listing.sector === "Tourisme" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs gap-1"
                      onClick={() => setTourismeEditTarget(listing)}
                    >
                      <Pencil className="w-3 h-3" />
                      Modifier le catalogue
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs gap-1"
                      onClick={() => {
                        setPriceTarget(listing);
                        setNewPrice(String(listing.price));
                        setNewPromoPrice(listing.promoPrice != null ? String(listing.promoPrice) : "");
                        setNewDescription(listing.description ?? "");
                      }}
                    >
                      <Pencil className="w-3 h-3" />
                      {t.editPrice}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1 text-destructive border-destructive/30 hover:bg-destructive/10"
                    onClick={() => setDeleteTarget(listing)}
                  >
                    <Trash2 className="w-3 h-3" />
                    {listing.sector === "Tourisme" ? "Supprimer le catalogue" : t.delete}
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        title={deleteTarget?.sector === "Tourisme" ? "Supprimer le catalogue ?" : t.deleteListingTitle}
        description={deleteTarget?.sector === "Tourisme"
          ? `Êtes-vous sûr de vouloir supprimer le catalogue « ${deleteTarget.name} » ? Toutes ses photos et vidéos seront supprimées.`
          : t.deleteListingDesc(deleteTarget?.name ?? "")}
        confirmLabel={t.delete}
        cancelLabel={t.cancel}
        destructive
        loading={deleteListing.isPending}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />

      <PublishModal
        open={!!tourismeEditTarget}
        onOpenChange={(open) => {
          if (!open) setTourismeEditTarget(null);
        }}
        vendor={vendor}
        vendorPassword={vendorPassword}
        onNeedLogin={onNeedLogin}
        onVendorRefresh={() => {}}
        editListing={tourismeEditTarget}
        onEditSuccess={() => {
          setTourismeEditTarget(null);
          refetch();
        }}
      />

      {/* Price edit confirmation */}
      <Dialog open={!!priceTarget} onOpenChange={(v) => !v && setPriceTarget(null)}>
        <DialogContent className="sm:max-w-[360px]">
          <DialogHeader>
            <DialogTitle>{t.editPriceTitle}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {t.listingLabel} : <strong>{priceTarget?.name}</strong>
            </p>
            <div>
              <label className="text-sm font-medium mb-1 block">{t.newPriceLabel}</label>
              <Input
                type="number"
                min="0"
                value={newPrice}
                onChange={(e) => setNewPrice(e.target.value)}
                placeholder="Ex : 15000"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">
                Prix promotionnel <span className="text-muted-foreground font-normal">(facultatif)</span>
              </label>
              <Input
                type="number"
                min="0"
                value={newPromoPrice}
                onChange={(e) => setNewPromoPrice(e.target.value)}
                placeholder="Ex : 12000 — laisser vide pour retirer la promo"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                S'affichera en promo à côté du prix réel barré sur le marketplace.
              </p>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">
                Description de l'article <span className="text-muted-foreground font-normal">(facultatif)</span>
              </label>
              <textarea
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                rows={3}
                maxLength={1000}
                placeholder="Décrivez votre article : état, caractéristiques, détails…"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setPriceTarget(null)}>{t.cancel}</Button>
            <Button onClick={handlePriceConfirm} disabled={updatePrice.isPending}>
              {updatePrice.isPending ? t.saving : t.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
