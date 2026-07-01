import { useState, useRef } from "react";
import { openWhatsApp } from "@/lib/whatsapp";
import { uploadVideoFile } from "@/lib/upload";
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
  useAdminDeleteVendor,
  useAdminResetVendorPassword,
  useAdminCreateListing,
  useAdminStorageCleanup,
  useAdminCreateEvent,
  useAdminDeleteEvent,
  useGetEvents,
  useGetAdminContactStats,
  useAdminCreateService,
  useAdminGetAllServices,
  useAdminDeleteService,
  getGetAdminSettingsQueryKey,
  getGetListingsQueryKey,
  getGetEventsQueryKey,
  getGetServicesQueryKey,
  type Ad,
  type VendorProfile,
  type Event as ApiEvent,
  type AdminContactStat,
  type Service,
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
import { Settings, LogOut, CheckCircle, Trash2, Clock, KeyRound, Megaphone, Plus, RefreshCw, Users, UploadCloud, X, Eye, EyeOff, AlertTriangle, Calendar, Briefcase, Search } from "lucide-react";
import { resizeImage, resizeImageToBlob, resolveImageUrl } from "@/lib/image";
import { uploadImageFile } from "@/lib/upload";

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

function StorageCleanupSection({ password }: { password: string }) {
  const storageCleanup = useAdminStorageCleanup();
  const { toast } = useToast();

  const handleCleanup = () => {
    storageCleanup.mutate(
      { data: { password } },
      {
        onSuccess: (result) => {
          toast({
            title: "Nettoyage terminé",
            description: `${result.deleted} fichier(s) orphelin(s) supprimé(s).`,
          });
        },
        onError: () => toast({ title: "Erreur lors du nettoyage", variant: "destructive" }),
      }
    );
  };

  return (
    <div>
      <p className="text-sm font-semibold mb-1">Nettoyage du stockage</p>
      <p className="text-xs text-muted-foreground mb-3">
        Supprime les fichiers images orphelins (non liés à une annonce).
      </p>
      <Button
        variant="outline"
        size="sm"
        className="w-full text-destructive border-destructive/30 hover:bg-destructive/10"
        onClick={handleCleanup}
        disabled={storageCleanup.isPending}
      >
        <RefreshCw className={`w-3.5 h-3.5 mr-2 ${storageCleanup.isPending ? "animate-spin" : ""}`} />
        {storageCleanup.isPending ? "Nettoyage en cours…" : "Nettoyer les orphelins"}
      </Button>
    </div>
  );
}

function ResetVendorPwdPanel({
  name,
  vendorPhone,
  resetPwdInput,
  setResetPwdInput,
  isPending,
  onConfirm,
  onCancel,
}: {
  name: string;
  vendorPhone: string;
  resetPwdInput: string;
  setResetPwdInput: (v: string) => void;
  isPending: boolean;
  onConfirm: (phone: string, pwd: string) => void;
  onCancel: () => void;
}) {
  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-2.5 space-y-2">
      <div className="flex items-center gap-1.5">
        <KeyRound className="w-3.5 h-3.5 text-blue-600 flex-shrink-0" />
        <p className="text-xs font-semibold text-blue-800">
          Nouveau mot de passe pour {name}
        </p>
      </div>
      <Input
        className="h-7 text-xs"
        placeholder="Min. 6 caractères"
        value={resetPwdInput}
        onChange={(e) => setResetPwdInput(e.target.value)}
        autoFocus
      />
      <div className="flex gap-2">
        <Button
          size="sm"
          className="flex-1 h-7 text-xs bg-blue-600 hover:bg-blue-700 text-white"
          onClick={() => onConfirm(vendorPhone, resetPwdInput)}
          disabled={isPending || resetPwdInput.length < 6}
        >
          {isPending ? "..." : "Réinitialiser"}
        </Button>
        <Button size="sm" variant="outline" className="flex-1 h-7 text-xs" onClick={onCancel}>
          Annuler
        </Button>
      </div>
    </div>
  );
}

type DashTab = "pending" | "vendors" | "ads" | "events" | "services" | "settings";

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
  const [adForm, setAdForm] = useState({ advertiserName: "", advertiserPhone: "", message: "", image: "", imagePreview: "", videoPath: "" });
  const adImageRef = useRef<HTMLInputElement>(null);
  const adVideoRef = useRef<HTMLInputElement>(null);
  const [adVideoUploading, setAdVideoUploading] = useState(false);
  const [adVideoName, setAdVideoName] = useState("");

  const [vendors, setVendors] = useState<VendorProfile[]>([]);
  const [vendorsLoading, setVendorsLoading] = useState(false);
  const [contactStats, setContactStats] = useState<AdminContactStat[]>([]);
  const [generatedCode, setGeneratedCode] = useState<{ code: string; phone: string } | null>(null);

  const [showAdminPwd, setShowAdminPwd] = useState(false);
  const [expandedAdIds, setExpandedAdIds] = useState<Set<number>>(new Set());
  const toggleAdExpand = (id: number) =>
    setExpandedAdIds((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });

  const [whatsappCommissionInput, setWhatsappCommissionInput] = useState("");
  const [whatsappOrdersInput, setWhatsappOrdersInput] = useState("");
  const [whatsappAdsInput, setWhatsappAdsInput] = useState("");
  const [whatsappServicesInput, setWhatsappServicesInput] = useState("");
  const [subAdminPwdInput, setSubAdminPwdInput] = useState("");
  const [vendorSearch, setVendorSearch] = useState("");

  const [allServices, setAllServices] = useState<Service[]>([]);
  const [servicesLoading, setServicesLoading] = useState(false);
  const [showServiceForm, setShowServiceForm] = useState(false);
  const [serviceForm, setServiceForm] = useState({ type: "offer" as "offer" | "seeker" | "atelier", title: "", description: "", contact: "", quartier: "", ville: "", image: "", imagePreview: "" });
  const [confirmDeleteServiceId, setConfirmDeleteServiceId] = useState<number | null>(null);
  const serviceImageRef = useRef<HTMLInputElement>(null);

  const adminCreateService = useAdminCreateService();
  const adminGetAllServices = useAdminGetAllServices();
  const adminDeleteService = useAdminDeleteService();

  const refetchServices = () => {
    setServicesLoading(true);
    adminGetAllServices.mutate(
      { data: { password: storedPassword } },
      {
        onSuccess: (data) => { setAllServices(data); setServicesLoading(false); },
        onError: () => setServicesLoading(false),
      }
    );
  };

  const [adminPublishForm, setAdminPublishForm] = useState({
    name: "", price: "", location: "", sector: "Divers", phone: "", images: [] as string[],
  });
  const [adminPublishImagePreviews, setAdminPublishImagePreviews] = useState<string[]>([]);
  const [adminPublishProcessing, setAdminPublishProcessing] = useState(false);
  const adminPublishImageRef = useRef<HTMLInputElement>(null);

  const [confirmAction, setConfirmAction] = useState<
    | { type: "newCode"; vendorId: number }
    | { type: "deleteVendor"; vendorId: number; name: string }
    | { type: "resetVendorPwd"; vendorId: number; vendorPhone: string; name: string }
    | { type: "deleteListing"; listingId: number }
    | { type: "deleteAd"; adId: number }
    | { type: "deleteEvent"; eventId: number }
    | null
  >(null);
  const [resetPwdInput, setResetPwdInput] = useState("");

  const [allEvents, setAllEvents] = useState<ApiEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [showEventForm, setShowEventForm] = useState(false);
  const [eventForm, setEventForm] = useState({ title: "", description: "", date: "", location: "", ticketPrice: "", ticketLink: "", flyerImage: "", flyerPreview: "" });
  const eventFlyerRef = useRef<HTMLInputElement>(null);

  const createEvent = useAdminCreateEvent();
  const deleteEvent = useAdminDeleteEvent();
  const getContactStats = useGetAdminContactStats();
  const getEventsQuery = useGetEvents();

  const refetchEvents = () => {
    setEventsLoading(true);
    getEventsQuery.refetch().then((res) => {
      setAllEvents(res.data ?? []);
      setEventsLoading(false);
    }).catch(() => setEventsLoading(false));
  };

  const handleCreateEvent = () => {
    if (!eventForm.title || !eventForm.description || !eventForm.date || !eventForm.location) {
      toast({ title: "Titre, description, date et lieu sont requis", variant: "destructive" });
      return;
    }
    createEvent.mutate(
      {
        data: {
          password: storedPassword,
          title: eventForm.title,
          description: eventForm.description,
          date: eventForm.date,
          location: eventForm.location,
          ticketPrice: eventForm.ticketPrice || undefined,
          ticketLink: eventForm.ticketLink || undefined,
          flyerImage: eventForm.flyerImage || undefined,
        }
      },
      {
        onSuccess: () => {
          toast({ title: "Événement créé !" });
          setShowEventForm(false);
          setEventForm({ title: "", description: "", date: "", location: "", ticketPrice: "", ticketLink: "", flyerImage: "", flyerPreview: "" });
          queryClient.invalidateQueries({ queryKey: getGetEventsQueryKey() });
          refetchEvents();
        },
        onError: () => toast({ title: "Erreur lors de la création", variant: "destructive" }),
      }
    );
  };

  const handleDeleteEvent = (id: number) => {
    deleteEvent.mutate(
      { data: { password: storedPassword, id } },
      {
        onSuccess: () => {
          toast({ title: "Événement supprimé" });
          setConfirmAction(null);
          queryClient.invalidateQueries({ queryKey: getGetEventsQueryKey() });
          refetchEvents();
        },
        onError: () => toast({ title: "Erreur lors de la suppression", variant: "destructive" }),
      }
    );
  };

  const handleEventFlyerChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    try {
      const { blob, dataUrl } = await resizeImageToBlob(file);
      const objectPath = await uploadImageFile(blob, file.name);
      setEventForm((f) => ({ ...f, flyerImage: objectPath, flyerPreview: dataUrl }));
    } catch {
      toast({ title: "Impossible de lire l'image", variant: "destructive" });
    }
  };

  const createAd = useAdminCreateAd();
  const adminCreateListing = useAdminCreateListing();
  const getAllAds = useAdminGetAllAds();
  const deleteAd = useAdminDeleteAd();
  const getVendors = useAdminGetVendors();
  const activateVendor = useAdminActivateVendor();
  const generateCode = useAdminGenerateVendorCode();
  const deleteVendor = useAdminDeleteVendor();
  const resetVendorPassword = useAdminResetVendorPassword();

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
    getContactStats.mutate(
      { data: { password: storedPassword } },
      { onSuccess: (data) => setContactStats(data) }
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
          setConfirmAction(null);
          setGeneratedCode({ code: res.code, phone: res.vendorPhone });
          refetchVendors();
        },
        onError: () => toast({ title: "Erreur lors de la génération du code", variant: "destructive" }),
      }
    );
  };

  const handleDeleteVendor = (vendorId: number) => {
    deleteVendor.mutate(
      { data: { password: storedPassword, vendorId } },
      {
        onSuccess: () => {
          setConfirmAction(null);
          toast({ title: "Vendeur supprimé", description: "Le compte a été supprimé définitivement." });
          refetchVendors();
        },
        onError: () => toast({ title: "Erreur lors de la suppression", variant: "destructive" }),
      }
    );
  };

  const handleResetVendorPassword = (vendorPhone: string, newPassword: string) => {
    if (newPassword.length < 6) {
      toast({ title: "Minimum 6 caractères", variant: "destructive" });
      return;
    }
    resetVendorPassword.mutate(
      { data: { password: storedPassword, vendorPhone, newPassword } },
      {
        onSuccess: () => {
          setConfirmAction(null);
          setResetPwdInput("");
          toast({ title: "Mot de passe réinitialisé", description: "Le vendeur peut maintenant se connecter avec son nouveau mot de passe." });
        },
        onError: () => toast({ title: "Erreur lors de la réinitialisation", variant: "destructive" }),
      }
    );
  };

  const sendCodeWhatsApp = (code: string, phone: string) => {
    const msg = `Bonjour ! Votre code de publication TogoMarket est : ${code}\nIl est valable 30 jours. Bonne vente !`;
    openWhatsApp(`https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(msg)}`);
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
      const entries = await Promise.all(
        files.map(async (f) => {
          const { blob, dataUrl } = await resizeImageToBlob(f);
          const objectPath = await uploadImageFile(blob, f.name);
          return { dataUrl, objectPath };
        })
      );
      setAdminPublishForm((p) => ({ ...p, images: [...p.images, ...entries.map((e) => e.objectPath)].slice(0, 4) }));
      setAdminPublishImagePreviews((p) => [...p, ...entries.map((e) => e.dataUrl)].slice(0, 4));
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
          setAdminPublishImagePreviews([]);
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
      const { blob, dataUrl } = await resizeImageToBlob(file);
      const objectPath = await uploadImageFile(blob, file.name);
      setAdForm((f) => ({ ...f, image: objectPath, imagePreview: dataUrl }));
    } catch {
      setAdForm((f) => ({ ...f, image: "", imagePreview: "" }));
    }
  };

  const handleAdVideoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) {
      toast({ title: "Vidéo trop lourde", description: "Maximum 50 Mo.", variant: "destructive" });
      return;
    }
    setAdVideoUploading(true);
    setAdVideoName(file.name);
    try {
      const objectPath = await uploadVideoFile(file);
      setAdForm((f) => ({ ...f, videoPath: objectPath }));
      toast({ title: "Vidéo envoyée ✓" });
    } catch {
      toast({ title: "Erreur vidéo", description: "Impossible d'envoyer la vidéo.", variant: "destructive" });
      setAdVideoName("");
    } finally {
      setAdVideoUploading(false);
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
          setAdForm({ advertiserName: "", advertiserPhone: "", message: "", image: "", imagePreview: "", videoPath: "" });
          setAdVideoName("");
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
    deleteAd.mutate(
      { data: { id, password: storedPassword } },
      {
        onSuccess: () => { setConfirmAction(null); toast({ title: "Publicité supprimée" }); refetchAds(); },
        onError: () => { toast({ title: "Erreur", variant: "destructive" }); },
      }
    );
  };

  const handleRenewWhatsApp = (ad: Ad) => {
    const msg = `Bonjour ${ad.advertiserName}, votre publicité sur TogoMarket a expiré. Souhaitez-vous la renouveler pour 1 000 FCFA/mois ?`;
    openWhatsApp(`https://wa.me/${ad.advertiserPhone.replace(/\D/g, "")}?text=${encodeURIComponent(msg)}`);
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
          setConfirmAction(null);
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
      {
        data: {
          password: storedPassword,
          commissionRate: rate,
          whatsappCommission: whatsappCommissionInput || (settings?.whatsappCommission ?? "22870703131"),
          whatsappOrders: whatsappOrdersInput || (settings?.whatsappOrders ?? "22870703131"),
        },
      },
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

  const handleSaveWhatsapp = () => {
    updateSettings.mutate(
      {
        data: {
          password: storedPassword,
          commissionRate: settings?.commissionRate ?? 2,
          whatsappCommission: whatsappCommissionInput || (settings?.whatsappCommission ?? "22870703131"),
          whatsappOrders: whatsappOrdersInput || (settings?.whatsappOrders ?? "22870703131"),
          whatsappAds: whatsappAdsInput || (settings?.whatsappAds ?? "22870703131"),
          whatsappServices: whatsappServicesInput || (settings?.whatsappServices ?? "22870703131"),
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetAdminSettingsQueryKey() });
          toast({ title: "Numéros WhatsApp mis à jour" });
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
                      <div className="relative">
                        <Input type={showAdminPwd ? "text" : "password"} {...field} className="pr-10" />
                        <button type="button" onClick={() => setShowAdminPwd((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                          {showAdminPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
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
            <div className="grid grid-cols-6 rounded-lg border overflow-hidden">
              <button
                onClick={() => setTab("pending")}
                className={`py-2 text-[10px] font-medium flex items-center justify-center gap-0.5 transition-colors ${
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
                className={`py-2 text-[10px] font-medium flex items-center justify-center gap-0.5 transition-colors ${
                  tab === "vendors" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"
                }`}
              >
                <Users className="w-3 h-3" />
                Vend.
              </button>
              <button
                onClick={() => { setTab("services"); refetchServices(); }}
                className={`py-2 text-[10px] font-medium flex items-center justify-center gap-0.5 transition-colors ${
                  tab === "services" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"
                }`}
              >
                <Briefcase className="w-3 h-3" />
                Serv.
              </button>
              <button
                onClick={() => { setTab("ads"); refetchAds(); }}
                className={`py-2 text-[10px] font-medium flex items-center justify-center gap-0.5 transition-colors ${
                  tab === "ads" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"
                }`}
              >
                <Megaphone className="w-3 h-3" />
                Pubs
              </button>
              <button
                onClick={() => { setTab("events"); refetchEvents(); }}
                className={`py-2 text-[10px] font-medium flex items-center justify-center gap-0.5 transition-colors ${
                  tab === "events" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"
                }`}
              >
                <Calendar className="w-3 h-3" />
                Évén.
              </button>
              <button
                onClick={() => setTab("settings")}
                className={`py-2 text-[10px] font-medium flex items-center justify-center gap-0.5 transition-colors ${
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
                        <div className="flex gap-2 overflow-x-auto pb-1">
                          {listing.images.map((img, i) => (
                            <div
                              key={i}
                              className="flex-shrink-0 rounded-md overflow-hidden border bg-black cursor-zoom-in"
                              style={{ width: 140, height: 110 }}
                              onClick={() => openViewer(listing.images!, i)}
                            >
                              <img
                                src={resolveImageUrl(img)}
                                alt={`Photo ${i + 1}`}
                                className="w-full h-full object-contain"
                              />
                            </div>
                          ))}
                        </div>
                      )}
                      
                      {confirmAction?.type === "deleteListing" && confirmAction.listingId === listing.id ? (
                        <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 space-y-2">
                          <div className="flex items-center gap-1.5">
                            <AlertTriangle className="w-3.5 h-3.5 text-red-600 flex-shrink-0" />
                            <p className="text-xs font-semibold text-red-800">Supprimer cette annonce définitivement ?</p>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="destructive"
                              className="flex-1 h-7 text-xs"
                              onClick={() => handleDelete(listing.id)}
                              disabled={deleteListing.isPending}
                            >
                              {deleteListing.isPending ? "..." : "Oui, supprimer"}
                            </Button>
                            <Button size="sm" variant="outline" className="flex-1 h-7 text-xs" onClick={() => setConfirmAction(null)}>
                              Annuler
                            </Button>
                          </div>
                        </div>
                      ) : (
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
                            onClick={() => setConfirmAction({ type: "deleteListing", listingId: listing.id })}
                          >
                            <Trash2 className="w-3.5 h-3.5 mr-1" />
                            Rejeter
                          </Button>
                        </div>
                      )}
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
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                  <Input
                    placeholder="Rechercher un vendeur..."
                    value={vendorSearch}
                    onChange={(e) => setVendorSearch(e.target.value)}
                    className="h-8 text-xs pl-8"
                  />
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
                    {vendors.filter((v) => {
                      if (!vendorSearch.trim()) return true;
                      const q = vendorSearch.toLowerCase();
                      return (
                        v.firstName.toLowerCase().includes(q) ||
                        v.lastName.toLowerCase().includes(q) ||
                        v.phone.includes(q)
                      );
                    }).map((v) => {
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
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold bg-primary/10 text-primary border border-primary/20">
                                  N°{v.id}
                                </span>
                                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${v.verified ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
                                  {v.verified ? "Vérifié" : "En attente"}
                                </span>
                                {(() => {
                                  const totalContacts = contactStats
                                    .filter((s) => s.vendorPhone === v.phone)
                                    .reduce((acc, s) => acc + s.count, 0);
                                  return totalContacts > 0 ? (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold bg-primary text-primary-foreground">
                                      {totalContacts} contact{totalContacts > 1 ? "s" : ""}
                                    </span>
                                  ) : null;
                                })()}
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
                          {/* Confirmation inline : nouveau code */}
                          {confirmAction?.type === "newCode" && confirmAction.vendorId === v.id && (
                            <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 space-y-2">
                              <div className="flex items-center gap-1.5">
                                <AlertTriangle className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" />
                                <p className="text-xs font-semibold text-amber-800">
                                  L'ancien code sera remplacé. Confirmer ?
                                </p>
                              </div>
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  className="flex-1 h-7 text-xs bg-amber-500 hover:bg-amber-600 text-white"
                                  onClick={() => handleGenerateCode(v.id)}
                                  disabled={generateCode.isPending}
                                >
                                  {generateCode.isPending ? "..." : "Oui, générer"}
                                </Button>
                                <Button size="sm" variant="outline" className="flex-1 h-7 text-xs" onClick={() => setConfirmAction(null)}>
                                  Annuler
                                </Button>
                              </div>
                            </div>
                          )}

                          {/* Confirmation inline : supprimer vendeur */}
                          {confirmAction?.type === "deleteVendor" && confirmAction.vendorId === v.id && (
                            <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 space-y-2">
                              <div className="flex items-center gap-1.5">
                                <AlertTriangle className="w-3.5 h-3.5 text-red-600 flex-shrink-0" />
                                <p className="text-xs font-semibold text-red-800">
                                  Supprimer définitivement ce compte ?
                                </p>
                              </div>
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  className="flex-1 h-7 text-xs"
                                  onClick={() => handleDeleteVendor(v.id)}
                                  disabled={deleteVendor.isPending}
                                >
                                  {deleteVendor.isPending ? "..." : "Oui, supprimer"}
                                </Button>
                                <Button size="sm" variant="outline" className="flex-1 h-7 text-xs" onClick={() => setConfirmAction(null)}>
                                  Annuler
                                </Button>
                              </div>
                            </div>
                          )}

                          {/* Confirmation inline : réinitialiser MDP */}
                          {confirmAction?.type === "resetVendorPwd" && confirmAction.vendorId === v.id && (
                            <ResetVendorPwdPanel
                              name={confirmAction.name}
                              vendorPhone={confirmAction.vendorPhone}
                              resetPwdInput={resetPwdInput}
                              setResetPwdInput={setResetPwdInput}
                              isPending={resetVendorPassword.isPending}
                              onConfirm={handleResetVendorPassword}
                              onCancel={() => { setConfirmAction(null); setResetPwdInput(""); }}
                            />
                          )}

                          {((confirmAction?.type !== "newCode" && confirmAction?.type !== "deleteVendor" && confirmAction?.type !== "resetVendorPwd") || confirmAction?.vendorId !== v.id) && (
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
                                  onClick={() => setConfirmAction({ type: "newCode", vendorId: v.id })}
                                  disabled={generateCode.isPending}
                                >
                                  <KeyRound className="w-3 h-3 mr-1" />
                                  {hasCode ? "Nouveau code" : "Générer code"}
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-blue-500 hover:text-blue-700 hover:bg-blue-50 border-blue-200"
                                onClick={() => { setResetPwdInput(""); setConfirmAction({ type: "resetVendorPwd", vendorId: v.id, vendorPhone: v.phone, name: `${v.firstName} ${v.lastName}` }); }}
                                title="Réinitialiser le mot de passe"
                              >
                                <KeyRound className="w-3 h-3" />
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-red-500 hover:text-red-700 hover:bg-red-50 border-red-200"
                                onClick={() => setConfirmAction({ type: "deleteVendor", vendorId: v.id, name: `${v.firstName} ${v.lastName}` })}
                              >
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Tab: Services emploi */}
            {tab === "services" && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">Services ({allServices.length})</p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={refetchServices} className="h-7 px-2">
                      <RefreshCw className="w-3.5 h-3.5" />
                    </Button>
                    <Button size="sm" onClick={() => setShowServiceForm(!showServiceForm)} className="h-7 px-2 gap-1">
                      <Plus className="w-3.5 h-3.5" />
                      Ajouter
                    </Button>
                  </div>
                </div>

                {showServiceForm && (
                  <div className="border rounded-lg p-3 space-y-2 bg-muted/30">
                    <p className="text-xs font-semibold">Nouvelle annonce service</p>
                    <div className="grid grid-cols-3 gap-1.5">
                      <button
                        onClick={() => setServiceForm((f) => ({ ...f, type: "offer" }))}
                        className={`py-1.5 text-xs rounded-md border font-medium transition-colors ${serviceForm.type === "offer" ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border"}`}
                      >
                        Offre emploi
                      </button>
                      <button
                        onClick={() => setServiceForm((f) => ({ ...f, type: "atelier" }))}
                        className={`py-1.5 text-xs rounded-md border font-medium transition-colors ${serviceForm.type === "atelier" ? "bg-purple-600 text-white border-purple-600" : "bg-background border-border"}`}
                      >
                        Atelier
                      </button>
                      <button
                        onClick={() => setServiceForm((f) => ({ ...f, type: "seeker" }))}
                        className={`py-1.5 text-xs rounded-md border font-medium transition-colors ${serviceForm.type === "seeker" ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border"}`}
                      >
                        Cherche emploi
                      </button>
                    </div>
                    <Input placeholder="Titre *" value={serviceForm.title} onChange={(e) => setServiceForm((f) => ({ ...f, title: e.target.value }))} className="h-8 text-xs" />
                    <textarea
                      placeholder="Description *"
                      value={serviceForm.description}
                      onChange={(e) => setServiceForm((f) => ({ ...f, description: e.target.value }))}
                      className="w-full h-20 text-xs border rounded-md px-3 py-2 bg-background resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <Input placeholder="Quartier *" value={serviceForm.quartier} onChange={(e) => setServiceForm((f) => ({ ...f, quartier: e.target.value }))} className="h-8 text-xs" />
                      <Input placeholder="Ville *" value={serviceForm.ville} onChange={(e) => setServiceForm((f) => ({ ...f, ville: e.target.value }))} className="h-8 text-xs" />
                    </div>
                    <Input placeholder="WhatsApp contact *" value={serviceForm.contact} onChange={(e) => setServiceForm((f) => ({ ...f, contact: e.target.value }))} className="h-8 text-xs" />
                    {serviceForm.type === "atelier" && (
                      <div className="space-y-1.5">
                        <p className="text-xs text-muted-foreground">Photo / Flyer (optionnel)</p>
                        <input
                          ref={serviceImageRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            const { resizeImageToBlob } = await import("@/lib/image");
                            const { uploadImageFile } = await import("@/lib/upload");
                            const { blob, dataUrl } = await resizeImageToBlob(file);
                            const objectPath = await uploadImageFile(blob, file.name);
                            setServiceForm((f) => ({ ...f, image: objectPath, imagePreview: dataUrl }));
                          }}
                        />
                        {serviceForm.imagePreview ? (
                          <div className="relative">
                            <img src={serviceForm.imagePreview} alt="aperçu" className="w-full h-28 object-cover rounded-md" />
                            <button
                              className="absolute top-1 right-1 bg-black/60 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs"
                              onClick={() => setServiceForm((f) => ({ ...f, image: "", imagePreview: "" }))}
                            >✕</button>
                          </div>
                        ) : (
                          <button
                            className="w-full h-16 border-2 border-dashed border-border rounded-md text-xs text-muted-foreground hover:bg-muted transition-colors"
                            onClick={() => serviceImageRef.current?.click()}
                          >
                            + Ajouter un flyer
                          </button>
                        )}
                      </div>
                    )}
                    <Button
                      size="sm"
                      className="w-full"
                      disabled={adminCreateService.isPending}
                      onClick={() => {
                        const { type, title, description, contact, quartier, ville, image } = serviceForm;
                        if (!title || !description || !contact || !quartier || !ville) return;
                        adminCreateService.mutate(
                          { data: { password: storedPassword, type, title, description, contact, quartier, ville, image: image || undefined } },
                          {
                            onSuccess: () => {
                              toast({ title: "Service créé" });
                              setServiceForm({ type: "offer", title: "", description: "", contact: "", quartier: "", ville: "", image: "", imagePreview: "" });
                              setShowServiceForm(false);
                              queryClient.invalidateQueries({ queryKey: getGetServicesQueryKey() });
                              refetchServices();
                            },
                          }
                        );
                      }}
                    >
                      {adminCreateService.isPending ? "Création..." : "Créer l'annonce"}
                    </Button>
                  </div>
                )}

                {servicesLoading ? (
                  <p className="text-sm text-center text-muted-foreground py-6">Chargement...</p>
                ) : allServices.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Briefcase className="w-10 h-10 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">Aucun service publié</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {allServices.map((s) => {
                      const expires = new Date(s.expiresAt);
                      const daysLeft = Math.max(0, Math.ceil((expires.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
                      return (
                        <div key={s.id} className="border rounded-lg p-3 space-y-1.5">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${s.type === "offer" ? "bg-blue-100 text-blue-700" : s.type === "atelier" ? "bg-purple-100 text-purple-700" : "bg-orange-100 text-orange-700"}`}>
                                {s.type === "offer" ? "Offre" : s.type === "atelier" ? "Atelier" : "Cherche"}
                              </span>
                              <p className="text-xs font-semibold mt-1">{s.title}</p>
                              <p className="text-xs text-muted-foreground">{s.quartier}, {s.ville}</p>
                            </div>
                            <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                              <span className="text-[10px] text-muted-foreground">{daysLeft}j restants</span>
                              {confirmDeleteServiceId === s.id ? (
                                <div className="flex gap-1">
                                  <Button size="sm" variant="destructive" className="h-6 px-1.5 text-[10px]"
                                    onClick={() => {
                                      adminDeleteService.mutate(
                                        { data: { id: s.id, password: storedPassword } },
                                        {
                                          onSuccess: () => {
                                            toast({ title: "Service supprimé" });
                                            setConfirmDeleteServiceId(null);
                                            queryClient.invalidateQueries({ queryKey: getGetServicesQueryKey() });
                                            refetchServices();
                                          },
                                        }
                                      );
                                    }}
                                  >OK</Button>
                                  <Button size="sm" variant="outline" className="h-6 px-1.5 text-[10px]" onClick={() => setConfirmDeleteServiceId(null)}>✕</Button>
                                </div>
                              ) : (
                                <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-destructive hover:bg-destructive/10" onClick={() => setConfirmDeleteServiceId(s.id)}>
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
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
                    <div className="flex flex-col gap-2">
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
                          {adForm.image ? "Image ✓" : "Photo"}
                        </Button>
                        {adForm.imagePreview && (
                          <img src={adForm.imagePreview} alt="preview" className="w-8 h-8 rounded object-cover border" />
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          ref={adVideoRef}
                          type="file"
                          accept="video/*"
                          onChange={handleAdVideoChange}
                          className="hidden"
                          disabled={adVideoUploading}
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => adVideoRef.current?.click()}
                          disabled={adVideoUploading}
                        >
                          {adVideoUploading ? "Envoi..." : adForm.videoPath ? "Vidéo ✓" : "Vidéo (optionnel)"}
                        </Button>
                        {adVideoName && !adVideoUploading && (
                          <span className="text-[10px] text-muted-foreground truncate max-w-[100px]">{adVideoName}</span>
                        )}
                        {adForm.videoPath && (
                          <button
                            type="button"
                            onClick={() => { setAdForm((f) => ({ ...f, videoPath: "" })); setAdVideoName(""); }}
                            className="text-[10px] text-red-500 underline"
                          >Retirer</button>
                        )}
                      </div>
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
                              <img src={resolveImageUrl(ad.image)} alt={ad.advertiserName} className="w-10 h-10 rounded object-cover border flex-shrink-0" />
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <p className="text-sm font-semibold truncate">{ad.advertiserName}</p>
                                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${active ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"}`}>
                                  {active ? "Actif" : "Expiré"}
                                </span>
                              </div>
                              {(() => {
                                const expanded = expandedAdIds.has(ad.id);
                                const MAX = 100;
                                const isLong = ad.message.length > MAX;
                                return (
                                  <p className="text-xs text-muted-foreground break-words">
                                    {expanded || !isLong ? ad.message : ad.message.slice(0, MAX) + "…"}
                                    {isLong && (
                                      <button
                                        onClick={() => toggleAdExpand(ad.id)}
                                        className="ml-1 text-primary font-medium hover:underline"
                                      >
                                        {expanded ? "Voir moins" : "Voir plus"}
                                      </button>
                                    )}
                                  </p>
                                );
                              })()}
                              <p className="text-[10px] text-muted-foreground">Expire le {endDate}</p>
                            </div>
                          </div>
                          {confirmAction?.type === "deleteAd" && confirmAction.adId === ad.id ? (
                            <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 space-y-2">
                              <div className="flex items-center gap-1.5">
                                <AlertTriangle className="w-3.5 h-3.5 text-red-600 flex-shrink-0" />
                                <p className="text-xs font-semibold text-red-800">Supprimer cette publicité ?</p>
                              </div>
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  className="flex-1 h-7 text-xs"
                                  onClick={() => handleDeleteAd(ad.id)}
                                  disabled={deleteAd.isPending}
                                >
                                  {deleteAd.isPending ? "..." : "Oui, supprimer"}
                                </Button>
                                <Button size="sm" variant="outline" className="flex-1 h-7 text-xs" onClick={() => setConfirmAction(null)}>
                                  Annuler
                                </Button>
                              </div>
                            </div>
                          ) : (
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
                                onClick={() => setConfirmAction({ type: "deleteAd", adId: ad.id })}
                              >
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Tab: Événements */}
            {tab === "events" && (
              <div className="space-y-3">
                <input ref={eventFlyerRef} type="file" accept="image/*" className="hidden" onChange={handleEventFlyerChange} />
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">Événements ({allEvents.length})</p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={refetchEvents} className="h-7 px-2">
                      <RefreshCw className="w-3.5 h-3.5" />
                    </Button>
                    <Button size="sm" onClick={() => setShowEventForm(!showEventForm)} className="h-7 px-2 gap-1">
                      <Plus className="w-3.5 h-3.5" />
                      Ajouter
                    </Button>
                  </div>
                </div>

                {showEventForm && (
                  <div className="border rounded-lg p-3 space-y-2 bg-muted/30">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Nouvel événement</p>
                    <Input
                      placeholder="Titre *"
                      value={eventForm.title}
                      onChange={(e) => setEventForm((f) => ({ ...f, title: e.target.value }))}
                      className="h-8 text-sm"
                    />
                    <textarea
                      placeholder="Description *"
                      value={eventForm.description}
                      onChange={(e) => setEventForm((f) => ({ ...f, description: e.target.value }))}
                      className="w-full h-20 text-sm border rounded-md px-3 py-2 bg-background resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    <Input
                      type="datetime-local"
                      value={eventForm.date}
                      onChange={(e) => setEventForm((f) => ({ ...f, date: e.target.value }))}
                      className="h-8 text-sm"
                    />
                    <Input
                      placeholder="Lieu *"
                      value={eventForm.location}
                      onChange={(e) => setEventForm((f) => ({ ...f, location: e.target.value }))}
                      className="h-8 text-sm"
                    />
                    <Input
                      placeholder="Prix du billet (ex: 1 000 FCFA, Gratuit)"
                      value={eventForm.ticketPrice}
                      onChange={(e) => setEventForm((f) => ({ ...f, ticketPrice: e.target.value }))}
                      className="h-8 text-sm"
                    />
                    <Input
                      placeholder="Lien billetterie / WhatsApp (optionnel)"
                      value={eventForm.ticketLink}
                      onChange={(e) => setEventForm((f) => ({ ...f, ticketLink: e.target.value }))}
                      className="h-8 text-sm"
                    />
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => eventFlyerRef.current?.click()}
                      >
                        {eventForm.flyerImage ? "Flyer ✓" : "Flyer (photo)"}
                      </Button>
                      {eventForm.flyerPreview && (
                        <img src={eventForm.flyerPreview} alt="flyer" className="w-10 h-10 rounded object-cover border" />
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" className="flex-1 h-7" onClick={handleCreateEvent} disabled={createEvent.isPending}>
                        {createEvent.isPending ? "Création..." : "Créer"}
                      </Button>
                      <Button size="sm" variant="outline" className="flex-1 h-7" onClick={() => setShowEventForm(false)}>
                        Annuler
                      </Button>
                    </div>
                  </div>
                )}

                {eventsLoading ? (
                  <p className="text-sm text-center text-muted-foreground py-6">Chargement...</p>
                ) : allEvents.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Calendar className="w-10 h-10 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">Aucun événement</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {allEvents.map((event) => {
                      const eventDate = new Date(event.date);
                      const isPast = eventDate < new Date();
                      return (
                        <div key={event.id} className={`border rounded-lg p-3 space-y-1.5 ${isPast ? "opacity-60 bg-muted/30" : ""}`}>
                          <div className="flex items-start gap-2">
                            {event.flyerImage && (
                              <img src={resolveImageUrl(event.flyerImage)} alt={event.title} className="w-12 h-12 rounded object-cover border flex-shrink-0" />
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <p className="text-sm font-semibold truncate">{event.title}</p>
                                {isPast && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-bold flex-shrink-0">Passé</span>}
                              </div>
                              <p className="text-xs text-muted-foreground">
                                {eventDate.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })} · {event.location}
                              </p>
                              {event.ticketPrice && <p className="text-xs text-muted-foreground">Billet : {event.ticketPrice}</p>}
                            </div>
                          </div>
                          {confirmAction?.type === "deleteEvent" && confirmAction.eventId === event.id ? (
                            <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 space-y-2">
                              <div className="flex items-center gap-1.5">
                                <AlertTriangle className="w-3.5 h-3.5 text-red-600 flex-shrink-0" />
                                <p className="text-xs font-semibold text-red-800">Supprimer cet événement ?</p>
                              </div>
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  className="flex-1 h-7 text-xs"
                                  onClick={() => handleDeleteEvent(event.id)}
                                  disabled={deleteEvent.isPending}
                                >
                                  {deleteEvent.isPending ? "..." : "Oui, supprimer"}
                                </Button>
                                <Button size="sm" variant="outline" className="flex-1 h-7 text-xs" onClick={() => setConfirmAction(null)}>
                                  Annuler
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs text-red-500 border-red-200 hover:bg-red-50 gap-1"
                              onClick={() => setConfirmAction({ type: "deleteEvent", eventId: event.id })}
                            >
                              <Trash2 className="w-3 h-3" />
                              Supprimer
                            </Button>
                          )}
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

                <div>
                  <p className="text-sm font-semibold mb-1">Numéros WhatsApp</p>
                  <p className="text-xs text-muted-foreground mb-3">
                    Deux numéros distincts pour recevoir les demandes de commission et les commandes d'articles.
                  </p>
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1 block">
                        Déblocage contact / Commission
                      </label>
                      <Input
                        placeholder={settings?.whatsappCommission ?? "22870703131"}
                        value={whatsappCommissionInput}
                        onChange={(e) => setWhatsappCommissionInput(e.target.value.replace(/\D/g, ""))}
                        className="h-9 text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1 block">
                        Commandes d'articles introuvables
                      </label>
                      <Input
                        placeholder={settings?.whatsappOrders ?? "22870703131"}
                        value={whatsappOrdersInput}
                        onChange={(e) => setWhatsappOrdersInput(e.target.value.replace(/\D/g, ""))}
                        className="h-9 text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1 block">
                        Publicités &amp; Événements (soumissions)
                      </label>
                      <Input
                        placeholder={settings?.whatsappAds ?? "22870703131"}
                        value={whatsappAdsInput}
                        onChange={(e) => setWhatsappAdsInput(e.target.value.replace(/\D/g, ""))}
                        className="h-9 text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1 block">
                        Services Emploi (soumissions)
                      </label>
                      <Input
                        placeholder={settings?.whatsappServices ?? "22870703131"}
                        value={whatsappServicesInput}
                        onChange={(e) => setWhatsappServicesInput(e.target.value.replace(/\D/g, ""))}
                        className="h-9 text-sm"
                      />
                    </div>
                    <Button
                      size="sm"
                      className="w-full"
                      onClick={handleSaveWhatsapp}
                      disabled={updateSettings.isPending}
                    >
                      Enregistrer les numéros
                    </Button>
                  </div>
                </div>

                <div>
                  <p className="text-sm font-semibold mb-1">Code sous-admin (Pub & Événements)</p>
                  <p className="text-xs text-muted-foreground mb-3">
                    Code d'accès pour le sous-admin Publicités et Événements (défaut : 0101).
                  </p>
                  <div className="flex gap-2">
                    <Input
                      placeholder="Nouveau code (ex: 0101)"
                      value={subAdminPwdInput}
                      onChange={(e) => setSubAdminPwdInput(e.target.value)}
                      className="h-9 text-sm"
                    />
                    <Button
                      size="sm"
                      className="h-9 px-3"
                      onClick={() => {
                        if (!subAdminPwdInput.trim()) return;
                        updateSettings.mutate(
                          {
                            data: {
                              password: storedPassword,
                              commissionRate: settings?.commissionRate ?? 2,
                              whatsappCommission: settings?.whatsappCommission ?? "22870703131",
                              whatsappOrders: settings?.whatsappOrders ?? "22870703131",
                              subAdminPassword: subAdminPwdInput.trim(),
                            },
                          },
                          {
                            onSuccess: () => {
                              toast({ title: "Code sous-admin enregistré" });
                              setSubAdminPwdInput("");
                            },
                          }
                        );
                      }}
                      disabled={updateSettings.isPending || !subAdminPwdInput.trim()}
                    >
                      {updateSettings.isPending ? "..." : "OK"}
                    </Button>
                  </div>
                </div>

                <StorageCleanupSection password={storedPassword} />
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
