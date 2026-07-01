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

function WaBtn({ contact, label }: { contact: string; label: string }) {
  const digits = contact.replace(/\D/g, "");
  const href = `https://wa.me/${digits}`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 bg-[#25D366] hover:bg-[#1eb355] text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
      onClick={(e) => e.stopPropagation()}
    >
      <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-white flex-shrink-0">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
        <path d="M12 0C5.373 0 0 5.373 0 12c0 2.123.554 4.114 1.526 5.843L.057 23.617a.5.5 0 0 0 .611.64l5.975-1.566A11.945 11.945 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.885 0-3.645-.52-5.148-1.426l-.369-.221-3.821 1.001.982-3.713-.24-.381A9.944 9.944 0 0 1 2 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z" />
      </svg>
      {label}
    </a>
  );
}

function typeConfig(type: string, lang: string) {
  if (type === "offer") return {
    label: lang === "fr" ? "Offre d'emploi" : "Job offer",
    icon: Building2,
    bg: "bg-blue-100 text-blue-600",
    badge: "bg-blue-100 text-blue-700",
    waLabel: lang === "fr" ? "Postuler via WhatsApp" : "Apply via WhatsApp",
  };
  if (type === "atelier") return {
    label: lang === "fr" ? "Atelier" : "Workshop",
    icon: Wrench,
    bg: "bg-purple-100 text-purple-600",
    badge: "bg-purple-100 text-purple-700",
    waLabel: lang === "fr" ? "Contacter l'atelier" : "Contact workshop",
  };
  return {
    label: lang === "fr" ? "Cherche emploi" : "Job seeker",
    icon: User,
    bg: "bg-orange-100 text-orange-600",
    badge: "bg-orange-100 text-orange-700",
    waLabel: lang === "fr" ? "Contacter via WhatsApp" : "Contact via WhatsApp",
  };
}

function ServiceCard({ service, lang }: { service: Service; lang: string }) {
  const [open, setOpen] = useState(false);
  const cfg = typeConfig(service.type, lang);
  const Icon = cfg.icon;
  const expiresAt = new Date(service.expiresAt);
  const daysLeft = Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));

  return (
    <>
      <button
        className="w-full text-left rounded-xl border bg-card hover:shadow-md transition-shadow overflow-hidden"
        onClick={() => setOpen(true)}
      >
        {/* Flyer image for ateliers */}
        {service.type === "atelier" && service.image && (
          <img
            src={resolveImageUrl(service.image)}
            alt={service.title}
            className="w-full h-36 object-cover"
          />
        )}
        <div className="p-4 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${cfg.bg}`}>
                <Icon className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <span className={`text-[10px] font-bold uppercase tracking-wide ${cfg.badge.split(" ")[1]}`}>
                  {cfg.label}
                </span>
                <p className="text-sm font-semibold leading-tight truncate">{service.title}</p>
              </div>
            </div>
            <span className="text-[10px] text-muted-foreground flex-shrink-0 mt-1">{daysLeft}j</span>
          </div>
          <p className="text-xs text-muted-foreground line-clamp-2">{service.description}</p>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <MapPin className="w-3 h-3 flex-shrink-0" />
            <span className="truncate">{service.quartier}, {service.ville}</span>
          </div>
        </div>
        <div className="px-4 pb-3 flex justify-end" onClick={(e) => e.stopPropagation()}>
          <WaBtn contact={service.contact} label={cfg.waLabel} />
        </div>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[420px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="pr-6">{service.title}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {service.type === "atelier" && service.image && (
              <img
                src={resolveImageUrl(service.image)}
                alt={service.title}
                className="w-full rounded-lg object-contain max-h-48 bg-black/5"
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
              {lang === "fr" ? "Expire le" : "Expires"} {expiresAt.toLocaleDateString(lang === "fr" ? "fr-FR" : "en-US", { day: "numeric", month: "long", year: "numeric" })}
            </div>
            <WaBtn contact={service.contact} label={cfg.waLabel} />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ServicesView() {
  const { lang } = useSiteSettings();
  const t = useT(lang);
  const { data: services, isLoading } = useGetServices();
  const { data: settings } = useGetAdminSettings();
  const [filter, setFilter] = useState<"all" | "offer" | "seeker" | "atelier">("all");
  const whatsappServices = settings?.whatsappServices ?? "22870703131";

  const submitText = lang === "fr"
    ? "🔍 Bonjour TogoMarket, je souhaite soumettre une annonce de service. Pouvez-vous m'indiquer la marche à suivre ?"
    : "🔍 Hello TogoMarket, I'd like to submit a service listing. Can you guide me?";

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-6 max-w-2xl space-y-4">
        {[1, 2, 3].map((n) => (
          <div key={n} className="rounded-xl border bg-card h-28 animate-pulse" />
        ))}
      </div>
    );
  }

  const offers = services?.filter((s) => s.type === "offer") ?? [];
  const seekers = services?.filter((s) => s.type === "seeker") ?? [];
  const ateliers = services?.filter((s) => s.type === "atelier") ?? [];
  const all = services ?? [];

  const filtered =
    filter === "offer" ? offers :
    filter === "seeker" ? seekers :
    filter === "atelier" ? ateliers :
    all;

  const tabs: { id: "all" | "offer" | "seeker" | "atelier"; label: string }[] = [
    { id: "all", label: lang === "fr" ? `Tout (${all.length})` : `All (${all.length})` },
    { id: "offer", label: lang === "fr" ? `Offres (${offers.length})` : `Jobs (${offers.length})` },
    { id: "atelier", label: lang === "fr" ? `Ateliers (${ateliers.length})` : `Workshops (${ateliers.length})` },
    { id: "seeker", label: lang === "fr" ? `Chercheurs (${seekers.length})` : `Seekers (${seekers.length})` },
  ];

  return (
    <div className="container mx-auto px-4 py-6 max-w-2xl">
      <h2 className="font-bold text-lg mb-1">{t.navServices}</h2>
      <p className="text-xs text-muted-foreground mb-4">{t.servicesDesc}</p>

      {/* Filter tabs */}
      <div className="flex gap-1.5 mb-4 overflow-x-auto pb-1">
        {tabs.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setFilter(id)}
            className={`flex-shrink-0 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
              filter === id
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background border-border hover:bg-muted"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
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

      {/* Submit CTA */}
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
    </div>
  );
}
