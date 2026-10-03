import type { ReactNode } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowLeft, FileText } from "lucide-react";

/** Article : bloc principal numéroté. */
function Article({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="bg-card border rounded-2xl p-6 space-y-4">
      <h3 className="font-bold text-lg text-primary">{title}</h3>
      <div className="space-y-4 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}

/** Clause : sous-paragraphe d'un article. */
function Clause({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <h4 className="font-semibold text-foreground">{title}</h4>
      {children}
    </div>
  );
}

const strong = "text-foreground";

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
            <p className="text-muted-foreground text-sm">
              Conditions Générales d'Utilisation — Vendeurs, acheteurs et livreurs
            </p>
            <p className="text-muted-foreground text-xs mt-1">Dernière mise à jour : octobre 2026</p>
          </div>

          {/* ─── Article 1 : abonnement vendeur (inchangé) ─── */}
          <Article title="Article 1 – Tarifs et Frais de Transaction">
            <Clause title="1.1 Prix de l'abonnement">
              <p>
                L'accès aux fonctionnalités de vente de TogoMarket est soumis à un abonnement mensuel de{" "}
                <strong className={strong}>1 000 F CFA net</strong> pour la plateforme.
              </p>
            </Clause>
            <Clause title="1.2 Prise en charge des frais de paiement">
              <p>
                Les paiements sont sécurisés et traités par notre partenaire agréé{" "}
                <strong className={strong}>FedaPay</strong>. Afin de garantir le maintien et la
                qualité des services de TogoMarket, l'intégralité des frais techniques de transaction
                (frais appliqués par les opérateurs de Mobile Money ou les réseaux bancaires) est
                supportée par le <strong className={strong}>vendeur (client final)</strong>.
              </p>
            </Clause>
          </Article>

          <section className="bg-muted/40 rounded-2xl p-6 space-y-3">
            <h3 className="font-bold">Période d'essai gratuite</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Tout nouveau vendeur bénéficie automatiquement d'une <strong className={strong}>période
              d'essai gratuite de 30 jours</strong> dès la création de son compte. À l'expiration de cette
              période, un abonnement mensuel de 1 000 FCFA est requis pour maintenir la boutique active et
              visible sur la marketplace.
            </p>
          </section>

          <section className="bg-muted/40 rounded-2xl p-6 space-y-3">
            <h3 className="font-bold">Système de parrainage</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Chaque vendeur dispose d'un lien d'affiliation unique. Lorsqu'un nouveau vendeur s'inscrit via
              ce lien, la boutique parrain <strong className={strong}>gagne automatiquement 3 jours
              supplémentaires</strong> sur sa propre date d'expiration.
            </p>
          </section>

          {/* ─── Livraison TogoMarket ─── */}
          <Article title="Article 2 – La livraison TogoMarket">
            <Clause title="2.1 Déroulement">
              <p>La livraison se déroule dans la messagerie, en plusieurs étapes :</p>
              <ol className="list-decimal pl-5 space-y-1">
                <li>l'acheteur et le vendeur confirment le même prix pour l'article ; toute modification réinitialise les deux confirmations ;</li>
                <li>chacun partage sa position GPS ;</li>
                <li>l'acheteur choisit un livreur disponible, qui accepte ou refuse la course ;</li>
                <li>l'acheteur paie la course ; le livreur ne part qu'une fois le paiement confirmé ;</li>
                <li>la livraison est confirmée par QR code, puis l'argent est réparti.</li>
              </ol>
            </Clause>
            <Clause title="2.2 Position GPS obligatoire">
              <p>
                Pour calculer la course et indiquer au livreur où aller, l'acheteur et le vendeur doivent
                <strong className={strong}> activer la localisation de leur téléphone et partager leur position</strong>.
                Sans position, le prix ne peut pas être validé et aucun livreur ne peut être choisi. Ces positions sont
                traitées selon notre{" "}
                <a href="/privacy.html" className="text-primary underline underline-offset-2">Politique de confidentialité</a>
                {" "}(effacement automatique après 24 heures pour l'acheteur et le vendeur).
              </p>
            </Clause>
            <Clause title="2.3 Informations transmises au livreur">
              <p>
                Avant d'accepter, le livreur voit la description de l'article, son prix, la distance entre le vendeur et
                l'acheteur, sa rémunération et les frais de retour possibles. Les positions exactes, les noms et les numéros
                de téléphone du vendeur et de l'acheteur ne lui sont transmis qu'une fois la course acceptée et payée.
              </p>
            </Clause>
          </Article>

          <Article title="Article 3 – Prix, commission et paiement de la course">
            <Clause title="3.1 Prix de l'article">
              <p>Le prix de l'article est verrouillé dès que l'acheteur et le vendeur l'ont tous deux confirmé.</p>
            </Clause>
            <Clause title="3.2 Course du livreur">
              <p>
                La course est calculée à <strong className={strong}>50 FCFA par kilomètre</strong>, sur la distance entre le
                vendeur et l'acheteur déterminée à partir de leurs positions, puis figée pour la course. Elle est
                entièrement à la charge de l'acheteur.
              </p>
            </Clause>
            <Clause title="3.3 Commission TogoMarket">
              <p>
                TogoMarket perçoit une commission fixe de <strong className={strong}>500 FCFA par livraison</strong>, répartie à parts
                égales : <strong className={strong}>250 FCFA payés par l'acheteur</strong> (ajoutés au total de la course) et{" "}
                <strong className={strong}>250 FCFA déduits du reversement du vendeur</strong>.
              </p>
            </Clause>
            <Clause title="3.4 Total payé par l'acheteur">
              <p>
                L'acheteur paie : le prix de l'article + la course du livreur + 250 FCFA de commission. Les frais de la
                passerelle de paiement FedaPay peuvent s'ajouter au moment du paiement ; le montant exact est affiché avant
                validation.
              </p>
            </Clause>
            <Clause title="3.5 Paiement avant départ et séquestre">
              <p>
                Le paiement est effectué par l'acheteur via FedaPay après l'acceptation du livreur. Seule la confirmation du
                paiement autorise le départ du livreur. Les sommes versées sont conservées en séquestre par TogoMarket jusqu'à
                la confirmation de la livraison.
              </p>
            </Clause>
            <Clause title="3.6 Délai de paiement">
              <p>
                L'acheteur dispose d'environ <strong className={strong}>10 minutes</strong> après l'acceptation du livreur pour payer.
                Passé ce délai sans paiement, la course est annulée, le livreur redevient disponible et la commande peut être
                confiée à un autre livreur. Le livreur peut aussi annuler lui-même la course une fois ce délai écoulé.
              </p>
            </Clause>
          </Article>

          <Article title="Article 4 – Confirmation de la livraison par QR code">
            <p>
              À l'arrivée, le livreur présente depuis son espace un QR code à usage unique, valable quelques minutes et
              délivré uniquement si la course est payée. L'acheteur le scanne avec son téléphone, à proximité du livreur
              (300 mètres au maximum).
            </p>
            <p>
              <strong className={strong}>Sans scan valide, la livraison n'est pas définitive.</strong> Le livreur ne peut pas confirmer
              lui-même sa livraison. Une fois la livraison confirmée, TogoMarket verse au vendeur le prix de l'article moins
              250 FCFA, au livreur le prix de la course, et conserve la commission.
            </p>
          </Article>

          <Article title="Article 5 – Acheteur absent et retours">
            <p>
              Si le livreur ne peut pas remettre la commande, il la rapporte au vendeur. Le retour est confirmé par le
              scan d'un QR code par le vendeur, à proximité du livreur. Dans ce cas :
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>le transport aller et la commission de 250 FCFA de l'acheteur ne sont pas remboursés, car le service a été rendu ;</li>
              <li>le trajet retour du livreur est payé sur le prix de l'article récupéré, dans la limite de ce prix ;</li>
              <li>si ce prix ne suffit pas, le livreur perçoit le montant restant et <strong className={strong}>TogoMarket n'avance aucun complément</strong> ;</li>
              <li>le reste éventuel est crédité au portefeuille de l'acheteur, qui ne peut jamais devenir négatif ;</li>
              <li>le vendeur ne perçoit pas de paiement pour une vente retournée.</li>
            </ul>
            <p>Des règles particulières peuvent s'appliquer aux produits périssables et aux repas.</p>
          </Article>

          <Article title="Article 6 – Portefeuille virtuel et retraits">
            <p>
              Les vendeurs, les livreurs et les acheteurs disposent d'un portefeuille TogoMarket qui enregistre les montants
              qui leur reviennent : reversement des ventes, rémunération des courses, crédit après un retour.
            </p>
            <p>
              Le solde disponible peut être retiré vers un compte Mobile Money, après vérification par code à usage unique
              (OTP). Des plafonds de retrait s'appliquent aux acheteurs (par opération, par jour et sur un mois glissant) ;
              ils sont fixés par TogoMarket et peuvent évoluer. Au-delà, le retrait est soumis à une validation manuelle.
            </p>
          </Article>

          <Article title="Article 7 – Litiges et remboursements">
            <p>
              Une livraison confirmée par QR code est <strong className={strong}>définitive</strong> : aucun remboursement
              automatique n'est possible. En cas de fraude ou d'erreur grave, l'acheteur ou le vendeur peut ouvrir un dossier
              de litige en contactant TogoMarket par WhatsApp au{" "}
              <a href="https://wa.me/22870703131" className="text-primary underline underline-offset-2">+228 70 70 31 31</a>.
              Le dossier est examiné manuellement par l'administration, avec traçabilité complète des échanges et des
              opérations.
            </p>
          </Article>

          <Article title="Article 8 – Obligations des livreurs">
            <p>
              Les livreurs sont enrôlés par l'administration de TogoMarket, qui vérifie leur identité. En acceptant des
              courses, le livreur s'engage à :
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>accepter la rémunération de 50 FCFA par kilomètre pour l'aller, et la règle de paiement plafonné du retour décrite à l'article 5 ;</li>
              <li>activer la localisation de son téléphone pendant les courses, afin que l'acheteur et le vendeur puissent suivre la livraison ;</li>
              <li>utiliser les positions et les contacts reçus uniquement pour effectuer la course concernée ;</li>
              <li>ne jamais confirmer lui-même une livraison ;</li>
              <li>signaler sans délai tout imprévu qui l'empêche de livrer, afin que la course puisse être confiée à un autre livreur.</li>
            </ul>
            <p>
              Un livreur qui ne termine pas une course ne perçoit aucune rémunération automatique pour celle-ci. Une
              proposition de course qui n'est pas acceptée dans le délai indiqué expire et est annulée.
            </p>
          </Article>

          <Article title="Article 9 – Notation des livreurs">
            <p>
              Après une livraison confirmée, l'acheteur peut noter le livreur de 1 à 5 étoiles et laisser un commentaire.
              Une seule note est possible par livraison. La note moyenne du livreur est visible des acheteurs lors du choix
              du livreur. TogoMarket peut retirer un commentaire contraire aux présentes conditions.
            </p>
          </Article>

          <Article title="Article 10 – Données personnelles">
            <p>
              Les données collectées pour la livraison (positions GPS, contacts, paiements, notes) sont traitées selon notre{" "}
              <a href="/privacy.html" className="text-primary underline underline-offset-2">Politique de confidentialité</a>,
              qui précise ce qui est collecté, qui y accède et combien de temps cela est conservé.
            </p>
          </Article>

          <section className="bg-blue-50 border border-blue-100 rounded-2xl p-6">
            <p className="text-xs text-blue-700 leading-relaxed">
              En créant un compte vendeur sur TogoMarket, ou en utilisant la livraison en tant qu'acheteur ou livreur, vous
              acceptez l'intégralité des présentes Conditions Générales d'Utilisation ainsi que notre Politique de
              Confidentialité. Ces conditions peuvent être mises à jour — la version en vigueur est toujours consultable sur
              cette page.
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
