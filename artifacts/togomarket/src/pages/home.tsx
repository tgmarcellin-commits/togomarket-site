import { useState } from "react";
import {
  useGetListings,
  getGetListingsQueryKey,
  useGetStats,
  useGetAdminSettings,
} from "@workspace/api-client-react";
import { Search, SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ListingCard } from "@/components/listing-card";
import { PublishModal } from "@/components/publish-modal";
import { OrderModal } from "@/components/order-modal";
import { AdminModal } from "@/components/admin-modal";
import { InstallPrompt } from "@/components/install-prompt";

export default function Home() {
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [sector, setSector] = useState<string | undefined>(undefined);

  const [isPublishModalOpen, setIsPublishModalOpen] = useState(false);
  const [isOrderModalOpen, setIsOrderModalOpen] = useState(false);
  const [isAdminModalOpen, setIsAdminModalOpen] = useState(false);

  const [isAdmin, setIsAdmin] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");

  const { data: listings, isLoading } = useGetListings(
    { search, sector },
    { query: { queryKey: getGetListingsQueryKey({ search, sector }) } }
  );
  const { data: stats } = useGetStats();
  const { data: settings } = useGetAdminSettings();
  const commissionRate = settings?.commissionRate ?? 2;

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput);
  };

  const categories = [
    { label: "Tout voir", value: undefined },
    { label: "AgriMarket 🌿", value: "AgriMarket" },
    { label: "Immobilier 🏢", value: "Immobilier" },
    { label: "Automobile 🚗", value: "Automobile" },
    { label: "Divers 📦", value: "Divers" },
  ];

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background pb-20">
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
              setSector(undefined);
              setSearch("");
              setSearchInput("");
            }}
          >
            <img src="/logo.jpg" alt="TogoMarket" className="h-9 w-9 rounded-lg object-cover flex-shrink-0" />
            <span className="font-bold text-2xl tracking-tight">
              <span className="text-foreground">Togo</span>
              <span className="text-primary">Market</span>
            </span>
          </div>
          <Button
            onClick={() => setIsPublishModalOpen(true)}
            className="bg-primary hover:bg-primary/90 rounded-full font-semibold px-6"
          >
            Vendre
          </Button>
        </div>
      </header>

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
        ) : listings && listings.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {listings.map((listing) => (
              <ListingCard
                key={listing.id}
                listing={listing}
                isAdmin={isAdmin}
                adminPassword={adminPassword}
                commissionRate={commissionRate}
              />
            ))}
          </div>
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
      <footer className="mt-auto border-t bg-card py-8 pb-32">
        <div className="container mx-auto px-4 text-center">
          <p className="text-muted-foreground text-sm mb-4">
            © 2026 TogoMarket. Tous droits réservés.
          </p>
          <button
            onClick={() => setIsAdminModalOpen(true)}
            className="text-xs text-muted-foreground/60 hover:text-foreground transition-colors"
          >
            Gérer la plateforme
          </button>
        </div>
      </footer>

      {/* Fixed Bottom Bar */}
      <div className="fixed bottom-0 left-0 w-full p-3 bg-background/80 backdrop-blur-md border-t z-50">
        <div className="container mx-auto max-w-3xl">
          <Button
            onClick={() => setIsOrderModalOpen(true)}
            className="w-full h-12 text-sm font-bold rounded-2xl shadow-xl shadow-secondary/20 bg-secondary hover:bg-secondary/90 text-white"
          >
            Article introuvable ? Commandez ici !
          </Button>
        </div>
      </div>

      {/* Modals */}
      <PublishModal open={isPublishModalOpen} onOpenChange={setIsPublishModalOpen} />
      <OrderModal open={isOrderModalOpen} onOpenChange={setIsOrderModalOpen} />
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
    </div>
  );
}
