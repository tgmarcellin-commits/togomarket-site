import { useState } from "react";
import { useGetEvents, type Event } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Calendar, MapPin, Ticket, ExternalLink } from "lucide-react";
import { openWhatsApp } from "@/lib/whatsapp";

function EventDetailModal({ event, open, onClose }: { event: Event | null; open: boolean; onClose: () => void }) {
  if (!event) return null;

  const eventDate = new Date(event.date);
  const formattedDate = eventDate.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const formattedTime = eventDate.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[440px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="pr-6">{event.title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {event.flyerImage && (
            <img
              src={event.flyerImage}
              alt={event.title}
              className="w-full rounded-xl max-h-[250px] object-cover"
            />
          )}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <Calendar className="w-4 h-4 text-primary flex-shrink-0" />
              <span>{formattedDate} à {formattedTime}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <MapPin className="w-4 h-4 text-primary flex-shrink-0" />
              <span>{event.location}</span>
            </div>
            {event.ticketPrice && (
              <div className="flex items-center gap-2 text-sm">
                <Ticket className="w-4 h-4 text-primary flex-shrink-0" />
                <span>Entrée : <strong>{event.ticketPrice}</strong></span>
              </div>
            )}
          </div>
          <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">
            {event.description}
          </p>
          {event.ticketLink && (
            <Button
              className="w-full gap-2"
              onClick={() => openWhatsApp(event.ticketLink!)}
            >
              <ExternalLink className="w-4 h-4" />
              Réserver / Acheter des billets
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function EvenementielView() {
  const { data: events, isLoading } = useGetEvents();
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);

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
        <h2 className="text-xl font-bold mb-2">Aucun événement à venir</h2>
        <p className="text-muted-foreground max-w-xs text-sm">
          Revenez bientôt pour découvrir les prochains événements TogoMarket.
        </p>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-6 max-w-2xl">
      <h2 className="font-bold text-lg mb-4">Événements</h2>
      <div className="space-y-4">
        {events.map((event) => {
          const eventDate = new Date(event.date);
          const isPast = eventDate < new Date();
          return (
            <div key={event.id} className={`rounded-xl border bg-card overflow-hidden ${isPast ? "opacity-60" : ""}`}>
              {event.flyerImage && (
                <img
                  src={event.flyerImage}
                  alt={event.title}
                  className="w-full h-44 object-cover"
                />
              )}
              <div className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-bold text-base leading-tight">{event.title}</h3>
                  {isPast && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground flex-shrink-0">
                      Passé
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Calendar className="w-3.5 h-3.5" />
                  <span>
                    {eventDate.toLocaleDateString("fr-FR", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}
                  </span>
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
                  Voir plus
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <EventDetailModal
        event={selectedEvent}
        open={!!selectedEvent}
        onClose={() => setSelectedEvent(null)}
      />
    </div>
  );
}
