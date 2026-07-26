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
import { Search, SearchIcon, LogIn, UserCircle2, Settings, Link2Off } from "lucide-react";
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
import { useToast } from "@/hooks/use-toast";

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
  const [activeTab, setActiveTab] = useState<NavTab>("marketplace");
  const [shopNumber, setShopNumber] = useState<number | undefined>(undefined);
  const [shopLinkExpired, setShopLinkExpired] = useState(false);
  const [referredBy, setReferredBy] = useState<number | undefined>(undefined);
  const [catalogSector, setCatalogSector] = useState<string | null>(null);
  const [catalogVendors, setCatalogVendors] = useState<VendorInSector[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [shopSearchInput, setShopSearchInput] = useState("");
  const [heroMode, setHeroMode] = useState<"article" | "boutique">("article");

  const logoClickCount = useRef(0);
  const logoClickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleLogoClick = () => {
    setActiveTab("stand");
    setSector(undefined);
    setSearch("");
    setSearchInput("");
    setCatalogSector(null);
    setCatalogVendors([]);
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
    { page: mpPage, limit: 20 },
    { query: { queryKey: getGetListingsQueryKey({ page: mpPage, limit: 20 }) } }
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

  useEffect(() => {
    if (activeTab === "marketplace") {
      setMpPage(1);
      setMpListings([]);
      mpSeenRef.current = undefined;
    }
  }, [activeTab]);

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
    setShopNumber(undefined);
    setSearch("");
    setSearchInput("");
    setSector(undefined);
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
                      src={vendor.profilePhoto}
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
              {/* Toggle Article / Boutique — visible uniquement sur l'écran catalogue */}
              {!catalogSector && !shopNumber && (
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
              )}
            </div>
          </section>

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
                          <ListingCard key={listing.id} listing={listing} isAdmin={quickMode} adminPassword={quickMode ? (loadAdminSession()?.code ?? "") : ""} commissionRate={commissionRate} whatsappCommission={whatsappCommission} isOwn={vendor ? listing.phone === vendor.phone : false} />
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

          ) : catalogSector && !shopNumber ? (
            /* ── LISTE DES BOUTIQUES DU SECTEUR ── */
            <>
              <div className="sticky top-0 z-20 bg-background/95 backdrop-blur-sm border-b border-border/60 px-4 py-2.5 flex items-center gap-3">
                <button
                  onClick={() => { setCatalogSector(null); setCatalogVendors([]); setSector(undefined); setShopNumber(undefined); }}
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
              {catalogLoading ? (
                <div className="grid grid-cols-3 gap-3">
                  {[1, 2, 3, 4, 5, 6].map(n => <div key={n} className="aspect-square bg-muted rounded-2xl animate-pulse" />)}
                </div>
              ) : catalogVendors.length > 0 ? (
                <div className="grid grid-cols-3 gap-3">
                  {catalogVendors.map((v) => (
                    <button
                      key={v.id}
                      onClick={() => { setSector(catalogSector ?? undefined); setShopNumber(v.id); }}
                      className="group flex flex-col items-center gap-1.5 p-3 bg-card rounded-2xl border border-border hover:border-primary/50 hover:shadow-md active:scale-95 transition-all"
                    >
                      {v.profilePhoto ? (
                        <img
                          src={v.profilePhoto}
                          alt={v.firstName}
                          className="w-14 h-14 rounded-full object-cover border-2 border-border group-hover:border-primary/40 transition-colors"
                        />
                      ) : (
                        <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center border-2 border-border">
                          <UserCircle2 className="w-8 h-8 text-muted-foreground" />
                        </div>
                      )}
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
                    {lang === "fr" ? "Aucune boutique disponible dans ce secteur pour le moment." : "No shops available in this sector yet."}
                  </p>
                </div>
              )}
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
                      <ListingCard key={listing.id} listing={listing} isAdmin={quickMode} adminPassword={quickMode ? (loadAdminSession()?.code ?? "") : ""} commissionRate={commissionRate} whatsappCommission={whatsappCommission} isOwn={vendor ? listing.phone === vendor.phone : false} />
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
        <AdBanner />
        <main className="container mx-auto px-4 py-6 flex-grow">
          <h2 className="text-lg font-bold mb-5">{lang === "fr" ? "Tous les articles" : "All listings"}</h2>
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

      {/* ── AI ASSISTANT ──────────────────────────────────────────────── */}
      <AiAssistant lang={lang} />

      {/* ── BOTTOM NAVIGATION ─────────────────────────────────────────── */}
      <BottomNav
        activeTab={activeTab}
        onTabChange={setActiveTab}
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
