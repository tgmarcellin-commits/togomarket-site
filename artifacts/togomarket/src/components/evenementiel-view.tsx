import { useState } from "react";
import { useGetEvents, useGetAdminSettings, type Event } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Calendar, MapPin, Ticket, ExternalLink } from "lucide-react";
import { openWhatsApp } from "@/lib/whatsapp";
import { useSiteSettings } from "@/lib/site-settings";
import { useT } from "@/lib/i18n";
import { resolveImageUrl } from "@/lib/image";
import { ImageViewer } from "@/components/image-viewer";
import { SmartVideo } from "@/components/smart-video";

function ShareButtons({ text, url }: { text: string; url: string }) {
  const waHref = `https://wa.me/?text=${encodeURIComponent(text)}`;
  const fbHref = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}&quote=${encodeURIComponent(text)}`;
  return (
    <div className="flex items-center gap-1.5">
      <a
        href={waHref}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="w-8 h-8 flex items-center justify-center rounded-full bg-[#25D366] hover:bg-[#1eb355] transition-colors"
        title="Partager sur WhatsApp"
      >
        <svg viewBox="0 0 24 24" className="w-4 h-4 fill-white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.123.554 4.114 1.526 5.843L.057 23.617a.5.5 0 0 0 .611.64l5.975-1.566A11.945 11.945 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.885 0-3.645-.52-5.148-1.426l-.369-.221-3.821 1.001.982-3.713-.24-.381A9.944 9.944 0 0 1 2 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/></svg>
      </a>
      <a
        href={fbHref}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="w-8 h-8 flex items-center justify-center rounded-full bg-[#1877F2] hover:bg-[#0f65d8] transition-colors"
        title="Partager sur Facebook"
      >
        <svg viewBox="0 0 24 24" className="w-4 h-4 fill-white"><path d="M24 12.073C24 5.404 18.627 0 12 0S0 5.404 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.41c0-3.025 1.792-4.697 4.533-4.697 1.312 0 2.686.236 2.686.236v2.97h-1.513c-1.491 0-1.956.93-1.956 1.886v2.267h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"/></svg>
      </a>
    </div>
  );
}

function EventDetailModal({ event, open, onClose, locale, t }: {
  event: Event | null;
  open: boolean;
  onClose: () => void;
  locale: string;
  t: ReturnType<typeof useT>;
}) {
  if (!event) return null;

  const eventDate = new Date(event.date);
  const formattedDate = eventDate.toLocaleDateString(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const formattedTime = eventDate.toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
  });

  const shareText = `🎉 ${event.title}\n📅 ${formattedDate} ${t.at} ${formattedTime}\n📍 ${event.location}${event.ticketPrice ? `\n🎟️ ${t.entry} : ${event.ticketPrice}` : ""}\n\nDécouvrez cet événement sur TogoMarket : ${window.location.origin}`;
  const shareUrl = window.location.origin;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[440px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="pr-6">{event.title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {event.flyerImage && (
            <div className="w-full rounded-xl overflow-hidden" style={{ maxHeight: 250 }}>
              <img
                src={resolveImageUrl(event.flyerImage)}
                alt={event.title}
                className="w-full object-cover"
                style={{ maxHeight: 250 }}
              />
            </div>
          )}
          {event.videoPath && (
            <SmartVideo
              src={resolveImageUrl(event.videoPath)}
              mode="player"
              className="w-full rounded-xl"
              style={{ maxHeight: 224 }}
            />
          )}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <Calendar className="w-4 h-4 text-primary flex-shrink-0" />
              <span>{formattedDate} {t.at} {formattedTime}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <MapPin className="w-4 h-4 text-primary flex-shrink-0" />
              <span>{event.location}</span>
            </div>
            {event.ticketPrice && (
              <div className="flex items-center gap-2 text-sm">
                <Ticket className="w-4 h-4 text-primary flex-shrink-0" />
                <span>{t.entry} : <strong>{event.ticketPrice}</strong></span>
              </div>
            )}
          </div>
          <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">
            {event.description}
          </p>
          <div className="flex items-center justify-between pt-1">
            <span className="text-xs text-muted-foreground">{t.shareViaWhatsApp} / Facebook</span>
            <ShareButtons text={shareText} url={shareUrl} />
          </div>
          {event.ticketLink && (
            <Button
              className="w-full gap-2"
              onClick={() => openWhatsApp(event.ticketLink!)}
            >
              <ExternalLink className="w-4 h-4" />
              {t.buyTickets}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function EvenementielView() {
  const { lang } = useSiteSettings();
  const t = useT(lang);
  const locale = t.dateLocale;
  const { data: events, isLoading } = useGetEvents();
  const { data: settings } = useGetAdminSettings();
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [viewerImage, setViewerImage] = useState<string | null>(null);
  const whatsappAds = settings?.whatsappAds ?? "22870703131";

  const submitText = lang === "fr"
    ? "🎉 Bonjour TogoMarket, je souhaite soumettre un événement. Pouvez-vous m'indiquer la marche à suivre ?"
    : "🎉 Hello TogoMarket, I would like to submit an event. Can you guide me?";

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-6 max-w-2xl space-y-4">
        {[1, 2].map((n) => (
          <div key={n} className="rounded-xl border bg-card h-48 animate-pulse" />
        ))}
      </div>
    );
  }

  if (!events || events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
        <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
          <Calendar className="w-8 h-8 text-muted-foreground" />
        </div>
        <h2 className="text-xl font-bold mb-2">{t.noEvents}</h2>
        <p className="text-muted-foreground max-w-xs text-sm mb-6">{t.noEventsDesc}</p>
        <a
          href={`https://wa.me/${whatsappAds}?text=${encodeURIComponent(submitText)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 bg-[#25D366] hover:bg-[#1eb355] text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          <svg viewBox="0 0 24 24" className="w-4 h-4 fill-white flex-shrink-0"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.123.554 4.114 1.526 5.843L.057 23.617a.5.5 0 0 0 .611.64l5.975-1.566A11.945 11.945 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.885 0-3.645-.52-5.148-1.426l-.369-.221-3.821 1.001.982-3.713-.24-.381A9.944 9.944 0 0 1 2 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/></svg>
          {t.submitEventCta}
        </a>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-6 max-w-2xl">
      <h2 className="font-bold text-lg mb-4">{t.events}</h2>
      <div className="space-y-4">
        {events.map((event) => {
          const eventDate = new Date(event.date);
          // Passé = expiré à 00h le lendemain du jour de la date de fin (ou de la date)
          const endRef = new Date((event as typeof event & { endDate?: string | null }).endDate || event.date);
          endRef.setHours(24, 0, 0, 0);
          const isPast = endRef.getTime() <= Date.now();
          const formattedDate = eventDate.toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" });
          const shareText = `🎉 ${event.title}\n📅 ${formattedDate}\n📍 ${event.location}${event.ticketPrice ? `\n🎟️ ${t.entry} : ${event.ticketPrice}` : ""}\n\nDécouvrez sur TogoMarket : ${window.location.origin}`;
          const shareUrl = window.location.origin;
          return (
            <div key={event.id} className={`rounded-xl border bg-card overflow-hidden ${isPast ? "opacity-60" : ""}`}>
              {event.flyerImage && (
                <button
                  type="button"
                  className="w-full overflow-hidden cursor-zoom-in focus:outline-none"
                  style={{ maxHeight: 200 }}
                  onClick={() => setViewerImage(event.flyerImage!)}
                >
                  <img
                    src={resolveImageUrl(event.flyerImage)}
                    alt={event.title}
                    className="w-full object-cover"
                    style={{ maxHeight: 200, width: "100%" }}
                  />
                </button>
              )}
              <div className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-bold text-base leading-tight">{event.title}</h3>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {isPast && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                        {t.past}
                      </span>
                    )}
                    <ShareButtons text={shareText} url={shareUrl} />
                  </div>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Calendar className="w-3.5 h-3.5" />
                  <span>{formattedDate}</span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <MapPin className="w-3.5 h-3.5" />
                  <span>{event.location}</span>
                </div>
                {event.ticketPrice && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Ticket className="w-3.5 h-3.5" />
                    <span>{event.ticketPrice}</span>
                  </div>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-1"
                  onClick={() => setSelectedEvent(event)}
                >
                  {t.seeMore}
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-6 rounded-xl border border-primary/20 bg-primary/5 p-4 text-center">
        <Calendar className="w-7 h-7 text-primary mx-auto mb-2" />
        <p className="text-sm font-semibold mb-0.5">{t.submitEventCta}</p>
        <p className="text-xs text-muted-foreground mb-3">{t.submitEventDesc}</p>
        <a
          href={`https://wa.me/${whatsappAds}?text=${encodeURIComponent(submitText)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 bg-[#25D366] hover:bg-[#1eb355] text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          <svg viewBox="0 0 24 24" className="w-4 h-4 fill-white flex-shrink-0"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.123.554 4.114 1.526 5.843L.057 23.617a.5.5 0 0 0 .611.64l5.975-1.566A11.945 11.945 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.885 0-3.645-.52-5.148-1.426l-.369-.221-3.821 1.001.982-3.713-.24-.381A9.944 9.944 0 0 1 2 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/></svg>
          {t.submitEventCta}
        </a>
      </div>

      <EventDetailModal
        event={selectedEvent}
        open={!!selectedEvent}
        onClose={() => setSelectedEvent(null)}
        locale={locale}
        t={t}
      />

      {viewerImage && (
        <ImageViewer
          images={[viewerImage]}
          startIndex={0}
          onClose={() => setViewerImage(null)}
        />
      )}
    </div>
  );
}
