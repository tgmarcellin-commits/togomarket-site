import { useState, useRef } from "react";
import {
  useVerifySubAdmin,
  useAdminCreateAd,
  useAdminDeleteAd,
  useAdminGetAllAds,
  useAdminCreateEvent,
  useAdminDeleteEvent,
  useGetEvents,
  getGetEventsQueryKey,
  type Ad,
  type Event as ApiEvent,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  Megaphone,
  Calendar,
  Plus,
  Trash2,
  RefreshCw,
  X,
  UploadCloud,
  MapPin,
  Ticket,
} from "lucide-react";
import { resizeImageToBlob, resolveImageUrl } from "@/lib/image";
import { uploadImageFile, uploadVideoFile } from "@/lib/upload";
import { useSiteSettings } from "@/lib/site-settings";
import { useT } from "@/lib/i18n";

interface SubAdminModalProps {
  section: "publicite" | "evenementiel";
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SubAdminModal({ section, open, onOpenChange }: SubAdminModalProps) {
  const { lang } = useSiteSettings();
  const t = useT(lang);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [pwdInput, setPwdInput] = useState("");
  const [verified, setVerified] = useState(false);
  const [storedPwd, setStoredPwd] = useState("");
  const [wrongPwd, setWrongPwd] = useState(false);

  const verifySubAdmin = useVerifySubAdmin();

  const handleVerify = () => {
    if (!pwdInput.trim()) return;
    verifySubAdmin.mutate(
      { data: { password: pwdInput.trim() } },
      {
        onSuccess: (res) => {
          if (res.valid) {
            setVerified(true);
            setStoredPwd(pwdInput.trim());
            setWrongPwd(false);
            if (section === "publicite") refetchAds();
          } else {
            setWrongPwd(true);
          }
        },
        onError: () => setWrongPwd(true),
      }
    );
  };

  const handleClose = (v: boolean) => {
    if (!v) {
      setPwdInput("");
      setVerified(false);
      setStoredPwd("");
      setWrongPwd(false);
    }
    onOpenChange(v);
  };

  /* ─── ADS STATE ─────────────────────────────────────────────────────── */
  const [allAds, setAllAds] = useState<Ad[]>([]);
  const [adsLoading, setAdsLoading] = useState(false);
  const [showAdForm, setShowAdForm] = useState(false);
  const [adForm, setAdForm] = useState({ advertiserName: "", advertiserPhone: "", message: "", image: "", imagePreview: "", videoPath: "" });
  const [adVideoUploading, setAdVideoUploading] = useState(false);
  const [adVideoName, setAdVideoName] = useState("");
  const adImageRef = useRef<HTMLInputElement>(null);
  const adVideoRef = useRef<HTMLInputElement>(null);
  const [confirmAd, setConfirmAd] = useState<number | null>(null);

  const getAllAds = useAdminGetAllAds();
  const createAd = useAdminCreateAd();
  const deleteAd = useAdminDeleteAd();

  const refetchAds = () => {
    setAdsLoading(true);
    getAllAds.mutate(
      { data: { password: storedPwd } },
      {
        onSuccess: (data) => { setAllAds(data); setAdsLoading(false); },
        onError: () => setAdsLoading(false),
      }
    );
  };

  const handleAdImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const { blob, dataUrl } = await resizeImageToBlob(file);
      const objectPath = await uploadImageFile(blob, file.name);
      setAdForm((f) => ({ ...f, image: objectPath, imagePreview: dataUrl }));
    } catch {
      setAdForm((f) => ({ ...f, image: "", imagePreview: "" }));
    }
  };

  const handleAdVideoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) {
      toast({ title: "Vidéo trop lourde (max 50 Mo)", variant: "destructive" });
      return;
    }
    setAdVideoUploading(true);
    setAdVideoName(file.name);
    try {
      const objectPath = await uploadVideoFile(file);
      setAdForm((f) => ({ ...f, videoPath: objectPath }));
    } catch {
      toast({ title: "Erreur vidéo", variant: "destructive" });
      setAdVideoName("");
    } finally {
      setAdVideoUploading(false);
    }
  };

  const handleCreateAd = () => {
    if (!adForm.advertiserName.trim() || !adForm.advertiserPhone.trim() || !adForm.message.trim()) {
      toast({ title: "Nom, téléphone et message sont requis", variant: "destructive" });
      return;
    }
    createAd.mutate(
      { data: { password: storedPwd, ...adForm } },
      {
        onSuccess: () => {
          toast({ title: "Publicité créée ✓" });
          setAdForm({ advertiserName: "", advertiserPhone: "", message: "", image: "", imagePreview: "", videoPath: "" });
          setAdVideoName("");
          setShowAdForm(false);
          refetchAds();
        },
        onError: () => toast({ title: "Erreur", variant: "destructive" }),
      }
    );
  };

  const handleDeleteAd = (id: number) => {
    deleteAd.mutate(
      { data: { id, password: storedPwd } },
      {
        onSuccess: () => { setConfirmAd(null); toast({ title: "Publicité supprimée" }); refetchAds(); },
        onError: () => toast({ title: "Erreur", variant: "destructive" }),
      }
    );
  };

  /* ─── EVENTS STATE ───────────────────────────────────────────────────── */
  const [allEvents, setAllEvents] = useState<ApiEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [showEventForm, setShowEventForm] = useState(false);
  const [eventForm, setEventForm] = useState({ title: "", description: "", date: "", location: "", ticketPrice: "", ticketLink: "", flyerImage: "", flyerPreview: "" });
  const [confirmEvent, setConfirmEvent] = useState<number | null>(null);
  const eventFlyerRef = useRef<HTMLInputElement>(null);

  const getEventsQuery = useGetEvents();
  const createEvent = useAdminCreateEvent();
  const deleteEvent = useAdminDeleteEvent();

  const refetchEvents = () => {
    setEventsLoading(true);
    getEventsQuery.refetch().then((res) => {
      setAllEvents(res.data ?? []);
      setEventsLoading(false);
    }).catch(() => setEventsLoading(false));
  };

  const handleFlyerChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const { blob, dataUrl } = await resizeImageToBlob(file);
      const objectPath = await uploadImageFile(blob, file.name);
      setEventForm((f) => ({ ...f, flyerImage: objectPath, flyerPreview: dataUrl }));
    } catch {
      setEventForm((f) => ({ ...f, flyerImage: "", flyerPreview: "" }));
    }
  };

  const handleCreateEvent = () => {
    if (!eventForm.title.trim() || !eventForm.description.trim() || !eventForm.date || !eventForm.location.trim()) {
      toast({ title: "Titre, description, date et lieu sont requis", variant: "destructive" });
      return;
    }
    createEvent.mutate(
      {
        data: {
          password: storedPwd,
          title: eventForm.title,
          description: eventForm.description,
          date: eventForm.date,
          location: eventForm.location,
          ticketPrice: eventForm.ticketPrice || undefined,
          ticketLink: eventForm.ticketLink || undefined,
          flyerImage: eventForm.flyerImage || undefined,
        },
      },
      {
        onSuccess: () => {
          toast({ title: "Événement créé ✓" });
          setEventForm({ title: "", description: "", date: "", location: "", ticketPrice: "", ticketLink: "", flyerImage: "", flyerPreview: "" });
          setShowEventForm(false);
          queryClient.invalidateQueries({ queryKey: getGetEventsQueryKey() });
          refetchEvents();
        },
        onError: () => toast({ title: "Erreur", variant: "destructive" }),
      }
    );
  };

  const handleDeleteEvent = (id: number) => {
    deleteEvent.mutate(
      { data: { id, password: storedPwd } },
      {
        onSuccess: () => {
          setConfirmEvent(null);
          toast({ title: "Événement supprimé" });
          queryClient.invalidateQueries({ queryKey: getGetEventsQueryKey() });
          refetchEvents();
        },
        onError: () => toast({ title: "Erreur", variant: "destructive" }),
      }
    );
  };

  const title = section === "publicite" ? t.subAdminAdsTitle : t.subAdminEventsTitle;
  const Icon = section === "publicite" ? Megaphone : Calendar;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[460px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className="w-4 h-4 text-violet-600" />
            {title}
          </DialogTitle>
        </DialogHeader>

        {/* ── PASSWORD GATE ──────────────────────────────────────────── */}
        {!verified ? (
          <div className="space-y-4 pt-2">
            <p className="text-sm text-muted-foreground">{t.subAdminTitle}</p>
            <Input
              type="password"
              placeholder={t.subAdminPwdPlaceholder}
              value={pwdInput}
              onChange={(e) => { setPwdInput(e.target.value); setWrongPwd(false); }}
              onKeyDown={(e) => e.key === "Enter" && handleVerify()}
              className={wrongPwd ? "border-destructive" : ""}
              autoFocus
            />
            {wrongPwd && <p className="text-xs text-destructive">{t.subAdminWrongPwd}</p>}
            <Button
              className="w-full bg-violet-600 hover:bg-violet-700 text-white"
              onClick={handleVerify}
              disabled={verifySubAdmin.isPending || !pwdInput.trim()}
            >
              {verifySubAdmin.isPending ? "Vérification..." : "Accéder"}
            </Button>
          </div>
        ) : section === "publicite" ? (
          /* ── ADS SECTION ────────────────────────────────────────────── */
          <div className="space-y-3 pt-1">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Publicités ({allAds.length})</p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={refetchAds} className="h-7 px-2">
                  <RefreshCw className="w-3.5 h-3.5" />
                </Button>
                <Button size="sm" onClick={() => setShowAdForm(!showAdForm)} className="h-7 px-2 gap-1 bg-violet-600 hover:bg-violet-700 text-white">
                  <Plus className="w-3.5 h-3.5" />
                  Ajouter
                </Button>
              </div>
            </div>

            {showAdForm && (
              <div className="border rounded-lg p-3 space-y-2 bg-muted/30">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Nouvelle publicité — 30 jours</p>
                <Input placeholder="Nom de l'annonceur *" value={adForm.advertiserName} onChange={(e) => setAdForm((f) => ({ ...f, advertiserName: e.target.value }))} className="h-8 text-sm" />
                <Input placeholder="Téléphone annonceur *" value={adForm.advertiserPhone} onChange={(e) => setAdForm((f) => ({ ...f, advertiserPhone: e.target.value }))} className="h-8 text-sm" />
                <Input placeholder="Message publicitaire *" value={adForm.message} onChange={(e) => setAdForm((f) => ({ ...f, message: e.target.value }))} className="h-8 text-sm" />
                <div className="flex flex-wrap gap-2">
                  <input ref={adImageRef} type="file" accept="image/*" onChange={handleAdImageChange} className="hidden" />
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => adImageRef.current?.click()}>
                    {adForm.image ? "Photo ✓" : "Photo"}
                  </Button>
                  {adForm.imagePreview && <img src={adForm.imagePreview} alt="" className="w-8 h-8 rounded object-cover border" />}
                  <input ref={adVideoRef} type="file" accept="video/*" onChange={handleAdVideoChange} className="hidden" disabled={adVideoUploading} />
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => adVideoRef.current?.click()} disabled={adVideoUploading}>
                    {adVideoUploading ? "Envoi..." : adForm.videoPath ? "Vidéo ✓" : "Vidéo"}
                  </Button>
                  {adForm.videoPath && (
                    <button type="button" onClick={() => { setAdForm((f) => ({ ...f, videoPath: "" })); setAdVideoName(""); }} className="text-[10px] text-red-500 underline">Retirer</button>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" className="flex-1 h-7 bg-violet-600 hover:bg-violet-700 text-white" onClick={handleCreateAd} disabled={createAd.isPending}>
                    {createAd.isPending ? "Création..." : "Créer"}
                  </Button>
                  <Button size="sm" variant="outline" className="flex-1 h-7" onClick={() => setShowAdForm(false)}>Annuler</Button>
                </div>
              </div>
            )}

            {adsLoading ? (
              <p className="text-sm text-center text-muted-foreground py-6">Chargement...</p>
            ) : allAds.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Megaphone className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm">Aucune publicité</p>
              </div>
            ) : (
              <div className="space-y-2">
                {allAds.map((ad) => {
                  const active = new Date(ad.endDate) > new Date();
                  return (
                    <div key={ad.id} className={`border rounded-lg p-3 space-y-1.5 ${active ? "" : "opacity-60 bg-muted/30"}`}>
                      <div className="flex items-start gap-2">
                        {ad.image && <img src={resolveImageUrl(ad.image)} alt={ad.advertiserName} className="w-10 h-10 rounded object-cover border flex-shrink-0" />}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="text-sm font-semibold truncate">{ad.advertiserName}</p>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${active ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"}`}>
                              {active ? "Actif" : "Expiré"}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground line-clamp-2">{ad.message}</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            Expire : {new Date(ad.endDate).toLocaleDateString("fr-FR")}
                          </p>
                        </div>
                      </div>
                      {confirmAd === ad.id ? (
                        <div className="flex gap-2 pt-1">
                          <Button size="sm" variant="destructive" className="flex-1 h-7 text-xs" onClick={() => handleDeleteAd(ad.id)} disabled={deleteAd.isPending}>
                            {deleteAd.isPending ? "..." : "Oui, supprimer"}
                          </Button>
                          <Button size="sm" variant="outline" className="flex-1 h-7 text-xs" onClick={() => setConfirmAd(null)}>Annuler</Button>
                        </div>
                      ) : (
                        <Button size="sm" variant="outline" className="h-7 text-xs text-red-500 border-red-200 hover:bg-red-50 gap-1" onClick={() => setConfirmAd(ad.id)}>
                          <Trash2 className="w-3 h-3" /> Supprimer
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          /* ── EVENTS SECTION ─────────────────────────────────────────── */
          <div className="space-y-3 pt-1">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Événements ({allEvents.length})</p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={refetchEvents} className="h-7 px-2">
                  <RefreshCw className="w-3.5 h-3.5" />
                </Button>
                <Button size="sm" onClick={() => { setShowEventForm(!showEventForm); if (!allEvents.length) refetchEvents(); }} className="h-7 px-2 gap-1 bg-violet-600 hover:bg-violet-700 text-white">
                  <Plus className="w-3.5 h-3.5" />
                  Ajouter
                </Button>
              </div>
            </div>

            {showEventForm && (
              <div className="border rounded-lg p-3 space-y-2 bg-muted/30">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Nouvel événement</p>
                <Input placeholder="Titre *" value={eventForm.title} onChange={(e) => setEventForm((f) => ({ ...f, title: e.target.value }))} className="h-8 text-sm" />
                <textarea
                  placeholder="Description *"
                  value={eventForm.description}
                  onChange={(e) => setEventForm((f) => ({ ...f, description: e.target.value }))}
                  className="w-full h-20 text-sm border rounded-md px-3 py-2 bg-background resize-none"
                />
                <Input type="datetime-local" value={eventForm.date} onChange={(e) => setEventForm((f) => ({ ...f, date: e.target.value }))} className="h-8 text-sm" />
                <Input placeholder="Lieu *" value={eventForm.location} onChange={(e) => setEventForm((f) => ({ ...f, location: e.target.value }))} className="h-8 text-sm" />
                <Input placeholder="Prix ticket (optionnel)" value={eventForm.ticketPrice} onChange={(e) => setEventForm((f) => ({ ...f, ticketPrice: e.target.value }))} className="h-8 text-sm" />
                <Input placeholder="Lien ticket (optionnel)" value={eventForm.ticketLink} onChange={(e) => setEventForm((f) => ({ ...f, ticketLink: e.target.value }))} className="h-8 text-sm" />
                <div className="flex items-center gap-2">
                  <input ref={eventFlyerRef} type="file" accept="image/*" onChange={handleFlyerChange} className="hidden" />
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => eventFlyerRef.current?.click()}>
                    {eventForm.flyerImage ? "Flyer ✓" : "Flyer (optionnel)"}
                  </Button>
                  {eventForm.flyerPreview && (
                    <div className="relative">
                      <img src={eventForm.flyerPreview} alt="" className="w-10 h-10 rounded object-cover border" />
                      <button
                        type="button"
                        onClick={() => setEventForm((f) => ({ ...f, flyerImage: "", flyerPreview: "" }))}
                        className="absolute -top-1 -right-1 bg-black/50 text-white rounded-full p-0.5"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" className="flex-1 h-7 bg-violet-600 hover:bg-violet-700 text-white" onClick={handleCreateEvent} disabled={createEvent.isPending}>
                    {createEvent.isPending ? "Création..." : "Créer"}
                  </Button>
                  <Button size="sm" variant="outline" className="flex-1 h-7" onClick={() => setShowEventForm(false)}>Annuler</Button>
                </div>
              </div>
            )}

            {eventsLoading ? (
              <p className="text-sm text-center text-muted-foreground py-6">Chargement...</p>
            ) : allEvents.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Calendar className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm">Aucun événement</p>
              </div>
            ) : (
              <div className="space-y-2">
                {allEvents.map((event) => {
                  const isPast = new Date(event.date) < new Date();
                  return (
                    <div key={event.id} className={`border rounded-lg p-3 space-y-1.5 ${isPast ? "opacity-60 bg-muted/30" : ""}`}>
                      {event.flyerImage && (
                        <img src={resolveImageUrl(event.flyerImage)} alt={event.title} className="w-full h-28 rounded object-contain bg-black" />
                      )}
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="text-sm font-semibold truncate">{event.title}</p>
                            {isPast && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground flex-shrink-0">Passé</span>}
                          </div>
                          <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                            <Calendar className="w-3 h-3" />
                            <span>{new Date(event.date).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })}</span>
                          </div>
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <MapPin className="w-3 h-3" />
                            <span className="truncate">{event.location}</span>
                          </div>
                          {event.ticketPrice && (
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Ticket className="w-3 h-3" />
                              <span>{event.ticketPrice}</span>
                            </div>
                          )}
                        </div>
                      </div>
                      {confirmEvent === event.id ? (
                        <div className="flex gap-2">
                          <Button size="sm" variant="destructive" className="flex-1 h-7 text-xs" onClick={() => handleDeleteEvent(event.id)} disabled={deleteEvent.isPending}>
                            {deleteEvent.isPending ? "..." : "Oui, supprimer"}
                          </Button>
                          <Button size="sm" variant="outline" className="flex-1 h-7 text-xs" onClick={() => setConfirmEvent(null)}>Annuler</Button>
                        </div>
                      ) : (
                        <Button size="sm" variant="outline" className="h-7 text-xs text-red-500 border-red-200 hover:bg-red-50 gap-1" onClick={() => setConfirmEvent(event.id)}>
                          <Trash2 className="w-3 h-3" /> Supprimer
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
