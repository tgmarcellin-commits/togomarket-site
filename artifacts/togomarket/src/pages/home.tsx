import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { decodeShopToken } from "@/lib/shop-token";
import { openWhatsApp } from "@/lib/whatsapp";
import {
  useGetListings,
  getGetListingsQueryKey,
  useGetStats,
  useGetAdminSettings,
  useVendorLogin,
  type VendorProfile,
  type Listing,
} from "@workspace/api-client-react";
import { Search, SearchIcon, LogIn, UserCircle2, Settings, Link2Off, MessageCircle } from "lucide-react";
import { resolveImageUrl, isVideoMedia, resolveMediaUrl } from "@/lib/image";
import { useSiteSettings } from "@/lib/site-settings";
import { useT } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ListingCard } from "@/components/listing-card";
import { PublishModal } from "@/components/publish-modal";
import { OrderModal } from "@/components/order-modal";
import { loadAdminSession } from "@/pages/admin-login";
import { AuthModal } from "@/components/auth-modal";
import { InstallPrompt } from "@/components/install-prompt";
import { AdBanner } from "@/components/ad-banner";
import { BottomNav, type NavTab } from "@/components/bottom-nav";
import { EvenementielView } from "@/components/evenementiel-view";
import { ServicesView } from "@/components/services-view";
import { ProfileSettingsModal } from "@/components/profile-settings-modal";
import { AiAssistant } from "@/components/ai-assistant";
import { VendorConversations } from "@/components/vendor-conversations";
import { PushActivationBanner } from "@/components/push-activation-banner";
import { VendorSystemNotifications } from "@/components/vendor-system-notifications";
import { BuyerInbox } from "@/components/buyer-inbox";
import { loadBuyerIdentity } from "@/components/buyer-identity-prompt";
import { useToast } from "@/hooks/use-toast";
import { getSocket } from "@/lib/socket";

const STORAGE_KEY = "togomarket_vendor_session";

function loadSession(): { vendor: VendorProfile; password: string } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveSession(vendor: VendorProfile, password: string) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ vendor, password }));
  } catch {}
}

function clearSession() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

interface VendorInSector {
  id: number;
  firstName: string;
  lastName: string;
  shopName?: string | null;
  profilePhoto?: string | null;
}

interface TourismeCatalog {
  catalogName: string;
  description: string;
  vendorName: string;
  vendorId: number | null;
  phone: string;
  images: string[];
  createdAt: string;
}


const CATALOG_SECTORS = [
  { label: "Tourisme", emoji: "🌴", value: "Tourisme" },
  { label: "Divers", emoji: "📦", value: "Divers" },
  { label: "Immobilier", emoji: "🏢", value: "Immobilier" },
  { label: "Automobile", emoji: "🚗", value: "Automobile" },
  { label: "Repas", emoji: "🍽️", value: "Repas" },
  { label: "AgriMarket", emoji: "🌿", value: "AgriMarket" },
] as const;

export default function Home() {
  const { toast } = useToast();
  const { lang, setLang } = useSiteSettings();
  const t = useT(lang);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [sector, setSector] = useState<string | undefined>(undefined);
  const [activeTab, setActiveTab] = useState<NavTab>(
    () => (sessionStorage.getItem("tm_active_tab") as NavTab | null) ?? "marketplace"
  );
  const [tabRefreshKey, setTabRefreshKey] = useState(0);
  const [shopNumber, setShopNumber] = useState<number | undefined>(undefined);
  const [shopLinkExpired, setShopLinkExpired] = useState(false);
  const [referredBy, setReferredBy] = useState<number | undefined>(undefined);
  const [catalogSector, setCatalogSector] = useState<string | null>(null);
  const [catalogVendors, setCatalogVendors] = useState<VendorInSector[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogShopSearch, setCatalogShopSearch] = useState("");
  const [tourismeCatalogs, setTourismeCatalogs] = useState<TourismeCatalog[]>([]);
  const [tourismeCatalogsLoading, setTourismeCatalogsLoading] = useState(false);
  const [selectedTourismeCatalog, setSelectedTourismeCatalog] = useState<number | null>(null);
  const [shopSearchInput, setShopSearchInput] = useState("");
  const [heroMode, setHeroMode] = useState<"article" | "boutique">("article");

  const handleDeleteTourismeCatalog = async (catalog: TourismeCatalog) => {
    let pwd = loadAdminSession()?.code ?? "";
    if (!pwd) {
      const entered = window.prompt("Mot de passe administrateur :");
      if (!entered) return;
      pwd = entered;
    }
    const msg = lang === "fr"
      ? `Supprimer définitivement le catalogue « ${catalog.catalogName} » ?`
      : `Permanently delete catalog "${catalog.catalogName}"?`;
    if (!confirm(msg)) return;
    try {
      const res = await fetch("/api/admin/tourisme/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pwd, phone: catalog.phone, catalogName: catalog.catalogName }),
      });
      if (!res.ok) {
        alert(lang === "fr" ? "Échec de la suppression (mot de passe ou catalogue invalide)." : "Deletion failed (invalid password or catalog).");
        return;
      }
      setTourismeCatalogs((prev) => prev.filter((c) => !(c.phone === catalog.phone && c.catalogName === catalog.catalogName)));
      setSelectedTourismeCatalog(null);
    } catch {
      alert(lang === "fr" ? "Erreur réseau lors de la suppression." : "Network error during deletion.");
    }
  };

  const logoClickCount = useRef(0);
  const logoClickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleLogoClick = () => {
    setActiveTab("stand");
    setSector(undefined);
    setSearch("");
    setSearchInput("");
    setCatalogSector(null);
    setCatalogVendors([]);
    setTourismeCatalogs([]);
    setSelectedTourismeCatalog(null);
    setShopNumber(undefined);

    logoClickCount.current += 1;
    if (logoClickTimer.current) clearTimeout(logoClickTimer.current);
    if (logoClickCount.current >= 4) {
      logoClickCount.current = 0;
      setQuickMode((prev) => !prev);
    } else {
      logoClickTimer.current = setTimeout(() => {
        logoClickCount.current = 0;
      }, 2000);
    }
  };

  const [isPublishModalOpen, setIsPublishModalOpen] = useState(false);
  const [isOrderModalOpen, setIsOrderModalOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [quickMode, setQuickMode] = useState(false);

  const [vendor, setVendor] = useState<VendorProfile | null>(null);
  const [vendorPassword, setVendorPassword] = useState("");
  const [convsUnread, setConvsUnread] = useState(0);
  const [systemNotifsUnread, setSystemNotifsUnread] = useState(0);
  const messagesUnread = convsUnread + systemNotifsUnread;

  // Buyer inbox state
  const [pendingConvId, setPendingConvId] = useState<number | null>(null);
  const buyerIdentity = loadBuyerIdentity();

  /** Redirect to Messages tab and auto-open a specific conversation */
  const handleOpenInMessages = useCallback((convId: number) => {
    sessionStorage.setItem("tm_active_tab", "messages");
    setActiveTab("messages");
    setPendingConvId(convId);
  }, []);

  // Deep-link depuis une notification push ──────────────────────────────────
  // Chemin 1 : app fermée → SW ouvre /?tab=messages&conv=123 → parse l'URL au montage
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get("tab");
    const convParam = params.get("conv");
    if (tabParam === "messages" && convParam) {
      const convId = parseInt(convParam, 10);
      if (!isNaN(convId)) {
        handleOpenInMessages(convId);
        // Nettoyer l'URL sans recharger la page
        window.history.replaceState({}, "", window.location.pathname);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Une seule fois au montage

  // Chemin 2 : app déjà ouverte → SW envoie un postMessage type="open_conversation"
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const handleSWMessage = (event: MessageEvent) => {
      if (event.data?.type === "open_conversation") {
        const convId = Number(event.data.conversationId);
        if (convId) handleOpenInMessages(convId);
      }
    };
    navigator.serviceWorker.addEventListener("message", handleSWMessage);
    return () => {
      navigator.serviceWorker.removeEventListener("message", handleSWMessage);
    };
  }, [handleOpenInMessages]);

  // ── Badge "Messages" : compter les non-lus dès l'arrivée sur la plateforme,
  //    sans attendre que l'onglet Messages soit ouvert ────────────────────────
  useEffect(() => {
    if (!vendor || !vendorPassword) {
      setConvsUnread(0);
      setSystemNotifsUnread(0);
      return;
    }
    const headers = {
      "x-vendor-phone": vendor.phone,
      "x-vendor-password": vendorPassword,
    };
    let cancelled = false;
    const fetchUnreadCounts = async () => {
      try {
        const [convRes, notifRes] = await Promise.all([
          fetch("/api/vendor/conversations", { headers }),
          fetch("/api/vendor/notifications", { headers }),
        ]);
        if (cancelled) return;
        if (convRes.ok) {
          const convs = (await convRes.json()) as { vendorUnreadCount: number }[];
          if (!cancelled)
            setConvsUnread(convs.reduce((sum, c) => sum + (c.vendorUnreadCount || 0), 0));
        }
        if (notifRes.ok) {
          const notifs = (await notifRes.json()) as { isRead: boolean }[];
          if (!cancelled)
            setSystemNotifsUnread(notifs.filter((n) => !n.isRead).length);
        }
      } catch {
        // silencieux : le badge se mettra à jour à la prochaine occasion
      }
    };
    fetchUnreadCounts();
    // Mise à jour en temps réel quand un nouveau message arrive
    const socket = getSocket();
    socket.emit("auth", { phone: vendor.phone, password: vendorPassword });
    const handler = () => { fetchUnreadCounts(); };
    socket.on("new_message", handler);
    return () => {
      cancelled = true;
      socket.off("new_message", handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendor?.phone, vendorPassword]);

  const [page, setPage] = useState(1);
  const [loadedListings, setLoadedListings] = useState<Listing[]>([]);
  const seenDataRef = useRef<typeof pageData>(undefined);

  const refreshVendorMutation = useVendorLogin();

  useEffect(() => {
    const session = loadSession();
    if (session) {
      setVendor(session.vendor);
      setVendorPassword(session.password);
      refreshVendorMutation.mutate(
        { data: { phone: session.vendor.phone, password: session.password } },
        {
          onSuccess: (fresh) => {
            setVendor(fresh);
            saveSession(fresh, session.password);
          },
        }
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Détecter le retour depuis FedaPay (?payment=success) et afficher un toast
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const paymentStatus = params.get("payment");
    if (paymentStatus) {
      if (paymentStatus === "success") {
        toast({
          title: "Paiement confirmé ✅",
          description: "Votre paiement a bien été reçu. Votre boutique/annonce est maintenant active. Reconnectez-vous pour voir les changements.",
        });
      } else if (paymentStatus === "not_approved") {
        toast({
          title: "Paiement non abouti",
          description: "Le paiement n'a pas été finalisé. Réessayez ou contactez le support.",
          variant: "destructive",
        });
      } else if (paymentStatus === "error" || paymentStatus === "verify_error") {
        toast({
          title: "Erreur de vérification",
          description: "Votre paiement a peut-être été effectué. Contactez le support WhatsApp pour confirmation.",
          variant: "destructive",
        });
      }
      // Nettoyer l'URL sans recharger la page
      const cleanUrl = window.location.pathname;
      window.history.replaceState({}, "", cleanUrl);
    }
  }, [toast]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const shopToken = params.get("shop");
    const legacyNum = params.get("shopNumber");
    if (shopToken) {
      const parsed = decodeShopToken(shopToken);
      if (parsed) {
        fetch(`/api/vendors/shop-status?vendorId=${parsed.vendorId}`)
          .then((r) => r.json())
          .then((status: { active: boolean; exists: boolean }) => {
            if (status.active) {
              setShopNumber(parsed.vendorId);
            } else {
              setShopLinkExpired(true);
            }
          })
          .catch(() => {
            setShopNumber(parsed.vendorId);
          });
      } else {
        setShopLinkExpired(true);
      }
    } else if (legacyNum) {
      const id = parseInt(legacyNum, 10);
      if (!isNaN(id) && id > 0) {
        setShopNumber(id);
      }
    }

    const refParam = params.get("ref");
    if (refParam) {
      const id = parseInt(refParam, 10);
      if (!isNaN(id) && id > 0) {
        setReferredBy(id);
      }
    }
  }, []);

  const { data: pageData, isLoading, isFetching } = useGetListings(
    { search, sector, page, shopNumber },
    { query: { queryKey: getGetListingsQueryKey({ search, sector, page, shopNumber }) } }
  );

  // ── Market Place tab : liste paginée de tous les articles ──
  const [mpPage, setMpPage] = useState(1);
  const [mpListings, setMpListings] = useState<Listing[]>([]);
  const [mpHasMore, setMpHasMore] = useState(false);
  const mpSeenRef = useRef<unknown>(undefined);
  const { data: mpPageData, isLoading: mpLoading, isFetching: mpFetching } = useGetListings(
    { page: mpPage, limit: 20, search },
    { query: { queryKey: getGetListingsQueryKey({ page: mpPage, limit: 20, search }) } }
  );
  const { data: stats } = useGetStats();
  const { data: settings } = useGetAdminSettings();
  const commissionRate = settings?.commissionRate ?? 2;
  const whatsappCommission = settings?.whatsappCommission ?? "22870703131";
  const whatsappOrders = settings?.whatsappOrders ?? "22870703131";

  useEffect(() => {
    setPage(1);
    setLoadedListings([]);
    seenDataRef.current = undefined;
  }, [search, sector, shopNumber]);

  useEffect(() => {
    if (!mpPageData || mpPageData === mpSeenRef.current) return;
    mpSeenRef.current = mpPageData;
    setMpHasMore(mpPageData.hasMore ?? false);
    if (mpPageData.page === 1) {
      setMpListings(mpPageData.items);
    } else {
      setMpListings((prev) => [...prev, ...mpPageData.items]);
    }
  }, [mpPageData]);

  // Reset uniquement au changement de recherche (pas au changement d'onglet)
  useEffect(() => {
    setMpPage(1);
    setMpListings([]);
    mpSeenRef.current = undefined;
  }, [search]);

  // Au retour sur l'onglet marketplace : repeupler depuis le cache si données déjà disponibles
  useEffect(() => {
    if (activeTab !== "marketplace") return;
    if (mpPageData && mpSeenRef.current !== mpPageData) {
      mpSeenRef.current = mpPageData;
      setMpHasMore(mpPageData.hasMore ?? false);
      setMpListings(mpPageData.items);
    }
  }, [activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!pageData || pageData === seenDataRef.current) return;
    seenDataRef.current = pageData;
    if (pageData.page === 1) {
      setLoadedListings(pageData.items);
    } else {
      setLoadedListings((prev) => [...prev, ...pageData.items]);
    }
  }, [pageData]);

  const handleLoadMore = useCallback(() => {
    setPage((p) => p + 1);
  }, []);

  const sortedListings = useMemo(() => loadedListings, [loadedListings]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput);
    setShopNumber(undefined);
  };

  const handleCatalogClick = async (sec: string) => {
    setCatalogSector(sec);
    setCatalogVendors([]);
    setCatalogLoading(true);
    setCatalogShopSearch("");
    setShopNumber(undefined);
    setSearch("");
    setSearchInput("");
    setSector(undefined);
    setSelectedTourismeCatalog(null);
    setTourismeCatalogs([]);

    if (sec === "Tourisme") {
      setCatalogLoading(false);
      setTourismeCatalogsLoading(true);
      try {
        const res = await fetch("/api/listings/tourisme");
        if (res.ok) {
          const data = await res.json() as TourismeCatalog[];
          setTourismeCatalogs(data);
        }
      } catch {
        // Laisse vide
      } finally {
        setTourismeCatalogsLoading(false);
      }
      return;
    }

    try {
      const res = await fetch(`/api/vendors/sector/${sec}`);
      if (res.ok) {
        const data = await res.json() as VendorInSector[];
        setCatalogVendors(data);
      }
    } catch {
      // Laisse la liste vide
    } finally {
      setCatalogLoading(false);
    }
  };

  const handleLoginSuccess = (v: VendorProfile, pwd: string) => {
    setVendor(v);
    setVendorPassword(pwd);
    saveSession(v, pwd);
  };

  const handleLogout = () => {
    setVendor(null);
    setVendorPassword("");
    clearSession();
    toast({ title: "Déconnecté", description: "À bientôt !" });
    setActiveTab("stand");
  };

  const handleVendorUpdate = (updated: VendorProfile, newPassword?: string) => {
    setVendor(updated);
    const pwd = newPassword ?? vendorPassword;
    setVendorPassword(pwd);
    saveSession(updated, pwd);
  };

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background pb-[72px]">
      <InstallPrompt />

      {quickMode && (
        <div className="bg-amber-500 text-white text-center py-1 text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2">
          <span>🔍 Mode Consultation — numéros visibles</span>
          <button onClick={() => setQuickMode(false)} className="ml-2 underline opacity-80 hover:opacity-100">Désactiver</button>
        </div>
      )}

      {/* Sticky Navbar */}
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 shadow-sm">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div
            className="flex items-center gap-2 cursor-pointer"
            onClick={handleLogoClick}
          >
            <img src="/logo.jpg" alt="TogoMarket" className="h-9 w-9 rounded-lg object-cover flex-shrink-0" />
            <span className="font-bold text-2xl tracking-tight">
              <span className="text-foreground">Togo</span>
              <span className="text-primary">Market</span>
            </span>
          </div>

          {/* Auth / Publish buttons */}
          <div className="flex items-center gap-1.5">
            {/* Lang toggle */}
            <button
              onClick={() => setLang(lang === "fr" ? "en" : "fr")}
              className="text-[11px] font-bold px-1.5 py-0.5 rounded-full border border-border hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
            >
              {lang === "fr" ? "EN" : "FR"}
            </button>
            {vendor ? (
              <>
                <Button
                  onClick={() => setIsPublishModalOpen(true)}
                  className="bg-primary hover:bg-primary/90 rounded-full font-semibold px-3 sm:px-5 text-sm"
                >
                  {t.publish}
                </Button>

                {/* Profile avatar → opens ProfileSettingsModal */}
                <button
                  onClick={() => setIsProfileModalOpen(true)}
                  className="relative group rounded-full border-2 border-primary/30 overflow-hidden w-9 h-9 flex-shrink-0 hover:border-primary transition-colors"
                  title="Paramètres du profil"
                >
                  {vendor.profilePhoto ? (
                    <img
                      src={resolveImageUrl(vendor.profilePhoto)}
                      alt={vendor.firstName}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full bg-muted flex items-center justify-center">
                      <UserCircle2 className="w-6 h-6 text-muted-foreground" />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <Settings className="w-3.5 h-3.5 text-white" />
                  </div>
                </button>
              </>
            ) : (
              <Button
                onClick={() => setIsAuthModalOpen(true)}
                variant="outline"
                className="rounded-full font-semibold px-3 sm:px-5 gap-1.5 text-sm"
              >
                <LogIn className="w-4 h-4" />
                {t.login}
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* ── STAND TAB ─────────────────────────────────────────────────── */}
      {activeTab === "stand" && (
        <>
          {/* ── CONTENU DYNAMIQUE : catalogue / liste boutiques / articles ── */}
          {shopLinkExpired ? (
            <main className="container mx-auto px-4 py-8 flex-grow">
              <div className="flex flex-col items-center justify-center py-24 text-center gap-6">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-destructive/10">
                  <Link2Off className="w-8 h-8 text-destructive" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold mb-2">{t.shopExpiredTitle}</h3>
                  <p className="text-muted-foreground max-w-sm mx-auto text-sm">{t.shopExpiredMsg}</p>
                </div>
                <Button onClick={() => setShopLinkExpired(false)} className="rounded-full px-8 bg-violet-600 hover:bg-violet-700 text-white border-0">
                  {t.goToMarketplace}
                </Button>
              </div>
            </main>

          ) : !catalogSector && !shopNumber ? (
            /* ── GRILLE DES CATALOGUES (vue par défaut) ── */
            <main className="container mx-auto px-4 py-6 flex-grow">
              {search ? (
                /* Résultats de recherche */
                <>
                  <div className="flex items-center gap-2 mb-4">
                    <button
                      onClick={() => { setSearch(""); setSearchInput(""); }}
                      className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
                    >
                      ← {lang === "fr" ? "Retour au catalogue" : "Back to catalogue"}
                    </button>
                    <span className="text-sm text-muted-foreground">· "{search}"</span>
                  </div>
                  {isLoading ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                      {[1, 2, 3].map(n => (
                        <div key={n} className="rounded-xl border bg-card overflow-hidden h-[400px] flex flex-col">
                          <div className="h-[200px] bg-muted animate-pulse" />
                          <div className="p-4 flex flex-col gap-3 flex-grow">
                            <div className="h-6 bg-muted rounded w-3/4 animate-pulse" />
                            <div className="h-5 bg-muted rounded w-1/3 animate-pulse" />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : sortedListings.length > 0 ? (
                    <>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                        {sortedListings.map(listing => (
                          <ListingCard key={listing.id} listing={listing} isAdmin={quickMode} adminPassword={quickMode ? (loadAdminSession()?.code ?? "") : ""} commissionRate={commissionRate} whatsappCommission={whatsappCommission} isOwn={vendor ? listing.phone === vendor.phone : false} onOpenInMessages={handleOpenInMessages} />
                        ))}
                      </div>
                      {pageData?.hasMore && (
                        <div className="flex justify-center mt-10">
                          <Button variant="outline" onClick={handleLoadMore} disabled={isFetching} className="rounded-full px-8 font-semibold">
                            {isFetching ? t.loading : t.loadMore}
                          </Button>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-center py-20">
                      <Search className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                      <p className="text-muted-foreground">{lang === "fr" ? "Aucun résultat pour cette recherche." : "No results for this search."}</p>
                    </div>
                  )}
                </>
              ) : (
                /* Grille de catalogues sectoriels */
                <>
                  <p className="text-center text-sm text-muted-foreground mb-5 font-medium">
                    {lang === "fr" ? "Choisissez un secteur pour trouver des boutiques" : "Choose a sector to find shops"}
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                    {CATALOG_SECTORS.map((sec) => (
                      <button
                        key={sec.value}
                        onClick={() => handleCatalogClick(sec.value)}
                        className="group aspect-square rounded-2xl border-2 border-border hover:border-primary/60 bg-card hover:bg-primary/5 flex flex-col items-center justify-center gap-2 transition-all shadow-sm hover:shadow-md active:scale-95"
                      >
                        <span className="text-4xl group-hover:scale-110 transition-transform">{sec.emoji}</span>
                        <p className="font-bold text-sm text-foreground leading-tight px-2 text-center">{sec.label}</p>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </main>

          ) : catalogSector === "Tourisme" && !shopNumber ? (
            /* ── VUE CATALOGUES TOURISME ── */
            <>
              <div className="sticky top-0 z-20 bg-background/95 backdrop-blur-sm border-b border-border/60 px-4 py-2.5 flex items-center gap-3">
                <button
                  onClick={() => {
                    if (selectedTourismeCatalog !== null) {
                      setSelectedTourismeCatalog(null);
                    } else {
                      setCatalogSector(null); setTourismeCatalogs([]); setSelectedTourismeCatalog(null);
                      setSector(undefined); setShopNumber(undefined);
                    }
                  }}
                  className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground active:scale-95 transition-all"
                >
                  <span className="text-base">←</span>
                  <span>{selectedTourismeCatalog !== null ? (lang === "fr" ? "Retour aux catalogues" : "Back to catalogs") : (lang === "fr" ? "Retour aux secteurs" : "Back to sectors")}</span>
                </button>
                <span className="text-muted-foreground/40">|</span>
                <h2 className="text-sm font-bold flex items-center gap-1.5 truncate">
                  <span>🌴</span>
                  <span>{selectedTourismeCatalog !== null ? tourismeCatalogs[selectedTourismeCatalog]?.catalogName : "Tourisme"}</span>
                </h2>
              </div>

              <main className="container mx-auto px-4 py-6 flex-grow">
                {selectedTourismeCatalog !== null ? (
                  /* ── GALERIE DU CATALOGUE SÉLECTIONNÉ ── */
                  (() => {
                    const catalog = tourismeCatalogs[selectedTourismeCatalog];
                    if (!catalog) return null;
                    return (
                      <div className="space-y-4">
                        {catalog.description && catalog.description !== "Catalogue Tourisme" && (
                          <p className="text-sm text-muted-foreground leading-relaxed">{catalog.description}</p>
                        )}
                        <p className="text-xs text-muted-foreground font-medium">
                          {lang === "fr" ? "Vendeur" : "Seller"} : <span className="text-foreground">{catalog.vendorName}</span>
                        </p>
                        {catalog.images.length === 0 ? (
                          <div className="text-center py-16 text-muted-foreground text-sm">
                            {lang === "fr" ? "Aucun média dans ce catalogue." : "No media in this catalog."}
                          </div>
                        ) : (
                          <div className="grid grid-cols-2 gap-3">
                            {catalog.images.map((img, i) => (
                              isVideoMedia(img) ? (
                                <div key={i} className="col-span-2 rounded-xl overflow-hidden bg-black aspect-video relative">
                                  <video
                                    src={resolveMediaUrl(img)}
                                    controls
                                    playsInline
                                    className="w-full h-full object-contain"
                                  />
                                </div>
                              ) : (
                                <a key={i} href={resolveImageUrl(img)} target="_blank" rel="noopener noreferrer">
                                  <img
                                    src={resolveImageUrl(img)}
                                    alt={`${catalog.catalogName} ${i + 1}`}
                                    className="w-full aspect-square rounded-xl object-cover hover:opacity-90 transition-opacity"
                                  />
                                </a>
                              )
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })()
                ) : (
                  /* ── GRILLE DES CATALOGUES ── */
                  tourismeCatalogsLoading ? (
                    <div className="grid grid-cols-2 gap-4">
                      {[1, 2, 3, 4].map((n) => (
                        <div key={n} className="rounded-2xl overflow-hidden border bg-card">
                          <div className="aspect-video bg-muted animate-pulse" />
                          <div className="p-3 space-y-2">
                            <div className="h-4 bg-muted rounded animate-pulse w-3/4" />
                            <div className="h-3 bg-muted rounded animate-pulse w-1/2" />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : tourismeCatalogs.length === 0 ? (
                    <div className="text-center py-20">
                      <span className="text-5xl block mb-4">🌴</span>
                      <p className="text-muted-foreground text-sm max-w-xs mx-auto">
                        {lang === "fr" ? "Aucun catalogue Tourisme disponible pour le moment." : "No Tourisme catalog available yet."}
                      </p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-4">
                      {tourismeCatalogs.map((catalog, i) => (
                        <div key={i} className="relative">
                        <button
                          onClick={() => setSelectedTourismeCatalog(i)}
                          className="group w-full text-left rounded-2xl overflow-hidden border bg-card hover:border-primary/50 hover:shadow-md active:scale-95 transition-all"
                        >
                          <div className="aspect-video bg-muted relative overflow-hidden">
                            {catalog.images[0] ? (
                              isVideoMedia(catalog.images[0]) ? (
                                <div className="w-full h-full flex items-center justify-center bg-black relative">
                                  <video
                                    src={resolveMediaUrl(catalog.images[0])}
                                    className="w-full h-full object-cover"
                                    muted
                                    playsInline
                                  />
                                  {/* Play icon overlay so the user knows it's a video */}
                                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                    <div className="bg-black/50 rounded-full w-10 h-10 flex items-center justify-center">
                                      <svg className="w-5 h-5 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                                    </div>
                                  </div>
                                </div>
                              ) : (
                                <img
                                  src={resolveImageUrl(catalog.images[0])}
                                  alt={catalog.catalogName}
                                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                />
                              )
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-3xl">🌴</div>
                            )}
                            <div className="absolute bottom-1 right-1 bg-black/60 text-white text-[9px] font-medium px-1.5 py-0.5 rounded-full">
                              {catalog.images.length} {lang === "fr" ? "photo" : "photo"}{catalog.images.length > 1 ? "s" : ""}
                            </div>
                          </div>
                          <div className="p-3">
                            <p className="font-semibold text-sm text-foreground line-clamp-1">{catalog.catalogName}</p>
                            <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{catalog.vendorName}</p>
                          </div>
                        </button>
                        {quickMode && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteTourismeCatalog(catalog);
                            }}
                            className="absolute top-2 left-2 z-10 bg-red-600 hover:bg-red-700 text-white text-[11px] font-bold px-2.5 py-1.5 rounded-full shadow-lg"
                          >
                            {lang === "fr" ? "Supprimer" : "Delete"}
                          </button>
                        )}
                        </div>
                      ))}
                    </div>
                  )
                )}
              </main>
            </>

          ) : catalogSector && !shopNumber ? (
            /* ── LISTE DES BOUTIQUES DU SECTEUR ── */
            <>
              <div className="sticky top-0 z-20 bg-background/95 backdrop-blur-sm border-b border-border/60 px-4 py-2.5 flex items-center gap-3">
                <button
                  onClick={() => { setCatalogSector(null); setCatalogVendors([]); setSector(undefined); setShopNumber(undefined); setCatalogShopSearch(""); }}
                  className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground active:scale-95 transition-all"
                >
                  <span className="text-base">←</span>
                  <span>{lang === "fr" ? "Retour aux secteurs" : "Back to sectors"}</span>
                </button>
                <span className="text-muted-foreground/40">|</span>
                <h2 className="text-sm font-bold flex items-center gap-1.5 truncate">
                  <span>{CATALOG_SECTORS.find(s => s.value === catalogSector)?.emoji}</span>
                  <span>{catalogSector}</span>
                </h2>
              </div>
            <main className="container mx-auto px-4 py-6 flex-grow">
              {/* Barre de recherche boutique */}
              {!catalogLoading && (
                <div className="relative mb-5">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                  <input
                    type="text"
                    placeholder={lang === "fr" ? "Rechercher une boutique…" : "Search a shop…"}
                    value={catalogShopSearch}
                    onChange={(e) => setCatalogShopSearch(e.target.value)}
                    className="w-full pl-9 pr-4 h-10 rounded-full border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 placeholder:text-muted-foreground"
                  />
                  {catalogShopSearch && (
                    <button
                      onClick={() => setCatalogShopSearch("")}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-base leading-none"
                    >
                      ✕
                    </button>
                  )}
                </div>
              )}
              {catalogLoading ? (
                <div className="grid grid-cols-3 gap-3">
                  {[1, 2, 3, 4, 5, 6].map(n => <div key={n} className="aspect-square bg-muted rounded-2xl animate-pulse" />)}
                </div>
              ) : (() => {
                const filtered = catalogShopSearch.trim()
                  ? catalogVendors.filter(v =>
                      (v.shopName ?? "Boutique").toLowerCase().includes(catalogShopSearch.toLowerCase()) ||
                      String(v.id).includes(catalogShopSearch.trim())
                    )
                  : catalogVendors;
                return filtered.length > 0 ? (
                <div className="grid grid-cols-3 gap-3">
                  {filtered.map((v) => (
                    <button
                      key={v.id}
                      onClick={() => { setSector(catalogSector ?? undefined); setShopNumber(v.id); }}
                      className="group flex flex-col items-center gap-1.5 p-3 bg-card rounded-2xl border border-border hover:border-primary/50 hover:shadow-md active:scale-95 transition-all"
                    >
                      <div
                        className="w-14 h-14 rounded-full border-2 border-border group-hover:border-primary/40 transition-colors flex-shrink-0 bg-muted flex items-center justify-center"
                        style={v.profilePhoto ? {
                          backgroundImage: `url(${resolveImageUrl(v.profilePhoto)})`,
                          backgroundSize: "cover",
                          backgroundPosition: "center",
                        } : undefined}
                      >
                        {!v.profilePhoto && <UserCircle2 className="w-8 h-8 text-muted-foreground" />}
                      </div>
                      <span className="text-xs font-semibold text-foreground leading-tight text-center line-clamp-2 w-full">
                        {v.shopName || "Boutique"}
                      </span>
                      <span className="text-[10px] text-muted-foreground font-medium bg-muted/80 px-2 py-0.5 rounded-full">
                        N°{v.id}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="text-center py-20">
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-muted mb-4">
                    <Search className="w-8 h-8 text-muted-foreground" />
                  </div>
                  <p className="text-muted-foreground text-sm max-w-xs mx-auto">
                    {catalogShopSearch.trim()
                      ? (lang === "fr" ? "Aucune boutique correspond à cette recherche." : "No shop matches this search.")
                      : (lang === "fr" ? "Aucune boutique disponible dans ce secteur pour le moment." : "No shops available in this sector yet.")}
                  </p>
                </div>
              );
              })()}
            </main>
            </>

          ) : shopNumber ? (
            /* ── ARTICLES DE LA BOUTIQUE SÉLECTIONNÉE ── */
            <>
              <div className="sticky top-0 z-20 bg-background/95 backdrop-blur-sm border-b border-border/60 px-4 py-2.5 flex items-center gap-3">
                <button
                  onClick={() => setShopNumber(undefined)}
                  className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground active:scale-95 transition-all"
                >
                  <span className="text-base">←</span>
                  <span>{lang === "fr" ? "Retour aux boutiques" : "Back to shops"}</span>
                </button>
                {pageData?.vendorName && (
                  <>
                    <span className="text-muted-foreground/40">|</span>
                    <span className="text-sm font-bold truncate">{pageData.vendorName}</span>
                  </>
                )}
              </div>
            <main className="container mx-auto px-4 py-6 flex-grow">
              {isLoading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                  {[1, 2, 3].map(n => (
                    <div key={n} className="rounded-xl border bg-card overflow-hidden h-[400px] flex flex-col">
                      <div className="h-[200px] bg-muted animate-pulse" />
                      <div className="p-4 flex flex-col gap-3 flex-grow">
                        <div className="h-6 bg-muted rounded w-3/4 animate-pulse" />
                        <div className="h-5 bg-muted rounded w-1/3 animate-pulse" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : sortedListings.length > 0 ? (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                    {sortedListings.map(listing => (
                      <ListingCard key={listing.id} listing={listing} isAdmin={quickMode} adminPassword={quickMode ? (loadAdminSession()?.code ?? "") : ""} commissionRate={commissionRate} whatsappCommission={whatsappCommission} isOwn={vendor ? listing.phone === vendor.phone : false} onOpenInMessages={handleOpenInMessages} />
                    ))}
                  </div>
                  {pageData?.hasMore && (
                    <div className="flex justify-center mt-10">
                      <Button variant="outline" onClick={handleLoadMore} disabled={isFetching} className="rounded-full px-8 font-semibold">
                        {isFetching ? t.loading : t.loadMore}
                      </Button>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-20">
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-muted mb-4">
                    <Search className="w-8 h-8 text-muted-foreground" />
                  </div>
                  <h3 className="text-xl font-semibold mb-2">
                    {pageData?.vendorName
                      ? (lang === "fr" ? `Boutique N°${shopNumber}` : `Shop #${shopNumber}`)
                      : t.noShop}
                  </h3>
                  <p className="text-muted-foreground max-w-sm mx-auto text-sm">
                    {pageData?.vendorName
                      ? (lang === "fr" ? "Cette boutique n'a pas encore d'annonces publiées." : "This shop has no published listings yet.")
                      : (lang === "fr" ? `Aucune boutique N°${shopNumber}.` : `No shop #${shopNumber}.`)}
                  </p>
                </div>
              )}
            </main>
            </>
          ) : null}

          {/* Footer */}
          <footer className="mt-auto border-t bg-card py-8">
            <div className="container mx-auto px-4 text-center space-y-3">
              <p className="text-muted-foreground text-sm">
                © 2026 TogoMarket. Tous droits réservés.
              </p>
              <button
                onClick={() => openWhatsApp(`https://wa.me/22870703131?text=${encodeURIComponent("Bonjour, je souhaite contacter l'administrateur de TogoMarket.")}`)}
                className="inline-flex items-center gap-2 bg-green-500 hover:bg-green-600 text-white text-sm font-semibold px-5 py-2.5 rounded-full transition-colors shadow-sm"
              >
                <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current" xmlns="http://www.w3.org/2000/svg">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                </svg>
                Contacter l'Administrateur
              </button>
            </div>
          </footer>
        </>
      )}

      {/* ── MARKET PLACE TAB ──────────────────────────────────────────── */}
      {activeTab === "marketplace" && (
        <>
          {/* Hero Section */}
          <section className="relative h-[220px] sm:h-[280px] w-full flex items-center justify-center overflow-hidden">
            <div className="absolute inset-0 z-0">
              <img
                src="https://images.unsplash.com/photo-1555529669-e69e7aa0ba9a?q=80&w=1200"
                alt="Lomé Market"
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-black/60 mix-blend-multiply" />
            </div>
            <div className="relative z-10 w-full max-w-2xl px-4 text-center">
              <h1 className="text-2xl sm:text-4xl font-extrabold text-white mb-4 drop-shadow-md">
                {t.tagline}
              </h1>
              <div className="flex flex-col items-center gap-3 max-w-xl mx-auto w-full">
                {/* Toggle pill */}
                <div className="flex bg-white/20 backdrop-blur-sm rounded-full p-1 gap-1">
                  <button
                    type="button"
                    onClick={() => setHeroMode("article")}
                    className={`px-6 py-2 rounded-full text-sm font-semibold transition-all ${
                      heroMode === "article"
                        ? "bg-white text-foreground shadow"
                        : "text-white hover:bg-white/10"
                    }`}
                  >
                    {lang === "fr" ? "Article" : "Article"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setHeroMode("boutique")}
                    className={`px-6 py-2 rounded-full text-sm font-semibold transition-all ${
                      heroMode === "boutique"
                        ? "bg-white text-foreground shadow"
                        : "text-white hover:bg-white/10"
                    }`}
                  >
                    {lang === "fr" ? "Boutique" : "Shop"}
                  </button>
                </div>

                {/* Barre active */}
                {heroMode === "article" ? (
                  <form onSubmit={handleSearchSubmit} className="relative flex items-center w-full">
                    <SearchIcon className="absolute left-4 w-5 h-5 text-muted-foreground" />
                    <Input
                      type="text"
                      placeholder={t.searchArticlePlaceholder}
                      value={searchInput}
                      onChange={(e) => setSearchInput(e.target.value)}
                      className="w-full pl-12 pr-24 h-12 rounded-full text-base bg-white border-0 shadow-lg focus-visible:ring-primary"
                    />
                    <Button type="submit" className="absolute right-1.5 h-9 rounded-full bg-accent hover:bg-accent/90 text-accent-foreground px-5 font-semibold text-sm">
                      {t.search}
                    </Button>
                  </form>
                ) : (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const num = parseInt(shopSearchInput.trim(), 10);
                      if (!isNaN(num) && num > 0) {
                        setShopNumber(num);
                        setCatalogSector(null);
                        setCatalogVendors([]);
                        setSearch("");
                        setSearchInput("");
                        setActiveTab("stand");
                      }
                    }}
                    className="relative flex items-center w-full"
                  >
                    <span className="absolute left-4 text-muted-foreground font-bold text-sm select-none">N°</span>
                    <Input
                      type="number"
                      min={1}
                      placeholder={lang === "fr" ? "Numéro de boutique..." : "Shop number..."}
                      value={shopSearchInput}
                      onChange={(e) => setShopSearchInput(e.target.value)}
                      className="w-full pl-10 pr-24 h-12 rounded-full text-base bg-white border-0 shadow-lg focus-visible:ring-primary"
                    />
                    <Button type="submit" className="absolute right-1.5 h-9 rounded-full bg-accent hover:bg-accent/90 text-accent-foreground px-5 font-semibold text-sm">
                      {lang === "fr" ? "Voir" : "View"}
                    </Button>
                  </form>
                )}
              </div>
            </div>
          </section>

          <AdBanner />
          <main className="container mx-auto px-4 py-6 flex-grow">
          {search ? (
            <div className="flex items-center gap-2 mb-4">
              <button
                onClick={() => { setSearch(""); setSearchInput(""); }}
                className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
              >
                ← {lang === "fr" ? "Retour aux articles" : "Back to listings"}
              </button>
              <span className="text-sm font-medium">« {search} »</span>
            </div>
          ) : (
            <h2 className="text-lg font-bold mb-5">{lang === "fr" ? "Tous les articles" : "All listings"}</h2>
          )}
          {mpLoading && mpPage === 1 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {[1, 2, 3].map((n) => (
                <div key={n} className="rounded-xl border bg-card overflow-hidden h-[400px] flex flex-col">
                  <div className="h-[200px] bg-muted animate-pulse" />
                  <div className="p-4 flex flex-col gap-3 flex-grow">
                    <div className="h-6 bg-muted rounded w-3/4 animate-pulse" />
                    <div className="h-5 bg-muted rounded w-1/3 animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
          ) : mpListings.length > 0 ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {mpListings.map((listing) => (
                  <ListingCard
                    key={listing.id}
                    listing={listing}
                    isAdmin={quickMode}
                    adminPassword={quickMode ? (loadAdminSession()?.code ?? "") : ""}
                    commissionRate={commissionRate}
                    whatsappCommission={whatsappCommission}
                    isOwn={vendor ? listing.phone === vendor.phone : false}
                    onOpenInMessages={handleOpenInMessages}
                  />
                ))}
              </div>
              {mpHasMore && (
                <div className="flex justify-center mt-10">
                  <Button
                    variant="outline"
                    onClick={() => setMpPage((p) => p + 1)}
                    disabled={mpFetching}
                    className="rounded-full px-8 font-semibold"
                  >
                    {mpFetching ? t.loading : t.loadMore}
                  </Button>
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-20">
              <p className="text-muted-foreground text-sm">{t.noListings}</p>
            </div>
          )}
        </main>
        </>
      )}

      {/* ── ÉVÉNEMENTIEL TAB ─────────────────────────────────────────── */}
      {activeTab === "evenementiel" && <EvenementielView />}

      {/* ── SERVICES TAB ─────────────────────────────────────────────── */}
      {activeTab === "services" && <ServicesView />}

      {/* ── ARTICLE INTROUVABLE TAB ──────────────────────────────────── */}
      {activeTab === "introuvable" && (
        <div className="flex flex-col items-center justify-center py-16 px-6 text-center flex-grow">
          <div className="w-20 h-20 rounded-full bg-secondary/10 flex items-center justify-center mb-6">
            <svg className="w-10 h-10 text-secondary" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
            </svg>
          </div>
          <h2 className="text-2xl font-bold mb-3">{t.introuvableTitle}</h2>
          <p className="text-muted-foreground mb-8 max-w-xs leading-relaxed">
            {t.introuvableDesc}
          </p>
          <Button
            onClick={() => setIsOrderModalOpen(true)}
            className="h-14 px-10 text-base font-bold rounded-2xl shadow-xl bg-secondary hover:bg-secondary/90 text-white"
          >
            {t.orderNow}
          </Button>
          <p className="text-xs text-muted-foreground mt-6 max-w-xs">
            {t.introuvableNote}
          </p>
        </div>
      )}

      {/* ── MESSAGES TAB ──────────────────────────────────────────────── */}
      {activeTab === "messages" && (
        <main className="container mx-auto px-4 py-6 flex-grow">
          {vendor && vendorPassword ? (
            /* ── Onglet vendeur (+ section acheteur si identifié) ───── */
            <>
              <PushActivationBanner vendor={vendor} vendorPassword={vendorPassword} />
              <VendorSystemNotifications
                key={tabRefreshKey}
                vendor={vendor}
                vendorPassword={vendorPassword}
                onUnreadChange={setSystemNotifsUnread}
              />
              <VendorConversations
                key={tabRefreshKey}
                vendor={vendor}
                vendorPassword={vendorPassword}
                onUnreadChange={setConvsUnread}
              />
              {/* ── Section acheteur : visible si ce vendeur a aussi
                   des conversations en tant qu'acheteur chez d'autres vendeurs ── */}
              {buyerIdentity && (
                <div className="mt-8 pt-6 border-t">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">
                    {lang === "fr" ? "Mes achats" : "My purchases"}
                  </p>
                  <BuyerInbox
                    key={`buyer-${tabRefreshKey}`}
                    identity={buyerIdentity}
                    pendingConvId={pendingConvId}
                    onClearPending={() => setPendingConvId(null)}
                  />
                </div>
              )}
            </>
          ) : buyerIdentity ? (
            /* ── Onglet acheteur identifié ──────────────────────────── */
            <BuyerInbox
              key={tabRefreshKey}
              identity={buyerIdentity}
              pendingConvId={pendingConvId}
              onClearPending={() => setPendingConvId(null)}
            />
          ) : (
            /* ── Ni vendeur ni acheteur : inviter à s'identifier ─────── */
            <div className="flex flex-col items-center justify-center py-24 text-center gap-4">
              <MessageCircle className="w-14 h-14 text-muted-foreground/40" />
              <h3 className="text-lg font-semibold">
                {lang === "fr" ? "Vos messages" : "Your messages"}
              </h3>
              <p className="text-sm text-muted-foreground max-w-xs">
                {lang === "fr"
                  ? "Cliquez sur « Discuter » sur n'importe quel article pour démarrer une conversation, ou connectez-vous à votre compte vendeur."
                  : "Tap \"Contact seller\" on any listing to start a conversation, or log in to your vendor account."}
              </p>
              <Button
                className="rounded-full px-8 mt-2"
                onClick={() => setIsAuthModalOpen(true)}
              >
                {t.login}
              </Button>
            </div>
          )}
        </main>
      )}

      {/* ── AI ASSISTANT ──────────────────────────────────────────────── */}
      <AiAssistant lang={lang} />

      {/* ── BOTTOM NAVIGATION ─────────────────────────────────────────── */}
      <BottomNav
        activeTab={activeTab}
        onTabChange={(tab) => {
          sessionStorage.setItem("tm_active_tab", tab);
          if (tab === activeTab) {
            // Retaper l'onglet actif → rafraîchir son contenu
            setTabRefreshKey((k) => k + 1);
          } else {
            setActiveTab(tab);
          }
        }}
        messagesUnread={messagesUnread}
      />

      {/* ── MODALS ────────────────────────────────────────────────────── */}
      <PublishModal
        open={isPublishModalOpen}
        onOpenChange={setIsPublishModalOpen}
        vendor={vendor}
        vendorPassword={vendorPassword}
        onNeedLogin={() => setIsAuthModalOpen(true)}
        onVendorRefresh={(updated) => {
          setVendor(updated);
          saveSession(updated, vendorPassword);
        }}
      />
      <OrderModal open={isOrderModalOpen} onOpenChange={setIsOrderModalOpen} whatsappOrders={whatsappOrders} />
      <AuthModal
        open={isAuthModalOpen}
        onOpenChange={setIsAuthModalOpen}
        onLoginSuccess={handleLoginSuccess}
        referredBy={referredBy}
      />
      {vendor && (
        <ProfileSettingsModal
          open={isProfileModalOpen}
          onOpenChange={setIsProfileModalOpen}
          vendor={vendor}
          vendorPassword={vendorPassword}
          onVendorUpdate={handleVendorUpdate}
          onLogout={handleLogout}
        />
      )}
    </div>
  );
}
