import { useState } from "react";
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
  getGetAdminSettingsQueryKey,
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
import { Settings, LogOut, CheckCircle, Trash2, Clock, KeyRound, Store, UserPlus } from "lucide-react";

function getBaseUrl(): string {
  return import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
}

interface SellerRecord {
  id: number;
  firstName: string;
  phone: string;
}

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

type DashTab = "pending" | "settings" | "sellers";

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
  const [newCode, setNewCode] = useState("");
  const [viewerImages, setViewerImages] = useState<string[]>([]);
  const [viewerIndex, setViewerIndex] = useState(0);

  const [sellers, setSellers] = useState<SellerRecord[]>([]);
  const [sellersLoading, setSellersLoading] = useState(false);
  const [newSellerFirstName, setNewSellerFirstName] = useState("");
  const [newSellerPhone, setNewSellerPhone] = useState("");
  const [sellerSaving, setSellerSaving] = useState(false);

  const fetchSellers = async (pwd: string) => {
    setSellersLoading(true);
    try {
      const base = getBaseUrl();
      const res = await fetch(`${base}/api/admin/sellers/list`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pwd }),
      });
      if (res.ok) {
        const data = await res.json();
        setSellers(data);
      }
    } finally {
      setSellersLoading(false);
    }
  };

  const handleAddSeller = async () => {
    if (!newSellerFirstName.trim() || !newSellerPhone.trim()) {
      toast({ title: "Champs requis", description: "Remplissez le prénom et le numéro.", variant: "destructive" });
      return;
    }
    setSellerSaving(true);
    try {
      const base = getBaseUrl();
      const res = await fetch(`${base}/api/admin/sellers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: storedPassword, firstName: newSellerFirstName.trim(), phone: newSellerPhone.trim() }),
      });
      if (res.ok) {
        const seller = await res.json();
        setSellers((prev) => [...prev, seller]);
        setNewSellerFirstName("");
        setNewSellerPhone("");
        toast({ title: `Boutique N°${seller.id} créée`, description: `Vendeur : ${seller.firstName}` });
      } else {
        const err = await res.json();
        toast({ title: "Erreur", description: err.error ?? "Impossible de créer.", variant: "destructive" });
      }
    } finally {
      setSellerSaving(false);
    }
  };

  const handleDeleteSeller = async (id: number) => {
    if (!confirm(`Supprimer la boutique N°${id} ?`)) return;
    try {
      const base = getBaseUrl();
      const res = await fetch(`${base}/api/admin/sellers/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: storedPassword, id }),
      });
      if (res.ok) {
        setSellers((prev) => prev.filter((s) => s.id !== id));
        toast({ title: "Boutique supprimée" });
      }
    } catch {
      toast({ title: "Erreur", description: "Impossible de supprimer.", variant: "destructive" });
    }
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
            fetchSellers(data.password);
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
      { data: { password: storedPassword, commissionRate: rate, publishCode: settings?.publishCode ?? "TOGO2026" } },
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

  const handleSaveCode = () => {
    if (!newCode.trim()) {
      toast({ title: "Code vide", description: "Le code ne peut pas être vide.", variant: "destructive" });
      return;
    }
    updateSettings.mutate(
      { data: { password: storedPassword, commissionRate: settings?.commissionRate ?? 2, publishCode: newCode.trim() } },
      {
        onSuccess: () => {
          refetchSettings();
          setNewCode("");
          toast({ title: "Code mis à jour", description: `Nouveau code : ${newCode.trim()}` });
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
            <div className="flex rounded-lg border overflow-hidden">
              <button
                onClick={() => setTab("pending")}
                className={`flex-1 py-2 text-sm font-medium flex items-center justify-center gap-1.5 transition-colors ${
                  tab === "pending" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"
                }`}
              >
                <Clock className="w-4 h-4" />
                En attente
                {pendingListings.length > 0 && (
                  <span className={`ml-1 px-1.5 py-0.5 rounded-full text-xs font-bold ${
                    tab === "pending" ? "bg-white/20 text-white" : "bg-primary text-primary-foreground"
                  }`}>
                    {pendingListings.length}
                  </span>
                )}
              </button>
              <button
                onClick={() => { setTab("sellers"); fetchSellers(storedPassword); }}
                className={`flex-1 py-2 text-sm font-medium flex items-center justify-center gap-1.5 transition-colors ${
                  tab === "sellers" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"
                }`}
              >
                <Store className="w-4 h-4" />
                Boutiques
              </button>
              <button
                onClick={() => setTab("settings")}
                className={`flex-1 py-2 text-sm font-medium flex items-center justify-center gap-1.5 transition-colors ${
                  tab === "settings" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"
                }`}
              >
                <Settings className="w-4 h-4" />
                Paramètres
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

            {/* Tab: Boutiques / Vendeurs */}
            {tab === "sellers" && (
              <div className="space-y-4">
                {/* Add seller form */}
                <div className="border rounded-lg p-3 space-y-2 bg-muted/30">
                  <p className="text-sm font-semibold flex items-center gap-1">
                    <UserPlus className="w-4 h-4" /> Ajouter un vendeur
                  </p>
                  <div className="flex gap-2">
                    <Input
                      placeholder="Prénom du vendeur"
                      value={newSellerFirstName}
                      onChange={(e) => setNewSellerFirstName(e.target.value)}
                      className="flex-1"
                    />
                    <Input
                      placeholder="Numéro WhatsApp"
                      value={newSellerPhone}
                      onChange={(e) => setNewSellerPhone(e.target.value)}
                      className="flex-1"
                    />
                  </div>
                  <Button
                    onClick={handleAddSeller}
                    disabled={sellerSaving}
                    className="w-full"
                    size="sm"
                  >
                    {sellerSaving ? "Ajout..." : "Créer la boutique"}
                  </Button>
                </div>

                {/* Sellers list */}
                {sellersLoading ? (
                  <p className="text-sm text-center text-muted-foreground py-4">Chargement...</p>
                ) : sellers.length === 0 ? (
                  <div className="text-center py-6 text-muted-foreground">
                    <Store className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    <p className="text-sm">Aucune boutique enregistrée</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {sellers.map((s) => (
                      <div key={s.id} className="flex items-center justify-between border rounded-lg px-3 py-2">
                        <div>
                          <p className="text-sm font-semibold">
                            N°{s.id} — {s.firstName}
                          </p>
                          <p className="text-xs text-muted-foreground">{s.phone}</p>
                        </div>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleDeleteSeller(s.id)}
                          className="h-7 px-2"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Tab: Paramètres */}
            {tab === "settings" && (
              <div className="space-y-5">
                {/* Code de publication */}
                <div>
                  <p className="text-sm font-semibold mb-1 flex items-center gap-1">
                    <KeyRound className="w-4 h-4" /> Code d'accès vendeur
                  </p>
                  <p className="text-xs text-muted-foreground mb-3">
                    Code actuel : <span className="font-mono font-bold text-foreground">{settings?.publishCode ?? "—"}</span>
                  </p>
                  <div className="flex gap-2">
                    <Input
                      placeholder="Nouveau code..."
                      value={newCode}
                      onChange={(e) => setNewCode(e.target.value)}
                      className="flex-1"
                    />
                    <Button
                      onClick={handleSaveCode}
                      disabled={updateSettings.isPending}
                      size="sm"
                    >
                      Sauvegarder
                    </Button>
                  </div>
                </div>

                <div className="border-t pt-4">
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
