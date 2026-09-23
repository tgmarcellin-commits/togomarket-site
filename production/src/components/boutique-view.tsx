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
import { UserCircle2, Package, Clock, Trash2, Pencil, LogIn, Store, Bell, Copy, Check, Link2 } from "lucide-react";
import { resolveImageUrl } from "@/lib/image";
import { encodeShopToken } from "@/lib/shop-token";
import { useSiteSettings } from "@/lib/site-settings";
import { useT } from "@/lib/i18n";

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

export function BoutiqueView({ vendor, vendorPassword, onNeedLogin }: BoutiqueViewProps) {
  const { lang } = useSiteSettings();
  const t = useT(lang);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [listings, setListings] = useState<Listing[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Listing | null>(null);
  const [priceTarget, setPriceTarget] = useState<Listing | null>(null);
  const [newPrice, setNewPrice] = useState("");
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

  const published = (listings ?? []).filter((l) => l.approved);
  const pending = (listings ?? []).filter((l) => !l.approved);

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

  const handlePriceConfirm = () => {
    if (!priceTarget || !newPrice) return;
    const parsed = parseFloat(newPrice.replace(",", "."));
    if (isNaN(parsed) || parsed <= 0) {
      toast({ title: t.invalidPrice, variant: "destructive" });
      return;
    }
    updatePrice.mutate(
      { data: { id: priceTarget.id, phone: vendor.phone, password: vendorPassword, newPrice: parsed } },
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
      {/* Profile header */}
      <div className="flex items-center gap-4 mb-6">
        <div className="w-14 h-14 rounded-full border-2 border-primary/30 overflow-hidden flex-shrink-0 bg-muted flex items-center justify-center">
          {vendor.profilePhoto ? (
            <img src={vendor.profilePhoto} alt={vendor.firstName} className="w-full h-full object-cover" />
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
        </div>
      </div>

      {/* Lien partageable de la boutique */}
      {vendor.publishCode ? (() => {
        const shopUrl = `${window.location.origin}/?shop=${encodeShopToken(vendor.id, vendor.publishCode.code)}`;
        const daysLeft = vendor.publishCode.daysLeft;
        const isExpired = daysLeft <= 0;
        const handleCopy = () => {
          navigator.clipboard.writeText(shopUrl).then(() => {
            setCopied(true);
            toast({ title: t.shopLinkCopied });
            setTimeout(() => setCopied(false), 2000);
          });
        };
        return (
          <div className={`rounded-xl border p-3 mb-4 ${isExpired ? "border-destructive/30 bg-destructive/5" : "bg-card"}`}>
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <Link2 className={`w-3.5 h-3.5 flex-shrink-0 ${isExpired ? "text-destructive" : "text-primary"}`} />
                <span className={`text-xs font-semibold ${isExpired ? "text-destructive" : "text-primary"}`}>{t.shopLinkLabel}</span>
              </div>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                isExpired
                  ? "bg-destructive/15 text-destructive"
                  : daysLeft <= 3
                    ? "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400"
                    : "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
              }`}>
                {isExpired
                  ? t.shopLinkExpiredBadge
                  : daysLeft === 0
                    ? t.shopLinkExpiresToday
                    : t.shopLinkExpiresIn(daysLeft)}
              </span>
            </div>
            {!isExpired && (
              <>
                <div className="flex items-center gap-2">
                  <p className="text-xs text-muted-foreground truncate flex-1 font-mono bg-muted rounded px-2 py-1.5">
                    {shopUrl}
                  </p>
                  <button
                    onClick={handleCopy}
                    className="flex-shrink-0 w-8 h-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 transition-colors"
                  >
                    {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1.5">{t.shopLinkDesc}</p>
              </>
            )}
            {isExpired && (
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
      ) : (listings ?? []).length === 0 ? (
        <div className="text-center py-10 text-muted-foreground">
          <Package className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">{t.noListingsYet}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {(listings ?? []).map((listing) => (
            <div key={listing.id} className="rounded-xl border bg-card p-3 flex gap-3">
              {listing.images?.[0] ? (
                <img
                  src={resolveImageUrl(listing.images[0])}
                  alt={listing.name}
                  className="w-16 h-16 rounded-lg object-contain bg-black flex-shrink-0"
                />
              ) : (
                <div className="w-16 h-16 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                  <Package className="w-6 h-6 text-muted-foreground" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold text-sm truncate">{listing.name}</p>
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
                <p className="text-primary font-bold text-sm mt-0.5">
                  {listing.price.toLocaleString("fr-FR")} FCFA
                </p>
                <p className="text-xs text-muted-foreground truncate">{listing.location} · {listing.sector}</p>
                <div className="flex gap-2 mt-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1"
                    onClick={() => { setPriceTarget(listing); setNewPrice(String(listing.price)); }}
                  >
                    <Pencil className="w-3 h-3" />
                    {t.editPrice}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1 text-destructive border-destructive/30 hover:bg-destructive/10"
                    onClick={() => setDeleteTarget(listing)}
                  >
                    <Trash2 className="w-3 h-3" />
                    {t.delete}
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
        title={t.deleteListingTitle}
        description={t.deleteListingDesc(deleteTarget?.name ?? "")}
        confirmLabel={t.delete}
        cancelLabel={t.cancel}
        destructive
        loading={deleteListing.isPending}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
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
