import type { Lang } from "./site-settings";

const translations = {
  fr: {
    // Navbar
    login: "Connexion",
    publish: "Publier",
    // Hero
    tagline: "Le marché qui vient à vous",
    searchArticlePlaceholder: "Que recherchez-vous aujourd'hui ?",
    searchShopPlaceholder: "Numéro de la boutique",
    search: "Chercher",
    see: "Voir",
    article: "Article",
    shop: "Boutique",
    // Category bar
    all: "Tout voir",
    // Stats
    listingsAvailable: (n: number) => `${n} annonce${n > 1 ? "s" : ""} disponible${n > 1 ? "s" : ""}`,
    // Bottom nav
    navBoutique: "Boutique",
    navMarket: "Market Place",
    navAds: "Publicité",
    navEvents: "Événementiel",
    navLost: "Introuvable",
    // Load more
    loadMore: "Voir plus",
    loading: "Chargement...",
    noListings: "Aucune annonce trouvée.",
    noShop: "Boutique introuvable.",
    // Listing card
    contact: "Voir le contact",
    report: "Signaler",
    // Boutique view
    myListings: "Mes annonces",
    published: "Publiées",
    pending: "En attente",
    shopNumber: (n: number) => `N°${n}`,
  },
  en: {
    // Navbar
    login: "Login",
    publish: "Sell",
    // Hero
    tagline: "The market that comes to you",
    searchArticlePlaceholder: "What are you looking for today?",
    searchShopPlaceholder: "Shop number",
    search: "Search",
    see: "View",
    article: "Item",
    shop: "Shop",
    // Category bar
    all: "View all",
    // Stats
    listingsAvailable: (n: number) => `${n} listing${n > 1 ? "s" : ""} available`,
    // Bottom nav
    navBoutique: "My Shop",
    navMarket: "Marketplace",
    navAds: "Ads",
    navEvents: "Events",
    navLost: "Can't find it",
    // Load more
    loadMore: "Load more",
    loading: "Loading...",
    noListings: "No listings found.",
    noShop: "Shop not found.",
    // Listing card
    contact: "View contact",
    report: "Report",
    // Boutique view
    myListings: "My listings",
    published: "Published",
    pending: "Pending",
    shopNumber: (n: number) => `#${n}`,
  },
} as const;

export function useT(lang: Lang) {
  return translations[lang];
}

export type T = ReturnType<typeof useT>;
