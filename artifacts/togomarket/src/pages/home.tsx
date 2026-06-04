import { useState, useRef, useEffect, useCallback } from "react";
import { openWhatsApp } from "@/lib/whatsapp";
import {
  useGetListings,
  getGetListingsQueryKey,
  useGetStats,
  useGetAdminSettings,
  type VendorProfile,
  type Listing,
} from "@workspace/api-client-react";
import { Search, SearchIcon, LogIn, UserCircle2, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ListingCard } from "@/components/listing-card";
import { PublishModal } from "@/components/publish-modal";
import { OrderModal } from "@/components/order-modal";
import { AdminModal } from "@/components/admin-modal";
import { AuthModal } from "@/components/auth-modal";
import { InstallPrompt } from "@/components/install-prompt";
import { AdBanner } from "@/components/ad-banner";
import { BottomNav, type NavTab } from "@/components/bottom-nav";
import { BoutiqueView } from "@/components/boutique-view";
import { PubliciteView } from "@/components/publicite-view";
import { EvenementielView } from "@/components/evenementiel-view";
import { ProfileSettingsModal } from "@/components/profile-settings-modal";
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

export default function Home() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [sector, setSector] = useState<string | undefined>(undefined);
  const [activeTab, setActiveTab] = useState<NavTab>("marketplace");

  const [isPublishModalOpen, setIsPublishModalOpen] = useState(false);
  const [isOrderModalOpen, setIsOrderModalOpen] = useState(false);
  const [isAdminModalOpen, setIsAdminModalOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [logoTapCount, setLogoTapCount] = useState(0);
  const logoTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isAdmin, setIsAdmin] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");

  const [vendor, setVendor] = useState<VendorProfile | null>(null);
  const [vendorPassword, setVendorPassword] = useState("");

  const [page, setPage] = useState(1);
  const [loadedListings, setLoadedListings] = useState<Listing[]>([]);

  useEffect(() => {
    const session = loadSession();
    if (session) {
      setVendor(session.vendor);
      setVendorPassword(session.password);
    }
  }, []);

  const { data: pageData, isLoading, isFetching } = useGetListings(
    { search, sector, page },
    { query: { queryKey: getGetListingsQueryKey({ search, sector, page }) } }
  );
  const { data: stats } = useGetStats();
  const { data: settings } = useGetAdminSettings();
  const commissionRate = settings?.commissionRate ?? 2;
  const whatsappCommission = settings?.whatsappCommission ?? "22870703131";
  const whatsappOrders = settings?.whatsappOrders ?? "22870703131";

  useEffect(() => {
    setPage(1);
    setLoadedListings([]);
  }, [search, sector]);

  useEffect(() => {
    if (!pageData) return;
    if (page === 1) {
      setLoadedListings(pageData.items);
    } else {
      setLoadedListings((prev) => [...prev, ...pageData.items]);
    }
  }, [pageData, page]);

  const handleLoadMore = useCallback(() => {
    setPage((p) => p + 1);
  }, []);

  const sortedListings = loadedListings;

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput);
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
    setActiveTab("marketplace");
  };

  const handleVendorUpdate = (updated: VendorProfile, newPassword?: string) => {
    setVendor(updated);
    const pwd = newPassword ?? vendorPassword;
    setVendorPassword(pwd);
    saveSession(updated, pwd);
  };

  const categories = [
    { label: "Tout voir", value: undefined },
    { label: "AgriMarket 🌿", value: "AgriMarket" },
    { label: "Immobilier 🏢", value: "Immobilier" },
    { label: "Automobile 🚗", value: "Automobile" },
    { label: "Divers 📦", value: "Divers" },
  ];

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background pb-[72px]">
      <InstallPrompt />

      {isAdmin && (
        <div className="bg-primary text-primary-foreground text-center py-1 text-xs font-bold uppercase tracking-widest">
          Mode Admin activé
        </div>
      )}

      {/* Sticky Navbar */}
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 shadow-sm">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div
            className="flex items-center gap-2 cursor-pointer"
            onClick={() => {
              setActiveTab("marketplace");
              setSector(undefined);
              setSearch("");
              setSearchInput("");
              const next = logoTapCount + 1;
              setLogoTapCount(next);
              if (logoTapTimer.current) clearTimeout(logoTapTimer.current);
              if (next >= 5) {
                setLogoTapCount(0);
                setIsAdminModalOpen(true);
              } else {
                logoTapTimer.current = setTimeout(() => setLogoTapCount(0), 2000);
              }
            }}
          >
            <img src="/logo.jpg" alt="TogoMarket" className="h-9 w-9 rounded-lg object-cover flex-shrink-0" />
            <span className="font-bold text-2xl tracking-tight">
              <span className="text-foreground">Togo</span>
              <span className="text-primary">Market</span>
            </span>
          </div>

          {/* Auth / Publish buttons */}
          <div className="flex items-center gap-2">
            {vendor ? (
              <>
                <Button
                  onClick={() => setIsPublishModalOpen(true)}
                  className="bg-primary hover:bg-primary/90 rounded-full font-semibold px-5"
                >
                  Publier
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
                className="rounded-full font-semibold px-5 gap-2"
              >
                <LogIn className="w-4 h-4" />
                Connexion
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* ── MARKETPLACE TAB (default) ─────────────────────────────────── */}
      {activeTab === "marketplace" && (
        <>
          {/* Hero Section */}
          <section className="relative h-[300px] sm:h-[400px] w-full flex items-center justify-center overflow-hidden">
            <div className="absolute inset-0 z-0">
              <img
                src="https://images.unsplash.com/photo-1555529669-e69e7aa0ba9a?q=80&w=1200"
                alt="Lomé Market"
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-black/60 mix-blend-multiply" />
            </div>

            <div className="relative z-10 w-full max-w-2xl px-4 text-center">
              <h1 className="text-3xl sm:text-5xl font-extrabold text-white mb-6 drop-shadow-md">
                Le marché qui vient à vous
              </h1>
              <form
                onSubmit={handleSearchSubmit}
                className="relative flex items-center max-w-xl mx-auto"
              >
                <SearchIcon className="absolute left-4 w-5 h-5 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Que recherchez-vous aujourd'hui ?"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  className="w-full pl-12 pr-24 h-14 rounded-full text-base bg-white border-0 shadow-lg focus-visible:ring-primary"
                />
                <Button
                  type="submit"
                  className="absolute right-1.5 h-11 rounded-full bg-accent hover:bg-accent/90 text-accent-foreground px-6 font-semibold"
                >
                  Chercher
                </Button>
              </form>
            </div>
          </section>

          {/* Stats Banner */}
          {stats && (
            <div className="bg-muted py-3 border-b">
              <div className="container mx-auto px-4 flex justify-center text-sm font-medium text-muted-foreground">
                <span className="bg-white px-4 py-1.5 rounded-full shadow-sm border border-border/50">
                  <span className="text-primary font-bold">{stats.total}</span> annonces disponibles
                </span>
              </div>
            </div>
          )}

          <AdBanner />

          {/* Category Filter Bar */}
          <div className="border-b bg-background sticky top-16 z-40">
            <div className="container mx-auto px-4">
              <div className="flex overflow-x-auto py-4 gap-2 scrollbar-hide snap-x">
                {categories.map((cat) => (
                  <button
                    key={cat.label}
                    onClick={() => setSector(cat.value)}
                    className={`snap-start whitespace-nowrap px-5 py-2 rounded-full text-sm font-semibold transition-colors border ${
                      sector === cat.value
                        ? "bg-foreground text-background border-foreground shadow-sm"
                        : "bg-background text-foreground border-border hover:bg-muted"
                    }`}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Main Content */}
          <main className="container mx-auto px-4 py-8 flex-grow">
            {isLoading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <div
                    key={n}
                    className="rounded-xl border bg-card overflow-hidden h-[400px] flex flex-col"
                  >
                    <div className="h-[200px] bg-muted animate-pulse" />
                    <div className="p-4 flex flex-col gap-3 flex-grow">
                      <div className="h-6 bg-muted rounded w-3/4 animate-pulse" />
                      <div className="h-5 bg-muted rounded w-1/3 animate-pulse" />
                      <div className="h-4 bg-muted rounded w-1/2 mt-2 animate-pulse" />
                      <div className="mt-auto h-10 bg-muted rounded w-full animate-pulse" />
                    </div>
                  </div>
                ))}
              </div>
            ) : sortedListings.length > 0 ? (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                  {sortedListings.map((listing) => (
                    <ListingCard
                      key={listing.id}
                      listing={listing}
                      isAdmin={isAdmin}
                      adminPassword={adminPassword}
                      commissionRate={commissionRate}
                      whatsappCommission={whatsappCommission}
                      isOwn={vendor ? listing.phone === vendor.phone : false}
                    />
                  ))}
                </div>
                {pageData?.hasMore && (
                  <div className="flex justify-center mt-10">
                    <Button
                      variant="outline"
                      onClick={handleLoadMore}
                      disabled={isFetching}
                      className="rounded-full px-8 font-semibold"
                    >
                      {isFetching ? "Chargement…" : "Charger plus d'annonces"}
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-20">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-muted mb-4">
                  <Search className="w-8 h-8 text-muted-foreground" />
                </div>
                <h3 className="text-xl font-semibold mb-2">Aucun article trouvé</h3>
                <p className="text-muted-foreground max-w-sm mx-auto">
                  Nous n'avons trouvé aucun article correspondant à votre recherche. Essayez d'autres
                  mots-clés ou commandez-le !
                </p>
              </div>
            )}
          </main>

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

      {/* ── BOUTIQUE TAB ─────────────────────────────────────────────── */}
      {activeTab === "boutique" && (
        <BoutiqueView
          vendor={vendor}
          vendorPassword={vendorPassword}
          onNeedLogin={() => setIsAuthModalOpen(true)}
        />
      )}

      {/* ── PUBLICITÉ TAB ─────────────────────────────────────────────── */}
      {activeTab === "publicite" && <PubliciteView />}

      {/* ── ÉVÉNEMENTIEL TAB ─────────────────────────────────────────── */}
      {activeTab === "evenementiel" && <EvenementielView />}

      {/* ── ARTICLE INTROUVABLE TAB ──────────────────────────────────── */}
      {activeTab === "introuvable" && (
        <div className="flex flex-col items-center justify-center py-16 px-6 text-center flex-grow">
          <div className="w-20 h-20 rounded-full bg-secondary/10 flex items-center justify-center mb-6">
            <svg className="w-10 h-10 text-secondary" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
            </svg>
          </div>
          <h2 className="text-2xl font-bold mb-3">Article introuvable ?</h2>
          <p className="text-muted-foreground mb-8 max-w-xs leading-relaxed">
            Vous ne trouvez pas ce que vous cherchez ? Notre équipe le déniche pour vous dans tout le Togo !
          </p>
          <Button
            onClick={() => setIsOrderModalOpen(true)}
            className="h-14 px-10 text-base font-bold rounded-2xl shadow-xl bg-secondary hover:bg-secondary/90 text-white"
          >
            Commander maintenant
          </Button>
          <p className="text-xs text-muted-foreground mt-6 max-w-xs">
            Décrivez l'article et notre équipe vous contacte sous 24h via WhatsApp.
          </p>
        </div>
      )}

      {/* ── BOTTOM NAVIGATION ─────────────────────────────────────────── */}
      <BottomNav activeTab={activeTab} onTabChange={setActiveTab} />

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
      <AdminModal
        open={isAdminModalOpen}
        onOpenChange={setIsAdminModalOpen}
        isAdmin={isAdmin}
        adminPassword={adminPassword}
        onSuccess={(pwd) => {
          setIsAdmin(true);
          setAdminPassword(pwd);
        }}
      />
      <AuthModal
        open={isAuthModalOpen}
        onOpenChange={setIsAuthModalOpen}
        onLoginSuccess={handleLoginSuccess}
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
