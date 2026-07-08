import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
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
  useAdminCreateEvent,
  useAdminDeleteEvent,
  useGetEvents,
  useGetAdminContactStats,
  useAdminCreateService,
  useAdminGetAllServices,
  useAdminDeleteService,
  useAdminStorageCleanup,
  getGetListingsQueryKey,
  getGetEventsQueryKey,
  getGetServicesQueryKey,
  getGetAdminSettingsQueryKey,
  type Ad,
  type VendorProfile,
  type Event as ApiEvent,
  type Service,
  type AdminContactStat,
} from "@workspace/api-client-react";
import { loadAdminSession, clearAdminSession } from "./admin-login";
import { resolveImageUrl, resizeImageToBlob } from "@/lib/image";
import { uploadImageFile, uploadVideoFile } from "@/lib/upload";
import { openWhatsApp } from "@/lib/whatsapp";
import { ImageViewer } from "@/components/image-viewer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  LayoutDashboard,
  Clock,
  Users,
  Megaphone,
  Calendar,
  Briefcase,
  Settings,
  LogOut,
  CheckCircle,
  Trash2,
  KeyRound,
  Plus,
  RefreshCw,
  Eye,
  EyeOff,
  Shield,
  ShieldAlert,
  Search,
  ChevronDown,
  ChevronUp,
  Phone,
  X,
} from "lucide-react";

type DashTab =
  | "stats"
  | "pending"
  | "vendors"
  | "ads"
  | "events"
  | "services"
  | "settings"
  | "accounts";

interface AdminAccount {
  id: number;
  username: string;
  role: string;
  createdAt: string;
}

interface AdminStats {
  vendors: { total: number; paid: number; admin: number; legacy: number };
  ads: { total: number; paid: number; admin: number };
  events: { total: number; paid: number; admin: number };
  services: { total: number; paid: number; admin: number };
  expiringSoon: Array<{ id: number; firstName: string; lastName: string; phone: string; expiryDate: string | null }>;
}

function StatCard({ label, value, sub, color }: { label: string; value: number; sub?: string; color?: string }) {
  return (
    <div className="bg-card border rounded-xl p-4 space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-2xl font-bold ${color ?? "text-foreground"}`}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

export default function AdminDashboard() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const session = loadAdminSession();
  const isSuperAdmin = session?.role === "superadmin";

  useEffect(() => {
    if (!session) {
      navigate("/admin-login");
    }
  }, []);

  if (!session) return null;

  const password = session.code;

  const [tab, setTab] = useState<DashTab>("stats");
  const [vendorSearch, setVendorSearch] = useState("");
  const [viewerImages, setViewerImages] = useState<string[]>([]);
  const [viewerIndex, setViewerIndex] = useState(0);

  const [stats, setStats] = useState<AdminStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  const [pendingListings, setPendingListings] = useState<NonNullable<ReturnType<typeof useAdminGetPendingListings>["data"]>>([]);
  const [pendingLoading, setPendingLoading] = useState(false);

  const [vendors, setVendors] = useState<VendorProfile[]>([]);
  const [vendorsLoading, setVendorsLoading] = useState(false);
  const [contactStats, setContactStats] = useState<AdminContactStat[]>([]);

  const [allAds, setAllAds] = useState<Ad[]>([]);
  const [adsLoading, setAdsLoading] = useState(false);
  const [showAdForm, setShowAdForm] = useState(false);
  const [adForm, setAdForm] = useState({ advertiserName: "", advertiserPhone: "", message: "", image: "", imagePreview: "", videoPath: "" });
  const adImageRef = useRef<HTMLInputElement>(null);

  const [allEvents, setAllEvents] = useState<ApiEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [showEventForm, setShowEventForm] = useState(false);
  const [eventForm, setEventForm] = useState({ title: "", description: "", date: "", location: "", ticketPrice: "", ticketLink: "", flyerImage: "", flyerPreview: "" });
  const eventFlyerRef = useRef<HTMLInputElement>(null);

  const [allServices, setAllServices] = useState<Service[]>([]);
  const [servicesLoading, setServicesLoading] = useState(false);
  const [showServiceForm, setShowServiceForm] = useState(false);
  const [serviceForm, setServiceForm] = useState({ type: "offer" as "offer" | "seeker" | "atelier", title: "", description: "", contact: "", quartier: "", ville: "", image: "", imagePreview: "" });
  const serviceImageRef = useRef<HTMLInputElement>(null);

  const [generatedCode, setGeneratedCode] = useState<{ code: string; phone: string } | null>(null);
  const [expandedVendorId, setExpandedVendorId] = useState<number | null>(null);
  const [resetPwdVendor, setResetPwdVendor] = useState<{ id: number; phone: string; name: string } | null>(null);
  const [resetPwdInput, setResetPwdInput] = useState("");

  const [accounts, setAccounts] = useState<AdminAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [showNewAccountForm, setShowNewAccountForm] = useState(false);
  const [newAccount, setNewAccount] = useState({ username: "", role: "admin_pub", code: "" });

  const [settingsForm, setSettingsForm] = useState({
    whatsappCommission: "",
    whatsappOrders: "",
    whatsappAds: "",
    whatsappServices: "",
    commissionRate: "5",
    subAdminPwd: "",
  });

  const pendingMutation = useAdminGetPendingListings();
  const approveListing = useAdminApproveListing();
  const deleteListing = useAdminDeleteListing();
  const getVendors = useAdminGetVendors();
  const activateVendor = useAdminActivateVendor();
  const generateCode = useAdminGenerateVendorCode();
  const deleteVendor = useAdminDeleteVendor();
  const resetVendorPassword = useAdminResetVendorPassword();
  const createAd = useAdminCreateAd();
  const getAllAds = useAdminGetAllAds();
  const deleteAd = useAdminDeleteAd();
  const createEvent = useAdminCreateEvent();
  const deleteEvent = useAdminDeleteEvent();
  const getEventsQuery = useGetEvents();
  const getContactStats = useGetAdminContactStats();
  const createService = useAdminCreateService();
  const getAllServicesQuery = useAdminGetAllServices();
  const deleteService = useAdminDeleteService();
  const storageCleanup = useAdminStorageCleanup();
  const updateSettings = useUpdateAdminSettings();
  const { data: settingsData, refetch: refetchSettings } = useGetAdminSettings();

  useEffect(() => {
    if (settingsData) {
      setSettingsForm((f) => ({
        ...f,
        whatsappCommission: settingsData.whatsappCommission ?? "",
        whatsappOrders: settingsData.whatsappOrders ?? "",
        whatsappAds: settingsData.whatsappAds ?? "",
        whatsappServices: settingsData.whatsappServices ?? "",
        commissionRate: String(settingsData.commissionRate ?? 5),
      }));
    }
  }, [settingsData]);

  const loadStats = () => {
    setStatsLoading(true);
    fetch("/api/admin/stats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: password }),
    })
      .then((r) => r.json())
      .then((d) => { setStats(d); setStatsLoading(false); })
      .catch(() => setStatsLoading(false));
  };

  const loadPending = () => {
    setPendingLoading(true);
    pendingMutation.mutate(
      { data: { password } },
      {
        onSuccess: (d) => { setPendingListings(d); setPendingLoading(false); },
        onError: () => setPendingLoading(false),
      }
    );
  };

  const loadVendors = () => {
    setVendorsLoading(true);
    getVendors.mutate(
      { data: { password } },
      {
        onSuccess: (d) => { setVendors(d); setVendorsLoading(false); },
        onError: () => setVendorsLoading(false),
      }
    );
    getContactStats.mutate(
      { data: { password } },
      { onSuccess: (d) => setContactStats(d) }
    );
  };

  const loadAds = () => {
    setAdsLoading(true);
    getAllAds.mutate(
      { data: { password } },
      {
        onSuccess: (d) => { setAllAds(d); setAdsLoading(false); },
        onError: () => setAdsLoading(false),
      }
    );
  };

  const loadEvents = () => {
    setEventsLoading(true);
    getEventsQuery.refetch().then((r) => {
      setAllEvents(r.data ?? []);
      setEventsLoading(false);
    }).catch(() => setEventsLoading(false));
  };

  const loadServices = () => {
    setServicesLoading(true);
    getAllServicesQuery.mutate(
      { data: { password } },
      {
        onSuccess: (d) => { setAllServices(d); setServicesLoading(false); },
        onError: () => setServicesLoading(false),
      }
    );
  };

  const loadAccounts = () => {
    setAccountsLoading(true);
    fetch("/api/admin/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: password }),
    })
      .then((r) => r.json())
      .then((d) => { setAccounts(Array.isArray(d) ? d : []); setAccountsLoading(false); })
      .catch(() => setAccountsLoading(false));
  };

  useEffect(() => {
    loadStats();
    loadPending();
  }, []);

  const handleTabChange = (t: DashTab) => {
    setTab(t);
    if (t === "stats") loadStats();
    if (t === "pending") loadPending();
    if (t === "vendors") loadVendors();
    if (t === "ads") loadAds();
    if (t === "events") loadEvents();
    if (t === "services") loadServices();
    if (t === "accounts") loadAccounts();
  };

  const handleApprove = (id: number) => {
    approveListing.mutate(
      { data: { password, id } },
      {
        onSuccess: () => {
          toast({ title: "Annonce approuvée !" });
          queryClient.invalidateQueries({ queryKey: getGetListingsQueryKey() });
          loadPending();
        },
        onError: () => toast({ title: "Erreur", variant: "destructive" }),
      }
    );
  };

  const handleDeleteListing = (id: number) => {
    deleteListing.mutate(
      { data: { password, id } },
      {
        onSuccess: () => {
          toast({ title: "Annonce supprimée" });
          queryClient.invalidateQueries({ queryKey: getGetListingsQueryKey() });
          loadPending();
        },
        onError: () => toast({ title: "Erreur", variant: "destructive" }),
      }
    );
  };

  const handleActivateVendor = (vendorId: number) => {
    activateVendor.mutate(
      { data: { password, vendorId } },
      {
        onSuccess: (res) => {
          setGeneratedCode({ code: res.code, phone: res.vendorPhone });
          loadVendors();
        },
        onError: () => toast({ title: "Erreur lors de l'activation", variant: "destructive" }),
      }
    );
  };

  const handleGenerateCode = (vendorId: number) => {
    generateCode.mutate(
      { data: { password, vendorId } },
      {
        onSuccess: (res) => {
          setGeneratedCode({ code: res.code, phone: res.vendorPhone });
          loadVendors();
        },
        onError: () => toast({ title: "Erreur", variant: "destructive" }),
      }
    );
  };

  const handleDeleteVendor = (vendorId: number) => {
    deleteVendor.mutate(
      { data: { password, vendorId } },
      {
        onSuccess: () => {
          toast({ title: "Vendeur supprimé" });
          loadVendors();
        },
        onError: () => toast({ title: "Erreur", variant: "destructive" }),
      }
    );
  };

  const handleResetPassword = (vendorPhone: string, newPassword: string) => {
    if (newPassword.length < 6) { toast({ title: "Minimum 6 caractères", variant: "destructive" }); return; }
    resetVendorPassword.mutate(
      { data: { password, vendorPhone, newPassword } },
      {
        onSuccess: () => {
          toast({ title: "Mot de passe réinitialisé" });
          setResetPwdVendor(null);
          setResetPwdInput("");
        },
        onError: () => toast({ title: "Erreur", variant: "destructive" }),
      }
    );
  };

  const handleForcePublishVendor = (vendorId: number) => {
    fetch("/api/admin/vendors/force-publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: password, vendorId }),
    })
      .then((r) => r.json())
      .then(() => { toast({ title: "Boutique réactivée 30 jours" }); loadVendors(); })
      .catch(() => toast({ title: "Erreur", variant: "destructive" }));
  };

  const handleSendCodeWhatsApp = (code: string, phone: string) => {
    const msg = `Bonjour ! Votre code de publication TogoMarket est : ${code}\nIl est valable 30 jours. Bonne vente !`;
    openWhatsApp(`https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(msg)}`);
  };

  const handleAdImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    try {
      const { blob, dataUrl } = await resizeImageToBlob(file);
      const objectPath = await uploadImageFile(blob, file.name);
      setAdForm((f) => ({ ...f, image: objectPath, imagePreview: dataUrl }));
    } catch {
      toast({ title: "Erreur image", variant: "destructive" });
    }
  };

  const handleCreateAd = () => {
    if (!adForm.advertiserName.trim() || !adForm.advertiserPhone.trim() || !adForm.message.trim()) {
      toast({ title: "Champs requis manquants", variant: "destructive" });
      return;
    }
    createAd.mutate(
      { data: { password, ...adForm } },
      {
        onSuccess: () => {
          toast({ title: "Publicité créée !" });
          setAdForm({ advertiserName: "", advertiserPhone: "", message: "", image: "", imagePreview: "", videoPath: "" });
          setShowAdForm(false);
          loadAds();
        },
        onError: () => toast({ title: "Erreur", variant: "destructive" }),
      }
    );
  };

  const handleDeleteAd = (id: number) => {
    deleteAd.mutate(
      { data: { id, password } },
      {
        onSuccess: () => { toast({ title: "Publicité supprimée" }); loadAds(); },
        onError: () => toast({ title: "Erreur", variant: "destructive" }),
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

  const handleCreateEvent = () => {
    if (!eventForm.title || !eventForm.description || !eventForm.date || !eventForm.location) {
      toast({ title: "Titre, description, date et lieu sont requis", variant: "destructive" });
      return;
    }
    createEvent.mutate(
      {
        data: {
          password,
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
          loadEvents();
        },
        onError: () => toast({ title: "Erreur", variant: "destructive" }),
      }
    );
  };

  const handleDeleteEvent = (id: number) => {
    deleteEvent.mutate(
      { data: { password, id } },
      {
        onSuccess: () => {
          toast({ title: "Événement supprimé" });
          queryClient.invalidateQueries({ queryKey: getGetEventsQueryKey() });
          loadEvents();
        },
        onError: () => toast({ title: "Erreur", variant: "destructive" }),
      }
    );
  };

  const handleServiceImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    try {
      const { blob, dataUrl } = await resizeImageToBlob(file);
      const objectPath = await uploadImageFile(blob, file.name);
      setServiceForm((f) => ({ ...f, image: objectPath, imagePreview: dataUrl }));
    } catch {
      toast({ title: "Erreur image", variant: "destructive" });
    }
  };

  const handleCreateService = () => {
    if (!serviceForm.title || !serviceForm.description || !serviceForm.contact) {
      toast({ title: "Titre, description et contact requis", variant: "destructive" });
      return;
    }
    createService.mutate(
      {
        data: {
          password,
          type: serviceForm.type,
          title: serviceForm.title,
          description: serviceForm.description,
          contact: serviceForm.contact,
          quartier: serviceForm.quartier,
          ville: serviceForm.ville,
          image: serviceForm.image || undefined,
        }
      },
      {
        onSuccess: () => {
          toast({ title: "Service créé !" });
          setShowServiceForm(false);
          setServiceForm({ type: "offer", title: "", description: "", contact: "", quartier: "", ville: "", image: "", imagePreview: "" });
          queryClient.invalidateQueries({ queryKey: getGetServicesQueryKey() });
          loadServices();
        },
        onError: () => toast({ title: "Erreur", variant: "destructive" }),
      }
    );
  };

  const handleDeleteService = (id: number) => {
    deleteService.mutate(
      { data: { id, password } },
      {
        onSuccess: () => {
          toast({ title: "Service supprimé" });
          queryClient.invalidateQueries({ queryKey: getGetServicesQueryKey() });
          loadServices();
        },
        onError: () => toast({ title: "Erreur", variant: "destructive" }),
      }
    );
  };

  const handleSaveSettings = () => {
    updateSettings.mutate(
      {
        data: {
          password,
          commissionRate: parseFloat(settingsForm.commissionRate),
          whatsappCommission: settingsForm.whatsappCommission,
          whatsappOrders: settingsForm.whatsappOrders,
          whatsappAds: settingsForm.whatsappAds || undefined,
          whatsappServices: settingsForm.whatsappServices || undefined,
          subAdminPassword: settingsForm.subAdminPwd || undefined,
        }
      },
      {
        onSuccess: () => {
          toast({ title: "Paramètres sauvegardés !" });
          refetchSettings();
          queryClient.invalidateQueries({ queryKey: getGetAdminSettingsQueryKey() });
        },
        onError: () => toast({ title: "Erreur lors de la sauvegarde", variant: "destructive" }),
      }
    );
  };

  const handleCreateAccount = async () => {
    if (!newAccount.username.trim() || !newAccount.code.trim()) {
      toast({ title: "Nom et code requis", variant: "destructive" });
      return;
    }
    try {
      const res = await fetch("/api/admin/accounts/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: password, username: newAccount.username, role: newAccount.role, newCode: newAccount.code }),
      });
      if (!res.ok) throw new Error();
      toast({ title: "Compte créé !" });
      setNewAccount({ username: "", role: "admin_pub", code: "" });
      setShowNewAccountForm(false);
      loadAccounts();
    } catch {
      toast({ title: "Erreur lors de la création", variant: "destructive" });
    }
  };

  const handleDeleteAccount = async (accountId: number) => {
    try {
      const res = await fetch("/api/admin/accounts/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: password, accountId }),
      });
      if (!res.ok) throw new Error();
      toast({ title: "Compte supprimé" });
      loadAccounts();
    } catch {
      toast({ title: "Erreur", variant: "destructive" });
    }
  };

  const handleLogout = () => {
    clearAdminSession();
    navigate("/");
  };

  const filteredVendors = vendors.filter((v) => {
    if (!vendorSearch.trim()) return true;
    const q = vendorSearch.toLowerCase();
    return (
      v.firstName.toLowerCase().includes(q) ||
      v.lastName.toLowerCase().includes(q) ||
      v.phone.includes(q) ||
      String(v.id).includes(q)
    );
  });

  const tabs: Array<{ key: DashTab; label: string; icon: React.ReactNode; superOnly?: boolean }> = [
    { key: "stats", label: "Statistiques", icon: <LayoutDashboard className="w-4 h-4" /> },
    { key: "pending", label: "En attente", icon: <Clock className="w-4 h-4" /> },
    { key: "vendors", label: "Vendeurs", icon: <Users className="w-4 h-4" /> },
    { key: "ads", label: "Publicités", icon: <Megaphone className="w-4 h-4" /> },
    { key: "events", label: "Événements", icon: <Calendar className="w-4 h-4" /> },
    { key: "services", label: "Services", icon: <Briefcase className="w-4 h-4" /> },
    { key: "settings", label: "Paramètres", icon: <Settings className="w-4 h-4" /> },
    { key: "accounts", label: "Comptes", icon: <Shield className="w-4 h-4" />, superOnly: true },
  ];

  const visibleTabs = tabs.filter((t) => !t.superOnly || isSuperAdmin);

  return (
    <div className="min-h-[100dvh] flex flex-col bg-muted/30">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background border-b shadow-sm">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Shield className="w-4 h-4 text-primary" />
            </div>
            <div>
              <p className="font-bold text-sm leading-none">Administration</p>
              <p className="text-xs text-muted-foreground leading-none mt-0.5">
                {session.role === "superadmin" ? "Superadmin" : "Admin"} — {session.code.length > 3 ? "●".repeat(session.code.length) : "●●●●"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate("/")} className="text-xs h-8">
              Marketplace
            </Button>
            <Button variant="ghost" size="sm" onClick={handleLogout} className="text-xs h-8 text-destructive hover:text-destructive">
              <LogOut className="w-3.5 h-3.5 mr-1.5" />
              Déconnexion
            </Button>
          </div>
        </div>
        {/* Tabs */}
        <div className="max-w-7xl mx-auto px-4 overflow-x-auto">
          <div className="flex gap-0.5 pb-0 min-w-max">
            {visibleTabs.map((t) => (
              <button
                key={t.key}
                onClick={() => handleTabChange(t.key)}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
                  tab === t.key
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.icon}
                {t.label}
                {t.key === "pending" && pendingListings.length > 0 && (
                  <span className="ml-1 bg-destructive text-destructive-foreground text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none">
                    {pendingListings.length}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-6 space-y-6">

        {/* ── STATISTIQUES ─────────────────────────────────────── */}
        {tab === "stats" && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">Vue d'ensemble</h2>
              <Button variant="outline" size="sm" onClick={loadStats} disabled={statsLoading}>
                <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${statsLoading ? "animate-spin" : ""}`} />
                Actualiser
              </Button>
            </div>
            {stats ? (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <StatCard label="Vendeurs" value={stats.vendors.total} sub={`${stats.vendors.paid} payants`} color="text-primary" />
                  <StatCard label="Via FedaPay" value={stats.vendors.paid} sub="paiement en ligne" />
                  <StatCard label="Validés admin" value={stats.vendors.admin} sub="par l'admin" />
                  <StatCard label="Hérités" value={stats.vendors.legacy} sub="anciens comptes" />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <StatCard label="Publicités" value={stats.ads.total} />
                  <StatCard label="Événements" value={stats.events.total} />
                  <StatCard label="Services" value={stats.services.total} />
                </div>
                {stats.expiringSoon.length > 0 && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                    <h3 className="text-sm font-semibold text-amber-800 mb-3 flex items-center gap-2">
                      <ShieldAlert className="w-4 h-4" />
                      {stats.expiringSoon.length} boutique(s) expirent dans 3 jours
                    </h3>
                    <div className="space-y-2">
                      {stats.expiringSoon.map((v) => (
                        <div key={v.id} className="flex items-center justify-between text-sm bg-white rounded-lg px-3 py-2 border border-amber-100">
                          <span className="font-medium">{v.firstName} {v.lastName}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">{v.phone}</span>
                            <button
                              onClick={() => openWhatsApp(`https://wa.me/${v.phone.replace(/\D/g, "")}?text=${encodeURIComponent(`Bonjour ${v.firstName}, votre abonnement TogoMarket expire bientôt. Renouvelez pour 1 000 FCFA.`)}`)}
                              className="text-xs bg-green-500 text-white rounded-full px-2 py-0.5 hover:bg-green-600"
                            >
                              WhatsApp
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="bg-card border rounded-xl p-4">
                  <h3 className="text-sm font-semibold mb-3">Nettoyage du stockage</h3>
                  <p className="text-xs text-muted-foreground mb-3">Supprime les fichiers images orphelins non liés à une annonce.</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive border-destructive/30 hover:bg-destructive/10"
                    onClick={() => {
                      storageCleanup.mutate(
                        { data: { password } },
                        {
                          onSuccess: (r) => toast({ title: "Nettoyage terminé", description: `${r.deleted} fichier(s) supprimé(s).` }),
                          onError: () => toast({ title: "Erreur lors du nettoyage", variant: "destructive" }),
                        }
                      );
                    }}
                    disabled={storageCleanup.isPending}
                  >
                    <RefreshCw className={`w-3.5 h-3.5 mr-2 ${storageCleanup.isPending ? "animate-spin" : ""}`} />
                    {storageCleanup.isPending ? "Nettoyage en cours…" : "Nettoyer les orphelins"}
                  </Button>
                </div>
              </>
            ) : statsLoading ? (
              <div className="flex items-center justify-center py-20">
                <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <p className="text-center text-muted-foreground py-10">Cliquez sur Actualiser pour charger les stats.</p>
            )}
          </div>
        )}

        {/* ── ANNONCES EN ATTENTE ───────────────────────────────── */}
        {tab === "pending" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">Annonces en attente ({pendingListings.length})</h2>
              <Button variant="outline" size="sm" onClick={loadPending} disabled={pendingLoading}>
                <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${pendingLoading ? "animate-spin" : ""}`} />
                Actualiser
              </Button>
            </div>
            {pendingLoading ? (
              <div className="flex justify-center py-16"><RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" /></div>
            ) : pendingListings.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <CheckCircle className="w-12 h-12 mx-auto mb-3 text-green-500 opacity-50" />
                <p className="font-medium">Aucune annonce en attente</p>
              </div>
            ) : (
              <div className="space-y-3">
                {pendingListings.map((listing) => (
                  <div key={listing.id} className="bg-card border rounded-xl p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold truncate">{listing.name}</p>
                        <p className="text-sm text-muted-foreground">{listing.price.toLocaleString("fr-FR")} FCFA · {listing.sector} · {listing.location}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          <Phone className="w-3 h-3 inline mr-1" />
                          {listing.phone}
                        </p>
                      </div>
                      <div className="flex gap-2 flex-shrink-0">
                        <Button size="sm" className="h-8 bg-green-600 hover:bg-green-700" onClick={() => handleApprove(listing.id)}>
                          <CheckCircle className="w-3.5 h-3.5 mr-1" />
                          Approuver
                        </Button>
                        <Button size="sm" variant="destructive" className="h-8" onClick={() => handleDeleteListing(listing.id)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                    {listing.images && listing.images.length > 0 && (
                      <div className="flex gap-2 overflow-x-auto">
                        {listing.images.map((img, i) => (
                          <img
                            key={i}
                            src={resolveImageUrl(img)}
                            alt=""
                            className="h-20 w-20 object-cover rounded-lg flex-shrink-0 cursor-pointer"
                            onClick={() => { setViewerImages(listing.images.map(resolveImageUrl)); setViewerIndex(i); }}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── VENDEURS ─────────────────────────────────────────── */}
        {tab === "vendors" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-bold">Vendeurs ({vendors.length})</h2>
              <Button variant="outline" size="sm" onClick={loadVendors} disabled={vendorsLoading}>
                <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${vendorsLoading ? "animate-spin" : ""}`} />
                Actualiser
              </Button>
            </div>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Rechercher par nom, téléphone ou n° boutique…"
                value={vendorSearch}
                onChange={(e) => setVendorSearch(e.target.value)}
              />
            </div>
            {generatedCode && (
              <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-green-800">Code généré</p>
                  <p className="text-2xl font-mono font-bold text-green-700 mt-1">{generatedCode.code}</p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={() => handleSendCodeWhatsApp(generatedCode.code, generatedCode.phone)}>
                    Envoyer WhatsApp
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setGeneratedCode(null)}>
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}
            {vendorsLoading ? (
              <div className="flex justify-center py-16"><RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" /></div>
            ) : filteredVendors.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>Aucun vendeur trouvé</p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredVendors.map((v) => {
                  const stat = contactStats.find((s) => s.vendorPhone === v.phone);
                  const isExpanded = expandedVendorId === v.id;
                  const daysLeft = v.daysUntilExpiry ?? null;
                  const expired = daysLeft !== null && daysLeft <= 0;
                  const expiringSoon = daysLeft !== null && daysLeft > 0 && daysLeft <= 3;

                  return (
                    <div key={v.id} className={`bg-card border rounded-xl overflow-hidden ${expired ? "border-red-200 bg-red-50/30" : expiringSoon ? "border-amber-200 bg-amber-50/30" : ""}`}>
                      <button
                        className="w-full flex items-center justify-between gap-3 p-3 hover:bg-muted/30 transition-colors text-left"
                        onClick={() => setExpandedVendorId(isExpanded ? null : v.id)}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 text-primary font-bold text-sm">
                            {v.firstName.charAt(0)}{v.lastName.charAt(0)}
                          </div>
                          <div className="min-w-0">
                            <p className="font-semibold text-sm">
                              {v.firstName} {v.lastName}
                              <span className="text-muted-foreground font-normal text-xs ml-2">N°{v.id}</span>
                            </p>
                            <p className="text-xs text-muted-foreground">{v.phone}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {expired && <span className="text-xs bg-red-100 text-red-700 rounded-full px-2 py-0.5 font-medium">Expiré</span>}
                          {expiringSoon && <span className="text-xs bg-amber-100 text-amber-700 rounded-full px-2 py-0.5 font-medium">{daysLeft}j</span>}
                          {!expired && !expiringSoon && daysLeft !== null && (
                            <span className="text-xs bg-green-100 text-green-700 rounded-full px-2 py-0.5 font-medium">{daysLeft}j</span>
                          )}
                          <span className={`text-xs rounded-full px-2 py-0.5 font-medium ${v.isPublished ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                            {v.isPublished ? "Actif" : "Inactif"}
                          </span>
                          {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="border-t px-3 pb-3 pt-3 space-y-3">
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div><span className="text-muted-foreground">Statut paiement : </span><span className="font-medium">{v.paymentStatus ?? "—"}</span></div>
                            <div><span className="text-muted-foreground">Validation : </span><span className="font-medium">{v.validationMethod ?? "—"}</span></div>
                            <div><span className="text-muted-foreground">Expiration : </span><span className="font-medium">{v.expiryDate ? new Date(v.expiryDate).toLocaleDateString("fr-FR") : "—"}</span></div>
                            <div><span className="text-muted-foreground">Contacts débloqués : </span><span className="font-medium">{stat?.count ?? 0}</span></div>
                            {v.publishCode && (
                              <div className="col-span-2">
                                <span className="text-muted-foreground">Code de publication : </span>
                                <span className="font-mono font-bold text-primary">{v.publishCode.code}</span>
                              </div>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {!v.verified && (
                              <Button size="sm" className="h-7 text-xs bg-primary hover:bg-primary/90" onClick={() => handleActivateVendor(v.id)}>
                                <CheckCircle className="w-3 h-3 mr-1" />
                                Activer
                              </Button>
                            )}
                            {v.verified && (
                              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => handleGenerateCode(v.id)}>
                                <KeyRound className="w-3 h-3 mr-1" />
                                Nouveau code
                              </Button>
                            )}
                            {isSuperAdmin && (
                              <Button size="sm" variant="outline" className="h-7 text-xs border-blue-300 text-blue-700 hover:bg-blue-50" onClick={() => handleForcePublishVendor(v.id)}>
                                <RefreshCw className="w-3 h-3 mr-1" />
                                +30 jours
                              </Button>
                            )}
                            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => {
                              setResetPwdVendor({ id: v.id, phone: v.phone, name: `${v.firstName} ${v.lastName}` });
                              setResetPwdInput("");
                            }}>
                              <KeyRound className="w-3 h-3 mr-1" />
                              Réinit. mot de passe
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              onClick={() => openWhatsApp(`https://wa.me/${v.phone.replace(/\D/g, "")}?text=${encodeURIComponent(`Bonjour ${v.firstName} !`)}`)}
                            >
                              WhatsApp
                            </Button>
                            {isSuperAdmin && (
                              <Button
                                size="sm"
                                variant="destructive"
                                className="h-7 text-xs"
                                onClick={() => { if (confirm(`Supprimer définitivement ${v.firstName} ${v.lastName} ?`)) handleDeleteVendor(v.id); }}
                              >
                                <Trash2 className="w-3 h-3 mr-1" />
                                Supprimer
                              </Button>
                            )}
                          </div>
                          {resetPwdVendor?.id === v.id && (
                            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 space-y-2">
                              <p className="text-xs font-semibold text-blue-800">Nouveau mot de passe pour {resetPwdVendor.name}</p>
                              <Input
                                className="h-8 text-sm"
                                placeholder="Min. 6 caractères"
                                value={resetPwdInput}
                                onChange={(e) => setResetPwdInput(e.target.value)}
                              />
                              <div className="flex gap-2">
                                <Button size="sm" className="flex-1 h-7 text-xs bg-blue-600 hover:bg-blue-700 text-white"
                                  onClick={() => handleResetPassword(resetPwdVendor.phone, resetPwdInput)}
                                  disabled={resetPwdInput.length < 6 || resetVendorPassword.isPending}
                                >
                                  {resetVendorPassword.isPending ? "…" : "Confirmer"}
                                </Button>
                                <Button size="sm" variant="outline" className="flex-1 h-7 text-xs" onClick={() => { setResetPwdVendor(null); setResetPwdInput(""); }}>
                                  Annuler
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── PUBLICITÉS ───────────────────────────────────────── */}
        {tab === "ads" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">Publicités ({allAds.length})</h2>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={loadAds} disabled={adsLoading}>
                  <RefreshCw className={`w-3.5 h-3.5 ${adsLoading ? "animate-spin" : ""}`} />
                </Button>
                <Button size="sm" onClick={() => setShowAdForm((v) => !v)}>
                  <Plus className="w-3.5 h-3.5 mr-1.5" />
                  Nouvelle publicité
                </Button>
              </div>
            </div>
            {showAdForm && (
              <div className="bg-card border rounded-xl p-4 space-y-3">
                <h3 className="font-semibold text-sm">Nouvelle publicité</h3>
                <div className="grid grid-cols-2 gap-3">
                  <Input placeholder="Nom annonceur *" value={adForm.advertiserName} onChange={(e) => setAdForm((f) => ({ ...f, advertiserName: e.target.value }))} />
                  <Input placeholder="Téléphone *" value={adForm.advertiserPhone} onChange={(e) => setAdForm((f) => ({ ...f, advertiserPhone: e.target.value }))} />
                </div>
                <textarea
                  className="w-full border rounded-md px-3 py-2 text-sm min-h-[80px] resize-none"
                  placeholder="Message / description *"
                  value={adForm.message}
                  onChange={(e) => setAdForm((f) => ({ ...f, message: e.target.value }))}
                />
                <div className="flex items-center gap-3">
                  <input type="file" accept="image/*" ref={adImageRef} className="hidden" onChange={handleAdImageChange} />
                  <Button variant="outline" size="sm" onClick={() => adImageRef.current?.click()}>
                    Image
                  </Button>
                  {adForm.imagePreview && <img src={adForm.imagePreview} alt="" className="h-12 w-12 rounded-lg object-cover" />}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleCreateAd} disabled={createAd.isPending}>
                    {createAd.isPending ? "Création…" : "Créer"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowAdForm(false)}>Annuler</Button>
                </div>
              </div>
            )}
            {adsLoading ? (
              <div className="flex justify-center py-16"><RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" /></div>
            ) : allAds.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <Megaphone className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>Aucune publicité</p>
              </div>
            ) : (
              <div className="space-y-2">
                {allAds.map((ad) => {
                  const active = new Date(ad.endDate) > new Date();
                  return (
                    <div key={ad.id} className={`bg-card border rounded-xl p-3 flex items-center gap-3 ${!active ? "opacity-60" : ""}`}>
                      {ad.image && <img src={resolveImageUrl(ad.image)} alt="" className="w-14 h-14 rounded-lg object-cover flex-shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm truncate">{ad.advertiserName}</p>
                        <p className="text-xs text-muted-foreground truncate">{ad.message}</p>
                        <p className="text-xs text-muted-foreground">{ad.advertiserPhone} · {active ? <span className="text-green-600">Active</span> : <span className="text-red-500">Expirée</span>}</p>
                      </div>
                      <div className="flex gap-2 flex-shrink-0">
                        <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-green-600" onClick={() => openWhatsApp(`https://wa.me/${ad.advertiserPhone.replace(/\D/g, "")}?text=${encodeURIComponent(`Bonjour ${ad.advertiserName}, souhaitez-vous renouveler votre publicité ?`)}`)}>
                          📲
                        </Button>
                        <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive" onClick={() => { if (confirm("Supprimer cette publicité ?")) handleDeleteAd(ad.id); }}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── ÉVÉNEMENTS ───────────────────────────────────────── */}
        {tab === "events" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">Événements ({allEvents.length})</h2>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={loadEvents} disabled={eventsLoading}>
                  <RefreshCw className={`w-3.5 h-3.5 ${eventsLoading ? "animate-spin" : ""}`} />
                </Button>
                <Button size="sm" onClick={() => setShowEventForm((v) => !v)}>
                  <Plus className="w-3.5 h-3.5 mr-1.5" />
                  Nouvel événement
                </Button>
              </div>
            </div>
            {showEventForm && (
              <div className="bg-card border rounded-xl p-4 space-y-3">
                <h3 className="font-semibold text-sm">Nouvel événement</h3>
                <div className="grid grid-cols-2 gap-3">
                  <Input placeholder="Titre *" value={eventForm.title} onChange={(e) => setEventForm((f) => ({ ...f, title: e.target.value }))} />
                  <Input type="date" placeholder="Date *" value={eventForm.date} onChange={(e) => setEventForm((f) => ({ ...f, date: e.target.value }))} />
                  <Input placeholder="Lieu *" value={eventForm.location} onChange={(e) => setEventForm((f) => ({ ...f, location: e.target.value }))} />
                  <Input placeholder="Prix billet" value={eventForm.ticketPrice} onChange={(e) => setEventForm((f) => ({ ...f, ticketPrice: e.target.value }))} />
                  <Input placeholder="Lien billets" value={eventForm.ticketLink} onChange={(e) => setEventForm((f) => ({ ...f, ticketLink: e.target.value }))} className="col-span-2" />
                </div>
                <textarea
                  className="w-full border rounded-md px-3 py-2 text-sm min-h-[80px] resize-none"
                  placeholder="Description *"
                  value={eventForm.description}
                  onChange={(e) => setEventForm((f) => ({ ...f, description: e.target.value }))}
                />
                <div className="flex items-center gap-3">
                  <input type="file" accept="image/*" ref={eventFlyerRef} className="hidden" onChange={handleEventFlyerChange} />
                  <Button variant="outline" size="sm" onClick={() => eventFlyerRef.current?.click()}>Flyer</Button>
                  {eventForm.flyerPreview && <img src={eventForm.flyerPreview} alt="" className="h-12 w-12 rounded-lg object-cover" />}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleCreateEvent} disabled={createEvent.isPending}>
                    {createEvent.isPending ? "Création…" : "Créer"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowEventForm(false)}>Annuler</Button>
                </div>
              </div>
            )}
            {eventsLoading ? (
              <div className="flex justify-center py-16"><RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" /></div>
            ) : allEvents.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <Calendar className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>Aucun événement</p>
              </div>
            ) : (
              <div className="space-y-2">
                {allEvents.map((ev) => (
                  <div key={ev.id} className="bg-card border rounded-xl p-3 flex items-center gap-3">
                    {ev.flyerImage && <img src={resolveImageUrl(ev.flyerImage)} alt="" className="w-14 h-14 rounded-lg object-cover flex-shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm truncate">{ev.title}</p>
                      <p className="text-xs text-muted-foreground">{ev.location} · {new Date(ev.date).toLocaleDateString("fr-FR")}</p>
                    </div>
                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive flex-shrink-0" onClick={() => { if (confirm("Supprimer cet événement ?")) handleDeleteEvent(ev.id); }}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── SERVICES ─────────────────────────────────────────── */}
        {tab === "services" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">Services ({allServices.length})</h2>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={loadServices} disabled={servicesLoading}>
                  <RefreshCw className={`w-3.5 h-3.5 ${servicesLoading ? "animate-spin" : ""}`} />
                </Button>
                <Button size="sm" onClick={() => setShowServiceForm((v) => !v)}>
                  <Plus className="w-3.5 h-3.5 mr-1.5" />
                  Nouveau service
                </Button>
              </div>
            </div>
            {showServiceForm && (
              <div className="bg-card border rounded-xl p-4 space-y-3">
                <h3 className="font-semibold text-sm">Nouveau service</h3>
                <div className="grid grid-cols-2 gap-3">
                  <select
                    className="border rounded-md px-3 py-2 text-sm"
                    value={serviceForm.type}
                    onChange={(e) => setServiceForm((f) => ({ ...f, type: e.target.value as "offer" | "seeker" | "atelier" }))}
                  >
                    <option value="offer">Offre d'emploi</option>
                    <option value="seeker">Demande d'emploi</option>
                    <option value="atelier">Atelier</option>
                  </select>
                  <Input placeholder="Titre *" value={serviceForm.title} onChange={(e) => setServiceForm((f) => ({ ...f, title: e.target.value }))} />
                  <Input placeholder="Contact *" value={serviceForm.contact} onChange={(e) => setServiceForm((f) => ({ ...f, contact: e.target.value }))} />
                  <Input placeholder="Quartier" value={serviceForm.quartier} onChange={(e) => setServiceForm((f) => ({ ...f, quartier: e.target.value }))} />
                  <Input placeholder="Ville" value={serviceForm.ville} onChange={(e) => setServiceForm((f) => ({ ...f, ville: e.target.value }))} />
                </div>
                <textarea
                  className="w-full border rounded-md px-3 py-2 text-sm min-h-[80px] resize-none"
                  placeholder="Description *"
                  value={serviceForm.description}
                  onChange={(e) => setServiceForm((f) => ({ ...f, description: e.target.value }))}
                />
                <div className="flex items-center gap-3">
                  <input type="file" accept="image/*" ref={serviceImageRef} className="hidden" onChange={handleServiceImageChange} />
                  <Button variant="outline" size="sm" onClick={() => serviceImageRef.current?.click()}>Image</Button>
                  {serviceForm.imagePreview && <img src={serviceForm.imagePreview} alt="" className="h-12 w-12 rounded-lg object-cover" />}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleCreateService} disabled={createService.isPending}>
                    {createService.isPending ? "Création…" : "Créer"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowServiceForm(false)}>Annuler</Button>
                </div>
              </div>
            )}
            {servicesLoading ? (
              <div className="flex justify-center py-16"><RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" /></div>
            ) : allServices.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <Briefcase className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>Aucun service</p>
              </div>
            ) : (
              <div className="space-y-2">
                {allServices.map((s) => (
                  <div key={s.id} className="bg-card border rounded-xl p-3 flex items-center gap-3">
                    {s.image && <img src={resolveImageUrl(s.image)} alt="" className="w-14 h-14 rounded-lg object-cover flex-shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm truncate">{s.title}</p>
                      <p className="text-xs text-muted-foreground">{s.type} · {s.ville ?? s.quartier ?? ""}</p>
                    </div>
                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive flex-shrink-0" onClick={() => { if (confirm("Supprimer ce service ?")) handleDeleteService(s.id); }}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── PARAMÈTRES ───────────────────────────────────────── */}
        {tab === "settings" && (
          <div className="space-y-4 max-w-lg">
            <h2 className="text-lg font-bold">Paramètres</h2>
            <div className="bg-card border rounded-xl p-4 space-y-4">
              <div>
                <label className="text-sm font-medium block mb-1.5">Taux de commission (%)</label>
                <select
                  className="border rounded-md px-3 py-2 text-sm w-full"
                  value={settingsForm.commissionRate}
                  onChange={(e) => setSettingsForm((f) => ({ ...f, commissionRate: e.target.value }))}
                >
                  {[0, 2, 3, 4, 5].map((r) => (
                    <option key={r} value={r}>{r}%{r === 0 ? " (Gratuit)" : ""}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium block mb-1.5">WhatsApp commissions</label>
                <Input placeholder="22870703131" value={settingsForm.whatsappCommission} onChange={(e) => setSettingsForm((f) => ({ ...f, whatsappCommission: e.target.value }))} />
              </div>
              <div>
                <label className="text-sm font-medium block mb-1.5">WhatsApp commandes</label>
                <Input placeholder="22870703131" value={settingsForm.whatsappOrders} onChange={(e) => setSettingsForm((f) => ({ ...f, whatsappOrders: e.target.value }))} />
              </div>
              <div>
                <label className="text-sm font-medium block mb-1.5">WhatsApp publicités</label>
                <Input placeholder="22870703131" value={settingsForm.whatsappAds} onChange={(e) => setSettingsForm((f) => ({ ...f, whatsappAds: e.target.value }))} />
              </div>
              <div>
                <label className="text-sm font-medium block mb-1.5">WhatsApp services</label>
                <Input placeholder="22870703131" value={settingsForm.whatsappServices} onChange={(e) => setSettingsForm((f) => ({ ...f, whatsappServices: e.target.value }))} />
              </div>
              <div>
                <label className="text-sm font-medium block mb-1.5">Mot de passe sous-admin</label>
                <Input placeholder="Nouveau mot de passe sous-admin" value={settingsForm.subAdminPwd} onChange={(e) => setSettingsForm((f) => ({ ...f, subAdminPwd: e.target.value }))} />
              </div>
              <Button onClick={handleSaveSettings} disabled={updateSettings.isPending}>
                {updateSettings.isPending ? "Sauvegarde…" : "Sauvegarder"}
              </Button>
            </div>
          </div>
        )}

        {/* ── COMPTES ADMIN (superadmin uniquement) ────────────── */}
        {tab === "accounts" && isSuperAdmin && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">Comptes admin ({accounts.length})</h2>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={loadAccounts} disabled={accountsLoading}>
                  <RefreshCw className={`w-3.5 h-3.5 ${accountsLoading ? "animate-spin" : ""}`} />
                </Button>
                <Button size="sm" onClick={() => setShowNewAccountForm((v) => !v)}>
                  <Plus className="w-3.5 h-3.5 mr-1.5" />
                  Nouveau compte
                </Button>
              </div>
            </div>
            {showNewAccountForm && (
              <div className="bg-card border rounded-xl p-4 space-y-3">
                <h3 className="font-semibold text-sm">Nouveau compte admin</h3>
                <div className="grid grid-cols-2 gap-3">
                  <Input placeholder="Nom d'utilisateur *" value={newAccount.username} onChange={(e) => setNewAccount((a) => ({ ...a, username: e.target.value }))} />
                  <Input placeholder="Code d'accès *" type="password" value={newAccount.code} onChange={(e) => setNewAccount((a) => ({ ...a, code: e.target.value }))} />
                  <select
                    className="border rounded-md px-3 py-2 text-sm col-span-2"
                    value={newAccount.role}
                    onChange={(e) => setNewAccount((a) => ({ ...a, role: e.target.value }))}
                  >
                    <option value="admin_pub">Admin Publicités</option>
                    <option value="admin_event">Admin Événements</option>
                    <option value="admin_service">Admin Services</option>
                    <option value="superadmin">Superadmin</option>
                  </select>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleCreateAccount}>Créer</Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowNewAccountForm(false)}>Annuler</Button>
                </div>
              </div>
            )}
            {accountsLoading ? (
              <div className="flex justify-center py-16"><RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" /></div>
            ) : accounts.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <Shield className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>Aucun compte admin</p>
              </div>
            ) : (
              <div className="space-y-2">
                {accounts.map((acc) => (
                  <div key={acc.id} className="bg-card border rounded-xl p-3 flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <Shield className="w-4 h-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm">{acc.username}</p>
                      <p className="text-xs text-muted-foreground">{acc.role} · créé le {new Date(acc.createdAt).toLocaleDateString("fr-FR")}</p>
                    </div>
                    {acc.role !== "superadmin" && (
                      <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive flex-shrink-0"
                        onClick={() => { if (confirm(`Supprimer le compte "${acc.username}" ?`)) handleDeleteAccount(acc.id); }}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

      </main>

      {viewerImages.length > 0 && (
        <ImageViewer
          images={viewerImages}
          startIndex={viewerIndex}
          onClose={() => setViewerImages([])}
        />
      )}
    </div>
  );
}
