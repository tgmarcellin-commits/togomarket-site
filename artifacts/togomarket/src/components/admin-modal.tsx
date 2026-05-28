import { useState, useRef } from "react";
import { ImageViewer } from "@/components/image-viewer";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  useVerifyAdmin,
  useGetAdminSettings,
  useUpdateAdminSettings,
  useAdminGetPendingListings,
  useAdminApproveListing,
  useAdminDeleteListing,
  useAdminCreateAd,
  useAdminGetAllAds,
  useAdminDeleteAd,
  useAdminGetVendors,
  useAdminActivateVendor,
  useAdminGenerateVendorCode,
  useAdminCreateListing,
  getGetAdminSettingsQueryKey,
  getGetListingsQueryKey,
  type Ad,
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
import { useToast } from "@/hooks/use-toast";
import { Settings, LogOut, CheckCircle, Trash2, Clock, KeyRound, Megaphone, Plus, RefreshCw, Users, UploadCloud, X } from "lucide-react";
import { resizeImage } from "@/lib/image";

const loginSchema = z.object({
  password: z.string().min(1, "Mot de passe requis"),
});
type LoginValues = z.infer<typeof loginSchema>;

interface AdminModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (password: string) => void;
  adminPassword?: string;
  isAdmin?: boolean;
}

const COMMISSION_OPTIONS = [
  { rate: 0, label: "Gratuit — 0 FCFA" },
  { rate: 2, label: "2% (max 2 000 FCFA pour les articles > 100 000 FCFA)" },
  { rate: 3, label: "3% (max 3 000 FCFA pour les articles > 100 000 FCFA)" },
  { rate: 4, label: "4% (max 4 000 FCFA pour les articles > 100 000 FCFA)" },
  { rate: 5, label: "5% (max 5 000 FCFA pour les articles > 100 000 FCFA)" },
];

type DashTab = "pending" | "vendors" | "publish" | "ads" | "settings";

export function AdminModal({
  open,
  onOpenChange,
  onSuccess,
  adminPassword,
  isAdmin,
}: AdminModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [screen, setScreen] = useState<"login" | "dashboard">(isAdmin ? "dashboard" : "login");
  const [storedPassword, setStoredPassword] = useState(adminPassword ?? "");
  const [tab, setTab] = useState<DashTab>("pending");
  const [viewerImages, setViewerImages] = useState<string[]>([]);
  const [viewerIndex, setViewerIndex] = useState(0);

  const [allAds, setAllAds] = useState<Ad[]>([]);
  const [adsLoading, setAdsLoading] = useState(false);
  const [showAdForm, setShowAdForm] = useState(false);
  const [adForm, setAdForm] = useState({ advertiserName: "", advertiserPhone: "", message: "", image: "" });
  const adImageRef = useRef<HTMLInputElement>(null);

  const [vendors, setVendors] = useState<VendorProfile[]>([]);
  const [vendorsLoading, setVendorsLoading] = useState(false);
  const [generatedCode, setGeneratedCode] = useState<{ code: string; phone: string } | null>(null);

  const [adminPublishForm, setAdminPublishForm] = useState({
    name: "", price: "", location: "", sector: "Divers", phone: "", images: [] as string[],
  });
  const [adminPublishProcessing, setAdminPublishProcessing] = useState(false);
  const adminPublishImageRef = useRef<HTMLInputElement>(null);

  const createAd = useAdminCreateAd();
  const adminCreateListing = useAdminCreateListing();
  const getAllAds = useAdminGetAllAds();
  const deleteAd = useAdminDeleteAd();
  const getVendors = useAdminGetVendors();
  const activateVendor = useAdminActivateVendor();
  const generateCode = useAdminGenerateVendorCode();

  const refetchAds = () => {
    if (!storedPassword) return;
    setAdsLoading(true);
    getAllAds.mutate(
      { data: { password: storedPassword } },
      {
        onSuccess: (data) => { setAllAds(data); setAdsLoading(false); },
        onError: () => setAdsLoading(false),
      }
    );
  };

  const refetchVendors = () => {
    if (!storedPassword) return;
    setVendorsLoading(true);
    getVendors.mutate(
      { data: { password: storedPassword } },
      {
        onSuccess: (data) => { setVendors(data); setVendorsLoading(false); },
        onError: () => setVendorsLoading(false),
      }
    );
  };

  const handleActivateVendor = (vendorId: number) => {
    activateVendor.mutate(
      { data: { password: storedPassword, vendorId } },
      {
        onSuccess: (res) => {
          setGeneratedCode({ code: res.code, phone: res.vendorPhone });
          refetchVendors();
        },
        onError: () => toast({ title: "Erreur lors de l'activation", variant: "destructive" }),
      }
    );
  };

  const handleGenerateCode = (vendorId: number) => {
    generateCode.mutate(
      { data: { password: storedPassword, vendorId } },
      {
        onSuccess: (res) => {
          setGeneratedCode({ code: res.code, phone: res.vendorPhone });
          refetchVendors();
        },
        onError: () => toast({ title: "Erreur lors de la génération du code", variant: "destructive" }),
      }
    );
  };

  const sendCodeWhatsApp = (code: string, phone: string) => {
    const msg = `Bonjour ! Votre code de publication TogoMarket est : ${code}\nIl est valable 30 jours. Bonne vente !`;
    window.open(`https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(msg)}`, "_blank");
  };

  const handleAdminPublishImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const files = Array.from(e.target.files);
    if (adminPublishForm.images.length + files.length > 4) {
      toast({ title: "Maximum 4 images", variant: "destructive" });
      return;
    }
    setAdminPublishProcessing(true);
    try {
      const resized = await Promise.all(files.map((f) => resizeImage(f)));
      setAdminPublishForm((p) => ({ ...p, images: [...p.images, ...resized].slice(0, 4) }));
    } catch {
      toast({ title: "Erreur image", variant: "destructive" });
    } finally {
      setAdminPublishProcessing(false);
    }
  };

  const handleAdminPublish = () => {
    const { name, price, location, sector, phone } = adminPublishForm;
    if (!name.trim() || !price || !location.trim() || !phone.trim()) {
      toast({ title: "Champs requis", variant: "destructive" });
      return;
    }
    adminCreateListing.mutate(
      { data: { password: storedPassword, name: name.trim(), price: parseFloat(price), location: location.trim(), sector, phone: phone.trim(), images: adminPublishForm.images } },
      {
        onSuccess: () => {
          toast({ title: "Annonce publiée directement !", description: "Visible immédiatement sur le site." });
          setAdminPublishForm({ name: "", price: "", location: "", sector: "Divers", phone: "", images: [] });
          queryClient.invalidateQueries({ queryKey: getGetListingsQueryKey() });
        },
        onError: () => toast({ title: "Erreur lors de la publication", variant: "destructive" }),
      }
    );
  };

  const isAdActive = (ad: Ad) => new Date(ad.endDate) > new Date();

  const handleAdImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const resized = await resizeImage(file);
      setAdForm((f) => ({ ...f, image: resized }));
    } catch {
      setAdForm((f) => ({ ...f, image: "" }));
    }
  };

  const handleCreateAd = () => {
    if (!adForm.advertiserName.trim() || !adForm.advertiserPhone.trim() || !adForm.message.trim()) {
      toast({ title: "Champs requis", description: "Remplissez tous les champs obligatoires.", variant: "destructive" });
      return;
    }
    createAd.mutate(
      { data: { password: storedPassword, ...adForm } },
      {
        onSuccess: () => {
          toast({ title: "Publicité créée", description: "Elle est maintenant visible sur le site pendant 30 jours." });
          setAdForm({ advertiserName: "", advertiserPhone: "", message: "", image: "" });
          setShowAdForm(false);
          refetchAds();
        },
        onError: () => {
          toast({ title: "Erreur", description: "Impossible de créer la publicité.", variant: "destructive" });
        },
      }
    );
  };

  const handleDeleteAd = (id: number) => {
    if (!confirm("Supprimer cette publicité ?")) return;
    deleteAd.mutate(
      { data: { id, password: storedPassword } },
      {
        onSuccess: () => { toast({ title: "Publicité supprimée" }); refetchAds(); },
        onError: () => { toast({ title: "Erreur", variant: "destructive" }); },
      }
    );
  };

  const handleRenewWhatsApp = (ad: Ad) => {
    const msg = `Bonjour ${ad.advertiserName}, votre publicité sur TogoMarket a expiré. Souhaitez-vous la renouveler pour 1 000 FCFA/mois ?`;
    window.open(`https://wa.me/${ad.advertiserPhone.replace(/\D/g, "")}?text=${encodeURIComponent(msg)}`, "_blank");
  };

  const openViewer = (images: string[], index: number) => {
    setViewerImages(images);
    setViewerIndex(index);
  };

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { password: "" },
  });

  const verifyAdmin = useVerifyAdmin();
  const updateSettings = useUpdateAdminSettings();
  const { data: settings, refetch: refetchSettings } = useGetAdminSettings();

  const pendingMutation = useAdminGetPendingListings();
  const [pendingListings, setPendingListings] = useState<NonNullable<ReturnType<typeof useAdminGetPendingListings>["data"]>>([]);
  const [pendingLoading, setPendingLoading] = useState(false);

  const refetchPending = () => {
    if (!storedPassword) return;
    setPendingLoading(true);
    pendingMutation.mutate(
      { data: { password: storedPassword } },
      {
        onSuccess: (data) => { setPendingListings(data); setPendingLoading(false); },
        onError: () => setPendingLoading(false),
      }
    );
  };

  const approveListing = useAdminApproveListing();
  const deleteListing = useAdminDeleteListing();

  const onLogin = (data: LoginValues) => {
    verifyAdmin.mutate(
      { data },
      {
        onSuccess: (res) => {
          if (res.success) {
            toast({ title: "Connexion réussie", description: "Mode admin activé." });
            setStoredPassword(data.password);
            onSuccess(data.password);
            form.reset();
            setScreen("dashboard");
            setPendingLoading(true);
            pendingMutation.mutate(
              { data: { password: data.password } },
              {
                onSuccess: (d) => { setPendingListings(d); setPendingLoading(false); },
                onError: () => setPendingLoading(false),
              }
            );
            getAllAds.mutate(
              { data: { password: data.password } },
              { onSuccess: (d) => setAllAds(d) }
            );
          } else {
            form.setError("password", { message: "Mot de passe incorrect" });
          }
        },
        onError: () => {
          form.setError("password", { message: "Erreur lors de la vérification" });
        },
      }
    );
  };

  const handleApprove = (id: number) => {
    approveListing.mutate(
      { data: { id, password: storedPassword } },
      {
        onSuccess: () => {
          toast({ title: "Annonce approuvée", description: "Elle est maintenant visible sur le site." });
          refetchPending();
          queryClient.invalidateQueries({ queryKey: ["getListings"] });
        },
        onError: () => {
          toast({ title: "Erreur", description: "Impossible d'approuver.", variant: "destructive" });
        },
      }
    );
  };

  const handleDelete = (id: number) => {
    deleteListing.mutate(
      { data: { id, password: storedPassword } },
      {
        onSuccess: () => {
          toast({ title: "Annonce supprimée" });
          refetchPending();
          queryClient.invalidateQueries({ queryKey: ["getListings"] });
        },
        onError: () => {
          toast({ title: "Erreur", description: "Impossible de supprimer.", variant: "destructive" });
        },
      }
    );
  };

  const handleSetRate = (rate: number) => {
    updateSettings.mutate(
      { data: { password: storedPassword, commissionRate: rate } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetAdminSettingsQueryKey() });
          toast({ title: "Tarif mis à jour", description: `Commission réglée à ${rate}%` });
        },
        onError: () => {
          toast({ title: "Erreur", description: "Impossible de mettre à jour.", variant: "destructive" });
        },
      }
    );
  };


  const handleClose = () => {
    onOpenChange(false);
    if (!isAdmin) setScreen("login");
  };

  return (
    <>
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="w-5 h-5" />
            {screen === "login" ? "Accès Administrateur" : "Panneau Admin"}
          </DialogTitle>
        </DialogHeader>

        {screen === "login" ? (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onLogin)} className="space-y-4 pt-4">
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Mot de passe</FormLabel>
                    <FormControl>
                      <Input type="password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" className="w-full" disabled={verifyAdmin.isPending}>
                {verifyAdmin.isPending ? "Vérification..." : "Se connecter"}
              </Button>
            </form>
          </Form>
        ) : (
          <div className="pt-2 space-y-4">
            {/* Tabs */}
            <div className="grid grid-cols-5 rounded-lg border overflow-hidden">
              <button
                onClick={() => setTab("pending")}
                className={`py-2 text-[11px] font-medium flex items-center justify-center gap-0.5 transition-colors ${
                  tab === "pending" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"
                }`}
              >
                <Clock className="w-3 h-3" />
                <span className="hidden xs:inline">File</span>
                {pendingListings.length > 0 && (
                  <span className={`px-1 py-0.5 rounded-full text-[9px] font-bold ${
                    tab === "pending" ? "bg-white/20 text-white" : "bg-primary text-primary-foreground"
                  }`}>
                    {pendingListings.length}
                  </span>
                )}
              </button>
              <button
                onClick={() => { setTab("vendors"); refetchVendors(); }}
                className={`py-2 text-[11px] font-medium flex items-center justify-center gap-0.5 transition-colors ${
                  tab === "vendors" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"
                }`}
              >
                <Users className="w-3 h-3" />
                Vend.
              </button>
              <button
                onClick={() => setTab("publish")}
                className={`py-2 text-[11px] font-medium flex items-center justify-center gap-0.5 transition-colors ${
                  tab === "publish" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"
                }`}
              >
                <Plus className="w-3 h-3" />
                Pub.
              </button>
              <button
                onClick={() => { setTab("ads"); refetchAds(); }}
                className={`py-2 text-[11px] font-medium flex items-center justify-center gap-0.5 transition-colors ${
                  tab === "ads" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"
                }`}
              >
                <Megaphone className="w-3 h-3" />
                Pubs
              </button>
              <button
                onClick={() => setTab("settings")}
                className={`py-2 text-[11px] font-medium flex items-center justify-center gap-0.5 transition-colors ${
                  tab === "settings" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"
                }`}
              >
                <Settings className="w-3 h-3" />
                Config
              </button>
            </div>

            {/* Tab: Annonces en attente */}
            {tab === "pending" && (
              <div className="space-y-3">
                {pendingLoading ? (
                  <p className="text-sm text-center text-muted-foreground py-6">Chargement...</p>
                ) : pendingListings.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <CheckCircle className="w-10 h-10 mx-auto mb-2 text-green-500" />
                    <p className="text-sm font-medium">Aucune annonce en attente</p>
                    <p className="text-xs mt-1">Toutes les annonces sont traitées.</p>
                  </div>
                ) : (
                  pendingListings.map((listing) => (
                    <div key={listing.id} className="border rounded-lg p-3 space-y-2">
                      <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-sm truncate">{listing.name}</p>
                          <p className="text-xs text-muted-foreground">{listing.sector} · {listing.location}</p>
                          <p className="text-sm font-bold text-primary mt-0.5">
                            {Number(listing.price).toLocaleString("fr-FR")} FCFA
                          </p>
                          <p className="text-xs text-muted-foreground">Tél: {listing.phone}</p>
                        </div>
                      </div>
                      {listing.images && listing.images.length > 0 && (
                        <div className="flex gap-2 flex-wrap">
                          {listing.images.map((img, i) => (
                            <button
                              key={i}
                              onClick={() => openViewer(listing.images!, i)}
                              className="relative w-16 h-16 rounded-md overflow-hidden border border-border hover:border-primary transition-colors flex-shrink-0 group/thumb"
                            >
                              <img src={img} alt={`Photo ${i + 1}`} className="w-full h-full object-cover" />
                              <div className="absolute inset-0 bg-black/0 group-hover/thumb:bg-black/20 transition-colors flex items-center justify-center">
                                <span className="text-white text-[10px] font-bold opacity-0 group-hover/thumb:opacity-100">Voir</span>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                      
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          className="flex-1 bg-green-600 hover:bg-green-700 text-white h-8"
                          onClick={() => handleApprove(listing.id)}
                          disabled={approveListing.isPending}
                        >
                          <CheckCircle className="w-3.5 h-3.5 mr-1" />
                          Approuver
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          className="flex-1 h-8"
                          onClick={() => handleDelete(listing.id)}
                          disabled={deleteListing.isPending}
                        >
                          <Trash2 className="w-3.5 h-3.5 mr-1" />
                          Rejeter
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Tab: Vendeurs */}
            {tab === "vendors" && (
              <div className="space-y-3">
                {generatedCode && (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-3 space-y-2">
                    <p className="text-xs font-semibold text-green-700">Code généré avec succès !</p>
                    <div className="flex items-center gap-3">
                      <span className="text-2xl font-mono font-extrabold text-green-800 tracking-widest">{generatedCode.code}</span>
                      <Button
                        size="sm"
                        className="h-7 text-xs bg-green-500 hover:bg-green-600 text-white gap-1"
                        onClick={() => sendCodeWhatsApp(generatedCode.code, generatedCode.phone)}
                      >
                        Envoyer sur WhatsApp
                      </Button>
                    </div>
                    <button className="text-[10px] text-green-600 underline" onClick={() => setGeneratedCode(null)}>Fermer</button>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">Vendeurs ({vendors.length})</p>
                  <Button size="sm" variant="outline" onClick={refetchVendors} className="h-7 px-2">
                    <RefreshCw className="w-3.5 h-3.5" />
                  </Button>
                </div>
                {vendorsLoading ? (
                  <p className="text-sm text-center text-muted-foreground py-6">Chargement...</p>
                ) : vendors.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Users className="w-10 h-10 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">Aucun vendeur inscrit</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {vendors.map((v) => {
                      const hasCode = !!v.publishCode;
                      const daysLeft = v.publishCode?.daysLeft ?? 0;
                      return (
                        <div key={v.id} className={`border rounded-lg p-3 space-y-2 ${!v.verified ? "bg-amber-50/50 border-amber-200" : ""}`}>
                          <div className="flex items-start gap-2">
                            {v.profilePhoto ? (
                              <img src={v.profilePhoto} alt={v.firstName} className="w-9 h-9 rounded-full object-cover border flex-shrink-0" />
                            ) : (
                              <div className="w-9 h-9 bg-muted rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold text-muted-foreground">
                                {v.firstName[0]}{v.lastName[0]}
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <p className="text-sm font-semibold">{v.firstName} {v.lastName}</p>
                                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${v.verified ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
                                  {v.verified ? "Vérifié" : "En attente"}
                                </span>
                              </div>
                              <p className="text-xs text-muted-foreground">{v.phone}</p>
                              {v.verified && hasCode && (
                                <div className="flex items-center gap-2 mt-1">
                                  <span className="font-mono font-extrabold text-base tracking-widest text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded">
                                    {v.publishCode!.code}
                                  </span>
                                  <span className="text-[10px] text-green-600 font-medium">{daysLeft}j restant(s)</span>
                                  <button
                                    onClick={() => sendCodeWhatsApp(v.publishCode!.code, v.phone)}
                                    className="text-[10px] text-green-700 underline font-medium hover:text-green-900"
                                  >
                                    Renvoyer
                                  </button>
                                </div>
                              )}
                              {v.verified && !hasCode && (
                                <p className="text-[10px] mt-0.5 font-medium text-red-500">Aucun code actif</p>
                              )}
                            </div>
                          </div>
                          <div className="flex gap-2">
                            {!v.verified && (
                              <Button
                                size="sm"
                                className="flex-1 h-7 text-xs bg-green-600 hover:bg-green-700 text-white"
                                onClick={() => handleActivateVendor(v.id)}
                                disabled={activateVendor.isPending}
                              >
                                <CheckCircle className="w-3 h-3 mr-1" />
                                Activer + Code gratuit
                              </Button>
                            )}
                            {v.verified && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="flex-1 h-7 text-xs"
                                onClick={() => handleGenerateCode(v.id)}
                                disabled={generateCode.isPending}
                              >
                                <KeyRound className="w-3 h-3 mr-1" />
                                {hasCode ? "Nouveau code" : "Générer code"}
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Tab: Publier pour un client */}
            {tab === "publish" && (
              <div className="space-y-3">
                <p className="text-sm font-semibold">Publier au nom d'un client</p>
                <p className="text-xs text-muted-foreground">L'annonce sera publiée directement et visible immédiatement.</p>

                <div className="space-y-2">
                  <Input
                    placeholder="Titre de l'article *"
                    value={adminPublishForm.name}
                    onChange={(e) => setAdminPublishForm((p) => ({ ...p, name: e.target.value }))}
                    className="h-9 text-sm"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      type="number"
                      placeholder="Prix (FCFA) *"
                      value={adminPublishForm.price}
                      onChange={(e) => setAdminPublishForm((p) => ({ ...p, price: e.target.value }))}
                      className="h-9 text-sm"
                    />
                    <select
                      value={adminPublishForm.sector}
                      onChange={(e) => setAdminPublishForm((p) => ({ ...p, sector: e.target.value }))}
                      className="h-9 text-sm border rounded-md px-2 bg-background"
                    >
                      <option value="AgriMarket">AgriMarket</option>
                      <option value="Immobilier">Immobilier</option>
                      <option value="Automobile">Automobile</option>
                      <option value="Divers">Divers</option>
                    </select>
                  </div>
                  <Input
                    placeholder="Quartier / Ville *"
                    value={adminPublishForm.location}
                    onChange={(e) => setAdminPublishForm((p) => ({ ...p, location: e.target.value }))}
                    className="h-9 text-sm"
                  />
                  <Input
                    placeholder="Numéro WhatsApp du client *"
                    value={adminPublishForm.phone}
                    onChange={(e) => setAdminPublishForm((p) => ({ ...p, phone: e.target.value }))}
                    className="h-9 text-sm"
                  />

                  <div>
                    <p className="text-xs font-medium mb-1.5 text-muted-foreground">Photos (max 4)</p>
                    <div className="flex flex-wrap gap-2">
                      {adminPublishForm.images.map((img, i) => (
                        <div key={i} className="relative w-16 h-16 rounded-md overflow-hidden border flex-shrink-0">
                          <img src={img} alt="" className="w-full h-full object-cover" />
                          <button
                            type="button"
                            onClick={() => setAdminPublishForm((p) => ({ ...p, images: p.images.filter((_, idx) => idx !== i) }))}
                            className="absolute top-0.5 right-0.5 bg-black/50 text-white rounded-full p-0.5"
                          >
                            <X className="w-2.5 h-2.5" />
                          </button>
                        </div>
                      ))}
                      {adminPublishForm.images.length < 4 && (
                        <label className="w-16 h-16 flex flex-col items-center justify-center border-2 border-dashed border-muted-foreground/30 rounded-md cursor-pointer hover:bg-muted/50">
                          <UploadCloud className="w-4 h-4 text-muted-foreground mb-0.5" />
                          <span className="text-[9px] text-muted-foreground">Ajouter</span>
                          <input
                            ref={adminPublishImageRef}
                            type="file"
                            accept="image/*"
                            multiple
                            className="hidden"
                            onChange={handleAdminPublishImageChange}
                            disabled={adminPublishProcessing}
                          />
                        </label>
                      )}
                    </div>
                  </div>
                </div>

                <Button
                  className="w-full"
                  onClick={handleAdminPublish}
                  disabled={adminCreateListing.isPending || adminPublishProcessing}
                >
                  {adminCreateListing.isPending ? "Publication..." : "Publier maintenant"}
                </Button>
              </div>
            )}

            {/* Tab: Publicités */}
            {tab === "ads" && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">Publicités ({allAds.length})</p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={refetchAds} className="h-7 px-2">
                      <RefreshCw className="w-3.5 h-3.5" />
                    </Button>
                    <Button size="sm" onClick={() => setShowAdForm(!showAdForm)} className="h-7 px-2 gap-1">
                      <Plus className="w-3.5 h-3.5" />
                      Ajouter
                    </Button>
                  </div>
                </div>

                {showAdForm && (
                  <div className="border rounded-lg p-3 space-y-2 bg-muted/30">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Nouvelle publicité — 1 000 FCFA/mois</p>
                    <Input
                      placeholder="Nom de l'annonceur *"
                      value={adForm.advertiserName}
                      onChange={(e) => setAdForm((f) => ({ ...f, advertiserName: e.target.value }))}
                      className="h-8 text-sm"
                    />
                    <Input
                      placeholder="Téléphone annonceur *"
                      value={adForm.advertiserPhone}
                      onChange={(e) => setAdForm((f) => ({ ...f, advertiserPhone: e.target.value }))}
                      className="h-8 text-sm"
                    />
                    <Input
                      placeholder="Message publicitaire *"
                      value={adForm.message}
                      onChange={(e) => setAdForm((f) => ({ ...f, message: e.target.value }))}
                      className="h-8 text-sm"
                    />
                    <div className="flex items-center gap-2">
                      <input
                        ref={adImageRef}
                        type="file"
                        accept="image/*"
                        onChange={handleAdImageChange}
                        className="hidden"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => adImageRef.current?.click()}
                      >
                        {adForm.image ? "Image choisie ✓" : "Ajouter une image"}
                      </Button>
                      {adForm.image && (
                        <img src={adForm.image} alt="preview" className="w-8 h-8 rounded object-cover border" />
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" className="flex-1 h-7" onClick={handleCreateAd} disabled={createAd.isPending}>
                        {createAd.isPending ? "Création..." : "Créer"}
                      </Button>
                      <Button size="sm" variant="outline" className="flex-1 h-7" onClick={() => setShowAdForm(false)}>
                        Annuler
                      </Button>
                    </div>
                  </div>
                )}

                {adsLoading ? (
                  <p className="text-sm text-center text-muted-foreground py-6">Chargement...</p>
                ) : allAds.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Megaphone className="w-10 h-10 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">Aucune publicité</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {allAds.map((ad) => {
                      const active = isAdActive(ad);
                      const endDate = new Date(ad.endDate).toLocaleDateString("fr-FR");
                      return (
                        <div key={ad.id} className={`border rounded-lg p-3 space-y-1.5 ${active ? "" : "opacity-60 bg-muted/30"}`}>
                          <div className="flex items-start gap-2">
                            {ad.image && (
                              <img src={ad.image} alt={ad.advertiserName} className="w-10 h-10 rounded object-cover border flex-shrink-0" />
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <p className="text-sm font-semibold truncate">{ad.advertiserName}</p>
                                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${active ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"}`}>
                                  {active ? "Actif" : "Expiré"}
                                </span>
                              </div>
                              <p className="text-xs text-muted-foreground truncate">{ad.message}</p>
                              <p className="text-[10px] text-muted-foreground">Expire le {endDate}</p>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            {!active && (
                              <Button
                                size="sm"
                                className="flex-1 h-7 text-xs bg-green-600 hover:bg-green-700 text-white"
                                onClick={() => handleRenewWhatsApp(ad)}
                              >
                                📱 Renouvellement WhatsApp
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="destructive"
                              className={`h-7 text-xs ${!active ? "" : "flex-1"}`}
                              onClick={() => handleDeleteAd(ad.id)}
                            >
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Tab: Paramètres */}
            {tab === "settings" && (
              <div className="space-y-5">
                <div>
                  <p className="text-sm font-semibold mb-3">Tarif de commission</p>
                  <p className="text-xs text-muted-foreground mb-4">
                    Appliqué automatiquement sur chaque annonce. Plafonné pour les articles &gt; 100 000 FCFA.
                  </p>
                  <div className="space-y-2">
                    {COMMISSION_OPTIONS.map((opt) => {
                      const isActive = settings?.commissionRate === opt.rate;
                      return (
                        <button
                          key={opt.rate}
                          onClick={() => handleSetRate(opt.rate)}
                          disabled={updateSettings.isPending}
                          className={`w-full text-left px-4 py-3 rounded-lg border text-sm transition-colors ${
                            isActive
                              ? "bg-primary text-primary-foreground border-primary font-semibold"
                              : "bg-background border-border hover:bg-muted"
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            <Button variant="outline" className="w-full" onClick={handleClose}>
              <LogOut className="w-4 h-4 mr-2" />
              Fermer
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>

    {viewerImages.length > 0 && (
      <ImageViewer
        images={viewerImages}
        startIndex={viewerIndex}
        onClose={() => setViewerImages([])}
      />
    )}
    </>
  );
}
