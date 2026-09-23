import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowLeft, FileText } from "lucide-react";

export default function CGU() {
  const [, navigate] = useLocation();

  return (
    <div className="min-h-[100dvh] bg-background">
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur shadow-sm">
        <div className="container mx-auto px-4 h-14 flex items-center gap-3">
          <button onClick={() => navigate("/")} className="text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-primary" />
            <h1 className="font-bold text-base">Conditions Générales d'Utilisation</h1>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="space-y-8">
          <div className="text-center">
            <h2 className="text-2xl font-bold mb-2">TogoMarket</h2>
            <p className="text-muted-foreground text-sm">Conditions Générales d'Utilisation — Plateforme vendeurs</p>
          </div>

          <section className="bg-card border rounded-2xl p-6 space-y-4">
            <h3 className="font-bold text-lg text-primary">Article 1 – Tarifs et Frais de Transaction</h3>

            <div className="space-y-4 text-sm leading-relaxed text-muted-foreground">
              <div className="space-y-2">
                <h4 className="font-semibold text-foreground">1.1 Prix de l'abonnement</h4>
                <p>
                  L'accès aux fonctionnalités de vente de TogoMarket est soumis à un abonnement mensuel de{" "}
                  <strong className="text-foreground">1 000 F CFA net</strong> pour la plateforme.
                </p>
              </div>

              <div className="space-y-2">
                <h4 className="font-semibold text-foreground">1.2 Prise en charge des frais de paiement</h4>
                <p>
                  Les paiements sont sécurisés et traités par notre partenaire agréé{" "}
                  <strong className="text-foreground">FedaPay</strong>. Afin de garantir le maintien et la
                  qualité des services de TogoMarket, l'intégralité des frais techniques de transaction
                  (frais appliqués par les opérateurs de Mobile Money ou les réseaux bancaires) est
                  supportée par le <strong className="text-foreground">vendeur (client final)</strong>.
                </p>
              </div>
            </div>
          </section>

          <section className="bg-muted/40 rounded-2xl p-6 space-y-3">
            <h3 className="font-bold">Période d'essai gratuite</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Tout nouveau vendeur bénéficie automatiquement d'une <strong className="text-foreground">période
              d'essai gratuite de 30 jours</strong> dès la création de son compte. À l'expiration de cette
              période, un abonnement mensuel de 1 000 FCFA est requis pour maintenir la boutique active et
              visible sur la marketplace.
            </p>
          </section>

          <section className="bg-muted/40 rounded-2xl p-6 space-y-3">
            <h3 className="font-bold">Système de parrainage</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Chaque vendeur dispose d'un lien d'affiliation unique. Lorsqu'un nouveau vendeur s'inscrit via
              ce lien, la boutique parrain <strong className="text-foreground">gagne automatiquement 3 jours
              supplémentaires</strong> sur sa propre date d'expiration.
            </p>
          </section>

          <section className="bg-blue-50 border border-blue-100 rounded-2xl p-6">
            <p className="text-xs text-blue-700 leading-relaxed">
              En créant un compte vendeur sur TogoMarket, vous acceptez l'intégralité des présentes Conditions
              Générales d'Utilisation ainsi que notre Politique de Confidentialité. Ces conditions peuvent être
              mises à jour — la version en vigueur est toujours consultable sur cette page.
            </p>
          </section>

          <div className="text-center pt-4">
            <Button onClick={() => navigate("/")} variant="outline" className="rounded-full px-8">
              ← Retour à la marketplace
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
