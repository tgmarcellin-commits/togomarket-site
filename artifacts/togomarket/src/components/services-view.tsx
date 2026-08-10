import { useState } from "react";
import {
  useGetServices,
  useGetAdminSettings,
  type Service,
} from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Briefcase, MapPin, User, Building2, Wrench } from "lucide-react";
import { resolveImageUrl } from "@/lib/image";
import { useSiteSettings } from "@/lib/site-settings";
import { useT } from "@/lib/i18n";
import { SmartVideo } from "@/components/smart-video";
import { ImageViewer } from "@/components/image-viewer";

const WA_ICON = (
  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-white flex-shrink-0">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
    <path d="M12 0C5.373 0 0 5.373 0 12c0 2.123.554 4.114 1.526 5.843L.057 23.617a.5.5 0 0 0 .611.64l5.975-1.566A11.945 11.945 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.885 0-3.645-.52-5.148-1.426l-.369-.221-3.821 1.001.982-3.713-.24-.381A9.944 9.944 0 0 1 2 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z" />
  </svg>
);

/* ── WhatsApp button ──────────────────────────────────────────────────────── */
function WaBtn({
  contact,
  label,
  fullWidth = false,
}: {
  contact: string;
  label: string;
  fullWidth?: boolean;
}) {
  const digits = contact.replace(/\D/g, "");
  return (
    <a
      href={`https://wa.me/${digits}`}
      target="_blank"
      rel="noopener noreferrer"
      className={`${fullWidth ? "flex w-full" : "inline-flex"} items-center justify-center gap-1.5 bg-[#25D366] hover:bg-[#1eb355] active:bg-[#17a048] text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors`}
      onClick={(e) => e.stopPropagation()}
    >
      {WA_ICON}
      <span className="truncate">{label}</span>
    </a>
  );
}

/* ── Type config ──────────────────────────────────────────────────────────── */
type ServiceType = "offer" | "seeker" | "atelier";

function typeConfig(type: string, lang: string) {
  if (type === "offer") return {
    label: lang === "fr" ? "Offre d'emploi" : "Job offer",
    icon: Building2,
    bg: "bg-blue-100 text-blue-600",
    badge: "bg-blue-100 text-blue-700",
    waLabel: lang === "fr" ? "Postuler via WhatsApp" : "Apply via WhatsApp",
  };
  if (type === "atelier") return {
    label: lang === "fr" ? "Institut" : "Institute",
    icon: Wrench,
    bg: "bg-purple-100 text-purple-600",
    badge: "bg-purple-100 text-purple-700",
    waLabel: lang === "fr" ? "Contacter l'institut" : "Contact institute",
  };
  return {
    label: lang === "fr" ? "Cherche emploi" : "Job seeker",
    icon: User,
    bg: "bg-orange-100 text-orange-600",
    badge: "bg-orange-100 text-orange-700",
    waLabel: lang === "fr" ? "Contacter via WhatsApp" : "Contact via WhatsApp",
  };
}

/* ── Catalog categories ───────────────────────────────────────────────────── */
const SERVICE_CATEGORIES: {
  type: ServiceType;
  labelFr: string;
  labelEn: string;
  emoji: string;
  descFr: string;
  descEn: string;
  colorBg: string;
  colorText: string;
}[] = [
  {
    type: "offer",
    labelFr: "Offres",
    labelEn: "Jobs",
    emoji: "💼",
    descFr: "Postes à pourvoir",
    descEn: "Job openings",
    colorBg: "bg-blue-50 hover:bg-blue-100 border-blue-200 hover:border-blue-400",
    colorText: "text-blue-700",
  },
  {
    type: "atelier",
    labelFr: "Institut",
    labelEn: "Institute",
    emoji: "🏛️",
    descFr: "Instituts & formations",
    descEn: "Institutes & training",
    colorBg: "bg-purple-50 hover:bg-purple-100 border-purple-200 hover:border-purple-400",
    colorText: "text-purple-700",
  },
  {
    type: "seeker",
    labelFr: "Chercheur",
    labelEn: "Seeker",
    emoji: "👤",
    descFr: "Demandeurs d'emploi",
    descEn: "Job seekers",
    colorBg: "bg-orange-50 hover:bg-orange-100 border-orange-200 hover:border-orange-400",
    colorText: "text-orange-700",
  },
];

/* ── Service card ─────────────────────────────────────────────────────────── */
function ServiceCard({ service, lang }: { service: Service; lang: string }) {
  const [open, setOpen] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const cfg = typeConfig(service.type, lang);
  const Icon = cfg.icon;
  const expiresAt = new Date(service.expiresAt);

  return (
    <>
      {/* Card: deux colonnes strictes — photo | infos+bouton */}
      <div className="rounded-xl border bg-card shadow-sm overflow-hidden hover:shadow-md transition-shadow">
        <div className="flex min-h-[130px]">

          {/* Colonne gauche : photo (largeur fixe, hauteur full) */}
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="w-[130px] flex-shrink-0 self-stretch focus:outline-none overflow-hidden"
            aria-label={service.title}
          >
            {service.image ? (
              <img
                src={resolveImageUrl(service.image)}
                alt={service.title}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className={`w-full h-full flex items-center justify-center ${cfg.bg}`}>
                <Icon className="w-10 h-10 opacity-50" />
              </div>
            )}
          </button>

          {/* Colonne droite : titre + méta + description + bouton WhatsApp */}
          <div className="flex-1 min-w-0 flex flex-col p-3 gap-1">
            {/* Zone cliquable pour le détail */}
            <button
              type="button"
              className="flex-1 text-left min-w-0"
              onClick={() => setOpen(true)}
            >
              <p className="font-semibold text-sm leading-snug line-clamp-2 pr-1">
                {service.title}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {cfg.label} · {service.ville}
              </p>
              <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2 leading-relaxed">
                {service.description}
              </p>
            </button>

            {/* Bouton WhatsApp — reste dans la colonne droite */}
            <div className="pt-2">
              <WaBtn contact={service.contact} label={cfg.waLabel} fullWidth />
            </div>
          </div>
        </div>
      </div>

      {/* Dialog détail */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="sm:max-w-[420px] max-h-[90vh] overflow-y-auto"
          onPointerDownOutside={(e) => { if (viewerOpen) e.preventDefault(); }}
          onInteractOutside={(e) => { if (viewerOpen) e.preventDefault(); }}
          onEscapeKeyDown={(e) => { if (viewerOpen) e.preventDefault(); }}
        >
          <DialogHeader>
            <DialogTitle className="pr-6">{service.title}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {service.image && (
              <img
                src={resolveImageUrl(service.image)}
                alt={service.title}
                className="w-full h-56 rounded-lg object-cover bg-black/5 cursor-zoom-in"
                onClick={() => setViewerOpen(true)}
              />
            )}
            {service.videoPath && (
              <SmartVideo
                src={resolveImageUrl(service.videoPath)}
                mode="player"
                className="w-full rounded-lg"
                style={{ maxHeight: 224 }}
              />
            )}
            <span className={`inline-block text-xs font-bold px-2.5 py-1 rounded-full ${cfg.badge}`}>
              {cfg.label}
            </span>
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{service.description}</p>
            <div className="flex items-center gap-2 text-sm text-muted-foreground border-t pt-2">
              <MapPin className="w-4 h-4 text-primary flex-shrink-0" />
              <span>{service.quartier}, {service.ville}</span>
            </div>
            <div className="text-xs text-muted-foreground">
              {lang === "fr" ? "Expire le" : "Expires"}{" "}
              {expiresAt.toLocaleDateString(lang === "fr" ? "fr-FR" : "en-US", {
                day: "numeric", month: "long", year: "numeric",
              })}
            </div>
            <WaBtn contact={service.contact} label={cfg.waLabel} fullWidth />
          </div>

          {/* Visionneuse plein écran (rendue dans le dialog pour rester interactive) */}
          {viewerOpen && service.image && (
            <ImageViewer
              images={[service.image]}
              startIndex={0}
              onClose={() => setViewerOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ── Main component ───────────────────────────────────────────────────────── */
export function ServicesView() {
  const { lang } = useSiteSettings();
  const t = useT(lang);
  const { data: services, isLoading } = useGetServices();
  const { data: settings } = useGetAdminSettings();
  const [activeType, setActiveType] = useState<ServiceType | null>(null);
  const whatsappServices = settings?.whatsappServices ?? "22870703131";

  const submitText = lang === "fr"
    ? "🔍 Bonjour TogoMarket, je souhaite soumettre une annonce de service. Pouvez-vous m'indiquer la marche à suivre ?"
    : "🔍 Hello TogoMarket, I'd like to submit a service listing. Can you guide me?";

  const filtered = activeType ? (services ?? []).filter((s) => s.type === activeType) : [];

  const activeCat = SERVICE_CATEGORIES.find((c) => c.type === activeType);

  const SubmitCta = () => (
    <div className="mt-6 rounded-xl border border-primary/20 bg-primary/5 p-4 text-center">
      <Briefcase className="w-7 h-7 text-primary mx-auto mb-2" />
      <p className="text-sm font-semibold mb-0.5">{t.submitServiceCta}</p>
      <p className="text-xs text-muted-foreground mb-3">{t.submitServiceDesc}</p>
      <a
        href={`https://wa.me/${whatsappServices}?text=${encodeURIComponent(submitText)}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 bg-[#25D366] hover:bg-[#1eb355] text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
      >
        <svg viewBox="0 0 24 24" className="w-4 h-4 fill-white flex-shrink-0">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
          <path d="M12 0C5.373 0 0 5.373 0 12c0 2.123.554 4.114 1.526 5.843L.057 23.617a.5.5 0 0 0 .611.64l5.975-1.566A11.945 11.945 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.885 0-3.645-.52-5.148-1.426l-.369-.221-3.821 1.001.982-3.713-.24-.381A9.944 9.944 0 0 1 2 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z" />
        </svg>
        {t.submitServiceCta}
      </a>
    </div>
  );

  /* ── Loading skeleton ───────────────────────────────────────────────────── */
  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-6 max-w-2xl space-y-4">
        {[1, 2, 3].map((n) => (
          <div key={n} className="rounded-xl border bg-card h-28 animate-pulse" />
        ))}
      </div>
    );
  }

  /* ── Category list view ─────────────────────────────────────────────────── */
  if (activeType && activeCat) {
    return (
      <>
        {/* Sticky header */}
        <div className="sticky top-0 z-20 bg-background/95 backdrop-blur-sm border-b border-border/60 px-4 py-2.5 flex items-center gap-3">
          <button
            onClick={() => setActiveType(null)}
            className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground active:scale-95 transition-all"
          >
            <span className="text-base">←</span>
            <span>{lang === "fr" ? "Retour aux catégories" : "Back to categories"}</span>
          </button>
          <span className="text-muted-foreground/40">|</span>
          <h2 className="text-sm font-bold flex items-center gap-1.5 truncate">
            <span>{activeCat.emoji}</span>
            <span>{lang === "fr" ? activeCat.labelFr : activeCat.labelEn}</span>
          </h2>
        </div>

        <div className="container mx-auto px-4 py-6 max-w-2xl">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
                <Briefcase className="w-8 h-8 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground mb-4">{t.noServices}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map((s) => (
                <ServiceCard key={s.id} service={s} lang={lang} />
              ))}
            </div>
          )}
          <SubmitCta />
        </div>
      </>
    );
  }

  /* ── Catalog grid (default view) ────────────────────────────────────────── */
  return (
    <div className="container mx-auto px-4 py-6 max-w-2xl">
      {/* Bannière Services */}
      <div className="mb-5 rounded-2xl overflow-hidden shadow-md">
        <img
          src="/services-banner.jpg"
          alt="TogoMarket Services"
          className="w-full object-cover"
          style={{ maxHeight: "160px", objectPosition: "center" }}
        />
      </div>

      <p className="text-center text-sm text-muted-foreground mb-5 font-medium">
        {lang === "fr" ? "Choisissez une catégorie" : "Choose a category"}
      </p>

      <div className="grid grid-cols-3 gap-4 mb-6">
        {SERVICE_CATEGORIES.map((cat) => {
          const count = (services ?? []).filter((s) => s.type === cat.type).length;
          return (
            <button
              key={cat.type}
              onClick={() => setActiveType(cat.type)}
              className={`group aspect-square rounded-2xl border-2 flex flex-col items-center justify-center gap-2 transition-all shadow-sm hover:shadow-md active:scale-95 ${cat.colorBg}`}
            >
              <span className="text-4xl group-hover:scale-110 transition-transform">{cat.emoji}</span>
              <p className={`font-bold text-sm leading-tight px-1 text-center ${cat.colorText}`}>
                {lang === "fr" ? cat.labelFr : cat.labelEn}
              </p>
              <span className="text-[11px] text-muted-foreground font-medium bg-white/70 px-2 py-0.5 rounded-full">
                {count} {lang === "fr" ? "annonce" + (count !== 1 ? "s" : "") : count !== 1 ? "listings" : "listing"}
              </span>
            </button>
          );
        })}
      </div>

      <SubmitCta />
    </div>
  );
}
