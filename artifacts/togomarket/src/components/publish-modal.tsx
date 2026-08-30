import { useState, useEffect } from "react";
import { openWhatsApp } from "@/lib/whatsapp";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  useCreateListing,
  useUpdateTourismeListing,
  getGetListingsQueryKey,
  type Listing,
  type VendorProfile,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { resizeImageToBlob, resolveImageUrl, isVideoMedia, resolveMediaUrl } from "@/lib/image";
import { uploadImageFile, uploadVideoFile } from "@/lib/upload";
import { UploadCloud, X, Lock, AlertCircle, UserCircle2, Store, CreditCard, Loader2, Copy, Users, Video } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useSiteSettings } from "@/lib/site-settings";
import { useT } from "@/lib/i18n";

const PHONE_REGEX = /\d[\s\-\.]?\d[\s\-\.]?\d[\s\-\.]?\d[\s\-\.]?\d[\s\-\.]?\d[\s\-\.]?\d[\s\-\.]?\d/;

interface PublishModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vendor: VendorProfile | null;
  vendorPassword: string;
  onNeedLogin: () => void;
  onVendorRefresh: (updated: VendorProfile) => void;
  editListing?: Listing | null;
  onEditSuccess?: () => void;
}

export function PublishModal({
  open,
  onOpenChange,
  vendor,
  vendorPassword,
  onNeedLogin,
  editListing,
  onEditSuccess,
}: PublishModalProps) {
  const { lang } = useSiteSettings();
  const t = useT(lang);

  const formSchema = z.object({
    name: z
      .string()
      .min(3, t.titleTooShort)
      .refine((val) => !PHONE_REGEX.test(val), { message: t.titlePhoneError }),
    price: z.coerce.number().min(1, t.invalidPrice),
    location: z
      .string()
      .min(2, t.locationRequired)
      .refine((val) => !PHONE_REGEX.test(val), { message: t.locationPhoneError }),
    country: z.string().min(2, t.countryRequired),
    sector: z.enum(["Tourisme", "AgriMarket", "Immobilier", "Automobile", "Repas", "Divers"]),
    description: z.string().max(1000, "Description trop longue (1000 caractères max)").optional(),
  });
  type FormValues = z.infer<typeof formSchema>;

  const [screen, setScreen] = useState<"gate" | "form">("gate");
  const [images, setImages] = useState<{ dataUrl: string; objectPath: string }[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [fedapayLoading, setFedapayLoading] = useState(false);
  const [catalogDesc, setCatalogDesc] = useState("");
  const [tourismeMedia, setTourismeMedia] = useState<{ dataUrl: string; objectPath: string; isVideo: boolean }[]>([]);
  const [uploadingTourisme, setUploadingTourisme] = useState(false);
  const [sectorValue, setSectorValue] = useState<string>("Divers");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createListing = useCreateListing();
  const updateTourismeListing = useUpdateTourismeListing();
  const isEditMode = Boolean(editListing);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      price: 0,
      location: "",
      country: "Togo",
      sector: "Divers" as const,
      description: "",
    },
  });

  useEffect(() => {
    if (!open) return;
    if (editListing) {
      setScreen("form");
      setSectorValue("Tourisme");
      form.reset({
        name: editListing.name,
        price: 0,
        location: editListing.location,
        country: editListing.country || "Togo",
        sector: "Tourisme",
        description: "",
      });
      setCatalogDesc(editListing.location === "Catalogue Tourisme" ? "" : editListing.location);
      setTourismeMedia((editListing.images ?? []).map((path) => ({
        dataUrl: resolveMediaUrl(path),
        objectPath: path.startsWith("v:") ? path.slice(2) : path,
        isVideo: isVideoMedia(path),
      })));
    } else {
      setScreen("gate");
      setSectorValue(form.getValues("sector") ?? "Divers");
    }
  }, [open, editListing, form]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const files = Array.from(e.target.files);
    if (images.length + files.length > 4) {
      toast({ title: t.maxImages, variant: "destructive" });
      return;
    }
    setIsProcessing(true);
    try {
      const entries = await Promise.all(
        files.map(async (file) => {
          const { blob, dataUrl } = await resizeImageToBlob(file);
          const objectPath = await uploadImageFile(blob, file.name, {
            vendorPhone: vendor?.phone ?? "",
            vendorPassword,
          });
          return { dataUrl, objectPath };
        })
      );
      setImages((prev) => [...prev, ...entries].slice(0, 4));
    } catch {
      toast({ title: t.imageProcessingError, variant: "destructive" });
    } finally {
      setIsProcessing(false);
    }
  };

  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

  const onSubmit = (data: FormValues) => {
    if (!vendor) return;
    createListing.mutate(
      {
        data: {
          name: data.name,
          price: data.price,
          location: data.location,
          country: data.country,
          sector: data.sector,
          images: images.map((img) => img.objectPath),
          vendorPhone: vendor.phone,
          vendorPassword,
          ...(data.description?.trim() ? { description: data.description.trim() } : {}),
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetListingsQueryKey() });
          toast({ title: t.listingSubmitted, description: t.listingPendingDesc });
          const message = lang === "fr"
            ? `Nouvelle annonce soumise sur TogoMarket (en attente de validation)\n\nTitre: ${data.name}\nPrix: ${data.price} FCFA\nSecteur: ${data.sector}\nVendeur: ${vendor.firstName} ${vendor.lastName}\nTéléphone: ${vendor.phone}`
            : `New listing submitted on TogoMarket (pending validation)\n\nTitle: ${data.name}\nPrice: ${data.price} FCFA\nSector: ${data.sector}\nSeller: ${vendor.firstName} ${vendor.lastName}\nPhone: ${vendor.phone}`;
          openWhatsApp(`https://wa.me/22870703131?text=${encodeURIComponent(message)}`);
          form.reset();
          setImages([]);
          setScreen("gate");
          onOpenChange(false);
        },
        onError: (err: unknown) => {
          const msg = (err as { message?: string })?.message ?? "";
          toast({ title: t.publishError, description: msg || undefined, variant: "destructive" });
        },
      }
    );
  };

  const isTourisme = sectorValue === "Tourisme";

  const handleTourismeFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const files = Array.from(e.target.files);
    e.target.value = "";
    if (tourismeMedia.length + files.length > 10) {
      toast({ title: lang === "fr" ? "Maximum 10 médias autorisés" : "Maximum 10 media files allowed", variant: "destructive" });
      return;
    }
    setUploadingTourisme(true);
    try {
      const entries = await Promise.all(
        files.map(async (file) => {
          const isVideoFile = file.type.startsWith("video/");
          if (isVideoFile) {
            const objectPath = await uploadVideoFile(file, {
              vendorPhone: vendor?.phone ?? "",
              vendorPassword,
               ...(editListing ? { tourismeListingId: editListing.id } : {}),
            });
            return { dataUrl: URL.createObjectURL(file), objectPath, isVideo: true };
          } else {
            const { blob, dataUrl } = await resizeImageToBlob(file);
            const objectPath = await uploadImageFile(blob, file.name, {
              vendorPhone: vendor?.phone ?? "",
              vendorPassword,
               ...(editListing ? { tourismeListingId: editListing.id } : {}),
            });
            return { dataUrl, objectPath, isVideo: false };
          }
        })
      );
      setTourismeMedia((prev) => [...prev, ...entries].slice(0, 10));
    } catch {
      toast({ title: t.imageProcessingError, variant: "destructive" });
    } finally {
      setUploadingTourisme(false);
    }
  };

  const removeTourismeMedia = (index: number) => {
    setTourismeMedia((prev) => prev.filter((_, i) => i !== index));
  };

  const onSubmitTourisme = () => {
    if (!vendor) return;
    const name = form.getValues("name");
    if (!name || name.trim().length < 3) {
      form.setError("name", { message: t.titleTooShort });
      return;
    }
    const media = tourismeMedia.map((m) => m.isVideo ? `v:${m.objectPath}` : m.objectPath);

    if (editListing) {
      updateTourismeListing.mutate(
        {
          listingId: editListing.id,
          data: {
            name: name.trim(),
            description: catalogDesc.trim(),
            images: media,
            phone: vendor.phone,
            password: vendorPassword,
          },
        },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getGetListingsQueryKey() });
            toast({
              title: lang === "fr" ? "Catalogue modifié !" : "Catalog updated!",
              description: lang === "fr" ? "Les modifications ont été enregistrées." : "Your changes have been saved.",
            });
            form.reset();
            setCatalogDesc("");
            setTourismeMedia([]);
            setScreen("gate");
            onEditSuccess?.();
            onOpenChange(false);
          },
          onError: (err: unknown) => {
            const msg = (err as { message?: string })?.message ?? "";
            toast({ title: t.updateError, description: msg || undefined, variant: "destructive" });
          },
        },
      );
      return;
    }

    createListing.mutate(
      {
        data: {
          name: name.trim(),
          price: 0,
          location: catalogDesc.trim() || "Catalogue Tourisme",
          country: "Togo",
          sector: "Tourisme" as const,
          images: media,
          vendorPhone: vendor.phone,
          vendorPassword,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetListingsQueryKey() });
          toast({
            title: lang === "fr" ? "Catalogue soumis !" : "Catalog submitted!",
            description: lang === "fr" ? "Votre catalogue Tourisme est en attente de validation." : "Your Tourisme catalog is pending approval.",
          });
          const message = lang === "fr"
            ? `Nouveau catalogue Tourisme soumis\n\nNom : ${name.trim()}\nVendeur : ${vendor.firstName} ${vendor.lastName}\nTéléphone : ${vendor.phone}`
            : `New Tourisme catalog submitted\n\nName: ${name.trim()}\nSeller: ${vendor.firstName} ${vendor.lastName}\nPhone: ${vendor.phone}`;
          openWhatsApp(`https://wa.me/22870703131?text=${encodeURIComponent(message)}`);
          form.reset();
          setCatalogDesc("");
          setTourismeMedia([]);
          setScreen("gate");
          onOpenChange(false);
        },
        onError: (err: unknown) => {
          const msg = (err as { message?: string })?.message ?? "";
          toast({ title: t.publishError, description: msg || undefined, variant: "destructive" });
        },
      }
    );
  };

  const handleOpenChange = (val: boolean) => {
    if (!val) {
      setScreen("gate");
      form.reset();
      setImages([]);
      setCatalogDesc("");
      setTourismeMedia([]);
    }
    onOpenChange(val);
  };

  const handleFedapayPayment = async () => {
    if (!vendor) return;
    setFedapayLoading(true);
    try {
      const r = await fetch("/api/fedapay/create-transaction", {
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
      const data = await r.json() as { widgetUrl?: string; error?: string };
      if (!r.ok || !data.widgetUrl) {
        toast({ title: lang === "fr" ? "Erreur paiement" : "Payment error", description: data.error ?? "Erreur", variant: "destructive" });
        return;
      }
      window.open(data.widgetUrl, "_blank");
    } catch {
      toast({ title: lang === "fr" ? "Erreur réseau" : "Network error", variant: "destructive" });
    } finally {
      setFedapayLoading(false);
    }
  };

  const Gate = () => {
    if (!vendor) {
      return (
        <div className="py-6 text-center space-y-4">
          <div className="w-14 h-14 bg-muted rounded-full flex items-center justify-center mx-auto">
            <UserCircle2 className="w-8 h-8 text-muted-foreground" />
          </div>
          <div>
            <p className="font-semibold text-base mb-1">{t.loginRequired}</p>
            <p className="text-sm text-muted-foreground">{t.loginRequiredDesc}</p>
          </div>
          <Button className="w-full" onClick={() => { onOpenChange(false); onNeedLogin(); }}>
            {t.loginOrCreate}
          </Button>
        </div>
      );
    }

    if (!vendor.verified) {
      return (
        <div className="py-6 text-center space-y-4">
          <div className="w-14 h-14 bg-amber-100 rounded-full flex items-center justify-center mx-auto">
            <AlertCircle className="w-8 h-8 text-amber-500" />
          </div>
          <div>
            <p className="font-semibold text-base mb-1">{t.accountPending}</p>
            <p className="text-sm text-muted-foreground">{t.accountPendingDesc}</p>
          </div>
          <Button
            className="w-full bg-green-500 hover:bg-green-600 text-white"
            onClick={() => openWhatsApp(`https://wa.me/22870703131?text=${encodeURIComponent(lang === "fr" ? "Bonjour, je veux activer mon compte vendeur TogoMarket." : "Hello, I want to activate my TogoMarket seller account.")}`)}
          >
            {t.contactAdmin}
          </Button>
        </div>
      );
    }

    if (!vendor.isPublished) {
      return (
        <div className="py-6 text-center space-y-4">
          <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center mx-auto">
            <Store className="w-8 h-8 text-red-400" />
          </div>
          <div>
            <p className="font-semibold text-base mb-1">
              {lang === "fr" ? "Boutique désactivée" : "Shop deactivated"}
            </p>
            <p className="text-sm text-muted-foreground">
              {lang === "fr"
                ? "Votre boutique est expirée ou désactivée. Renouvelez pour 1 000 FCFA/mois via FedaPay ou contactez l'administrateur."
                : "Your shop is expired or deactivated. Renew for 1,000 FCFA/month via FedaPay or contact admin."}
            </p>
          </div>
          <Button
            className="w-full bg-blue-600 hover:bg-blue-700 text-white"
            onClick={handleFedapayPayment}
            disabled={fedapayLoading}
          >
            {fedapayLoading ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <CreditCard className="w-4 h-4 mr-2" />
            )}
            {lang === "fr" ? "Payer par FedaPay (1 000 FCFA)" : "Pay via FedaPay (1,000 FCFA)"}
          </Button>
          <Button
            variant="outline"
            className="w-full border-green-500 text-green-600 hover:bg-green-50"
            onClick={() => openWhatsApp(`https://wa.me/22870703131?text=${encodeURIComponent(lang === "fr" ? `Bonjour TogoMarket, je souhaite réactiver ma boutique.\nNom : ${vendor.firstName} ${vendor.lastName}\nTéléphone : ${vendor.phone}` : `Hello TogoMarket, I want to reactivate my shop.\nName: ${vendor.firstName} ${vendor.lastName}\nPhone: ${vendor.phone}`)}`)}
          >
            {lang === "fr" ? "Contacter via WhatsApp" : "Contact via WhatsApp"}
          </Button>
        </div>
      );
    }

    const referralLink = `${window.location.origin}/?ref=${vendor.id}`;
    const handleCopyReferralLink = () => {
      navigator.clipboard.writeText(referralLink).then(
        () => toast({ title: lang === "fr" ? "Lien copié !" : "Link copied!" }),
        () => toast({ title: lang === "fr" ? "Impossible de copier le lien" : "Could not copy link", variant: "destructive" })
      );
    };

    const showRenewalReminder = vendor.daysUntilExpiry !== null && vendor.daysUntilExpiry !== undefined && vendor.daysUntilExpiry <= 3;

    return (
      <div className="py-4 space-y-4">
        <div className="flex items-center gap-3 bg-muted/50 rounded-lg p-3">
          {vendor.profilePhoto ? (
            <img src={resolveImageUrl(vendor.profilePhoto)} alt={vendor.firstName} className="w-10 h-10 rounded-full object-cover flex-shrink-0" />
          ) : (
            <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center flex-shrink-0">
              <span className="text-primary font-bold text-sm">{vendor.firstName[0]}{vendor.lastName[0]}</span>
            </div>
          )}
          <div className="min-w-0">
            <p className="font-semibold text-sm truncate">{vendor.firstName} {vendor.lastName}</p>
            <p className="text-xs text-muted-foreground">
              {lang === "fr" ? "Boutique active" : "Active shop"}
            </p>
          </div>
        </div>

        {showRenewalReminder && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
            <p className="text-xs text-amber-800">
              {lang === "fr"
                ? `Votre abonnement expire dans ${vendor.daysUntilExpiry} jour${(vendor.daysUntilExpiry ?? 0) > 1 ? "s" : ""}. Renouvelez dès maintenant pour éviter toute interruption.`
                : `Your subscription expires in ${vendor.daysUntilExpiry} day${(vendor.daysUntilExpiry ?? 0) > 1 ? "s" : ""}. Renew now to avoid interruption.`}
            </p>
            <Button
              size="sm"
              className="w-full bg-blue-600 hover:bg-blue-700 text-white"
              onClick={handleFedapayPayment}
              disabled={fedapayLoading}
            >
              {fedapayLoading ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <CreditCard className="w-4 h-4 mr-2" />
              )}
              {lang === "fr" ? "Renouveler maintenant (1 000 FCFA)" : "Renew now (1,000 FCFA)"}
            </Button>
          </div>
        )}

        <div className="rounded-lg border p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-primary" />
            <p className="text-sm font-semibold">
              {lang === "fr" ? "Mon lien de parrainage" : "My referral link"}
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            {lang === "fr"
              ? "Partagez ce lien : chaque nouveau vendeur inscrit via ce lien vous fait gagner 3 jours d'abonnement."
              : "Share this link: every new seller who signs up through it earns you 3 days of subscription."}
          </p>
          <div className="flex items-center gap-2">
            <Input readOnly value={referralLink} className="text-xs" onFocus={(e) => e.target.select()} />
            <Button type="button" size="icon" variant="outline" onClick={handleCopyReferralLink} className="flex-shrink-0">
              <Copy className="w-4 h-4" />
            </Button>
          </div>
          <div className="flex items-center justify-between bg-muted/50 rounded-md px-3 py-2">
            <span className="text-xs text-muted-foreground">
              {lang === "fr" ? "Jours gagnés par parrainage" : "Days earned via referrals"}
            </span>
            <span className="text-sm font-bold text-primary">{vendor.referralDaysEarned ?? 0} {lang === "fr" ? "jours" : "days"}</span>
          </div>
        </div>

        {/* Publier une annonce : masqué si la boutique est expirée (isPublished=true mais expiryDate dépassée) */}
        {vendor.expiryDate && new Date(vendor.expiryDate) <= new Date() ? (
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-center space-y-3">
            <AlertCircle className="w-7 h-7 text-destructive/60 mx-auto" />
            <p className="text-sm font-semibold text-foreground">
              {lang === "fr" ? "Boutique expirée" : "Shop expired"}
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {lang === "fr"
                ? "Votre abonnement a expiré. Renouvelez pour publier de nouvelles annonces."
                : "Your subscription has expired. Renew to publish new listings."}
            </p>
            <Button
              className="w-full bg-blue-600 hover:bg-blue-700 text-white"
              onClick={handleFedapayPayment}
              disabled={fedapayLoading}
            >
              {fedapayLoading ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <CreditCard className="w-4 h-4 mr-2" />
              )}
              {lang === "fr" ? "Renouveler (1 000 FCFA)" : "Renew (1,000 FCFA)"}
            </Button>
          </div>
        ) : (
          <Button className="w-full" onClick={() => setScreen("form")}>
            <Lock className="w-4 h-4 mr-2" />
            {t.publishListing}
          </Button>
        )}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {screen === "form" ? (
              t.sellItem
            ) : (
              <><Lock className="w-5 h-5" /> {t.publishListing}</>
            )}
          </DialogTitle>
        </DialogHeader>

        {screen === "gate" && <Gate />}

        {screen === "form" && (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2.5">
                <Lock className="w-3 h-3 flex-shrink-0 mt-0.5" />
                <span>{t.listingNote}</span>
              </div>

              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{isTourisme ? (lang === "fr" ? "Nom du catalogue" : "Catalog name") : t.articleTitle}</FormLabel>
                    <FormControl>
                      <Input placeholder={isTourisme ? (lang === "fr" ? "Ex : Visite des cascades de Kpalimé" : "Ex: Kpalimé waterfalls tour") : "Ex: iPhone 12 Pro Max"} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {isTourisme ? (
                <FormField
                  control={form.control}
                  name="sector"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t.sectorLabel}</FormLabel>
                       <Select
                         onValueChange={(val) => {
                           if (isEditMode) return;
                           field.onChange(val);
                           setSectorValue(val);
                         }}
                        value={field.value}
                         disabled={isEditMode}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder={t.chooseSector} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="Tourisme">Tourisme 🌴</SelectItem>
                          <SelectItem value="AgriMarket">AgriMarket 🌿</SelectItem>
                          <SelectItem value="Immobilier">Immobilier 🏢</SelectItem>
                          <SelectItem value="Automobile">Automobile 🚗</SelectItem>
                          <SelectItem value="Repas">Repas 🍽️</SelectItem>
                          <SelectItem value="Divers">Divers 📦</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="price"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t.priceLabel}</FormLabel>
                        <FormControl>
                          <Input type="number" placeholder="150000" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="sector"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t.sectorLabel}</FormLabel>
                        <Select
                          onValueChange={(val) => { field.onChange(val); setSectorValue(val); }}
                          value={field.value}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder={t.chooseSector} />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="Tourisme">Tourisme 🌴</SelectItem>
                            <SelectItem value="AgriMarket">AgriMarket 🌿</SelectItem>
                            <SelectItem value="Immobilier">Immobilier 🏢</SelectItem>
                            <SelectItem value="Automobile">Automobile 🚗</SelectItem>
                            <SelectItem value="Repas">Repas 🍽️</SelectItem>
                            <SelectItem value="Divers">Divers 📦</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              )}

              {isTourisme ? (
                <div>
                  <label className="text-sm font-medium leading-none">
                    {lang === "fr" ? "Description (facultatif)" : "Description (optional)"}
                  </label>
                  <textarea
                    value={catalogDesc}
                    onChange={(e) => setCatalogDesc(e.target.value)}
                    placeholder={lang === "fr" ? "Décrivez votre catalogue Tourisme…" : "Describe your Tourisme catalog…"}
                    rows={3}
                    className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none"
                  />
                </div>
              ) : (
                <>
                  <FormField
                    control={form.control}
                    name="location"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t.locationLabel}</FormLabel>
                        <FormControl>
                          <Input placeholder="Lomé, Agoè" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="country"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t.countryLabel}</FormLabel>
                        <FormControl>
                          <Input placeholder="Togo" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{lang === "fr" ? "Description de l'article (facultatif)" : "Item description (optional)"}</FormLabel>
                        <FormControl>
                          <textarea
                            {...field}
                            placeholder={lang === "fr" ? "Décrivez votre article : état, caractéristiques, détails…" : "Describe your item: condition, features, details…"}
                            rows={3}
                            maxLength={1000}
                            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </>
              )}

              {isTourisme ? (
                <div>
                  <label className="text-sm font-medium leading-none">
                    {lang === "fr" ? "Photos & vidéos (max 10)" : "Photos & videos (max 10)"}
                  </label>
                  <div className="mt-2 flex flex-wrap gap-3">
                    {tourismeMedia.map((m, idx) => (
                      <div key={idx} className="relative w-20 h-20 rounded-md overflow-hidden border border-border bg-muted">
                        {m.isVideo ? (
                          <div className="w-full h-full flex items-center justify-center">
                            <Video className="w-7 h-7 text-muted-foreground" />
                          </div>
                        ) : (
                          <img src={m.dataUrl} alt={`Preview ${idx}`} className="w-full h-full object-cover" />
                        )}
                        <button
                          type="button"
                          onClick={() => removeTourismeMedia(idx)}
                          className="absolute top-1 right-1 bg-black/50 text-white rounded-full p-0.5 hover:bg-black/70"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                    {tourismeMedia.length < 10 && (
                      <label className="w-20 h-20 flex flex-col items-center justify-center border-2 border-dashed border-muted-foreground/30 rounded-md cursor-pointer hover:bg-muted/50 transition-colors">
                        {uploadingTourisme ? (
                          <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
                        ) : (
                          <>
                            <UploadCloud className="w-5 h-5 text-muted-foreground mb-1" />
                            <span className="text-[10px] text-muted-foreground font-medium">{t.add}</span>
                          </>
                        )}
                        <input
                          type="file"
                          accept="image/*,video/*,.mp4,.mov,.webm"
                          multiple
                          className="hidden"
                          onChange={handleTourismeFileChange}
                          disabled={uploadingTourisme}
                        />
                      </label>
                    )}
                  </div>
                </div>
              ) : (
                <div>
                  <label className="text-sm font-medium leading-none">{t.imagesLabel}</label>
                  <div className="mt-2 flex flex-wrap gap-3">
                    {images.map((img, idx) => (
                      <div key={idx} className="relative w-20 h-20 rounded-md overflow-hidden border border-border">
                        <img src={img.dataUrl} alt={`Preview ${idx}`} className="w-full h-full object-cover" />
                        <button
                          type="button"
                          onClick={() => removeImage(idx)}
                          className="absolute top-1 right-1 bg-black/50 text-white rounded-full p-0.5 hover:bg-black/70"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                    {images.length < 4 && (
                      <label className="w-20 h-20 flex flex-col items-center justify-center border-2 border-dashed border-muted-foreground/30 rounded-md cursor-pointer hover:bg-muted/50 transition-colors">
                        <UploadCloud className="w-5 h-5 text-muted-foreground mb-1" />
                        <span className="text-[10px] text-muted-foreground font-medium">{t.add}</span>
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          className="hidden"
                          onChange={handleFileChange}
                          disabled={isProcessing}
                        />
                      </label>
                    )}
                  </div>
                </div>
              )}

              {isTourisme ? (
                <Button
                  type="button"
                  className="w-full bg-primary hover:bg-primary/90 mt-6"
                  disabled={createListing.isPending || updateTourismeListing.isPending || uploadingTourisme}
                  onClick={onSubmitTourisme}
                >
                  {createListing.isPending || updateTourismeListing.isPending
                    ? t.sending
                    : (isEditMode
                      ? (lang === "fr" ? "Enregistrer les modifications" : "Save changes")
                      : (lang === "fr" ? "Soumettre le catalogue" : "Submit catalog"))}
                </Button>
              ) : (
                <Button
                  type="submit"
                  className="w-full bg-primary hover:bg-primary/90 mt-6"
                  disabled={createListing.isPending || isProcessing}
                >
                  {createListing.isPending ? t.sending : t.submitListing}
                </Button>
              )}
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}
