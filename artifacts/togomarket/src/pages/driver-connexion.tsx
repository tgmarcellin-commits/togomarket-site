import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSiteSettings } from "@/lib/site-settings";
import { RefreshCw, LogOut, Truck, CheckCircle2, XCircle } from "lucide-react";
import { startDriverSessionPolling } from "./driver-session-polling";
import { DriverNotificationBanner } from "@/components/driver-notification-banner";
import { DriverPushControl } from "@/components/driver-push-control";
import { DriverAssignmentDetails } from "@/components/driver-assignment-details";
import { DriverTransferPanel } from "@/components/driver-transfer-panel";
import { resolveImageUrl } from "@/lib/image";
import {
  DeliveryQrDisplay,
  DeliveryTrackingMap,
  WalletSummary,
} from "@/components/delivery-components";
import {
  canRequestDeliveryQr,
  isLocationStale,
  shouldTrackDelivery,
  startAutomaticGpsTracking,
  toDriverSafeAssignment,
  type DriverSafeAssignment,
  type GpsPositionLike,
  isTerminalDeliveryStatus,
} from "@/lib/delivery-ui";
import { loadDeliveryLocations, requestDriverDeliveryQr, type DeliveryLocation, type DeliveryQrToken } from "@/lib/delivery-api";

const STORAGE_KEY = "tm_driver_session_token";

type DriverProfile = {
  id: number;
  firstName: string;
  lastName: string;
  phone: string;
  photoUrl: string | null;
  workZone: string;
  isAvailable: boolean;
};

type DriverAssignment = DriverSafeAssignment;

type GpsState = { status: "starting" | "active" | "denied" | "unavailable" | "payment_required"; lastUpdate: string | null };

function authHeaders(token: string): Record<string, string> {
  return { Authorization: "Bearer " + token };
}

function getAssignmentStatusLabel(status: string, lang: "fr" | "en") {
  const labels: Record<string, { fr: string; en: string }> = {
    pending_driver_response: { fr: "En attente de réponse", en: "Awaiting response" },
    accepted_by_driver: { fr: "Acceptée", en: "Accepted" },
    refused_by_driver: { fr: "Refusée", en: "Declined" },
    expired: { fr: "Expirée", en: "Expired" },
    cancelled_by_reassignment: { fr: "Réassignée", en: "Reassigned" },
    cancelled_payment_timeout: { fr: "Annulée (paiement expiré)", en: "Cancelled (payment timed out)" },
    transferred: { fr: "Transférée", en: "Transferred" },
    abandoned_by_driver: { fr: "Refusée après acceptation", en: "Declined after acceptance" },
  };
  const normalizedLang = lang === "fr" ? "fr" : "en";
  return labels[status]?.[normalizedLang] ?? status;
}

export default function DriverConnexion() {
  const { lang } = useSiteSettings();
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState<"phone" | "otp" | "session">("phone");
  const [token, setToken] = useState<string | null>(null);
  const [driver, setDriver] = useState<DriverProfile | null>(null);
  const [assignments, setAssignments] = useState<DriverAssignment[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [gpsStates, setGpsStates] = useState<Record<number, GpsState>>({});
  const [locations, setLocations] = useState<Record<number, DeliveryLocation[]>>({});
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [qrTokens, setQrTokens] = useState<Record<number, DeliveryQrToken>>({});
  const [qrLoadingId, setQrLoadingId] = useState<number | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);
  const [detailsReady, setDetailsReady] = useState<Record<number, boolean>>({});
  const [transferOpen, setTransferOpen] = useState(false);

  const isFrench = lang === "fr";
  const authHeadersForSession = useMemo(() => token ? authHeaders(token) as Record<string, string> : {}, [token]);

  const activeAssignments = useMemo(
    () => assignments.filter((assignment) => ["pending_driver_response", "accepted_by_driver"].includes(assignment.acceptanceStatus)),
    [assignments],
  );
  // Course acceptée et encore en cours : le livreur peut la transférer à un collègue ou la refuser
  const transferableAssignment = useMemo(
    () => assignments.find(
      (assignment) => assignment.acceptanceStatus === "accepted_by_driver"
        && ["ASSIGNED", "IN_TRANSIT"].includes(assignment.order?.status ?? ""),
    ) ?? null,
    [assignments],
  );
  const hasTransferable = transferableAssignment !== null;
  const gpsAssignmentIds = useMemo(
    () => assignments
      .filter((assignment) => shouldTrackDelivery(assignment.acceptanceStatus, assignment.order?.status))
      .map((assignment) => assignment.id)
      .join(","),
    [assignments],
  );

  const resetSession = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setToken(null);
    setDriver(null);
    setAssignments([]);
    setGpsStates({});
    setLocations({});
    setQrTokens({});
    setStep("phone");
    setPhone("");
    setOtp("");
  }, []);

  const loadSession = useCallback(async (sessionToken: string) => {
    const [sessionRes, assignmentsRes] = await Promise.all([
      fetch("/api/driver-connexion/session", { headers: authHeaders(sessionToken) }),
      fetch("/api/driver-connexion/assignments", { headers: authHeaders(sessionToken) }),
    ]);

    if (sessionRes.status === 401 || assignmentsRes.status === 401) {
      resetSession();
      throw new Error(isFrench ? "Session expirée. Reconnectez-vous." : "Session expired. Sign in again.");
    }
    if (!sessionRes.ok || !assignmentsRes.ok) {
      throw new Error(isFrench ? "Impossible de charger votre espace livreur." : "Unable to load driver workspace.");
    }

    const sessionData = await sessionRes.json() as { driver: DriverProfile };
    const assignmentsData = await assignmentsRes.json() as { assignments: unknown[] };
    setDriver(sessionData.driver);
    setAssignments((assignmentsData.assignments ?? []).map(toDriverSafeAssignment));
    setStep("session");
  }, [isFrench, resetSession]);

  useEffect(() => {
    const savedToken = localStorage.getItem(STORAGE_KEY);
    if (!savedToken) return;
    setToken(savedToken);
  }, []);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    const run = async () => {
      try {
        await loadSession(token);
        if (!cancelled) {
          setError(null);
          setMessage(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    };

    void run();
    const stopPolling = startDriverSessionPolling(() => { void run(); });
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [token, loadSession]);

  useEffect(() => {
    if (!token || !gpsAssignmentIds) return;
    // Les watchers GPS ne dépendent QUE de la liste des missions suivies (gpsAssignmentIds).
    // Avant, l'effet se relançait à chaque rafraîchissement de `assignments` (toutes les 30 s),
    // ce qui coupait puis recréait le suivi en permanence.
    const activeJobs = gpsAssignmentIds
      .split(",")
      .map((id) => ({ id: Number(id) }))
      .filter((job) => Number.isInteger(job.id) && job.id > 0);
    if (!navigator.geolocation) {
      setGpsStates((current) => Object.fromEntries(activeJobs.map((job) => [
        job.id,
        { status: "unavailable", lastUpdate: current[job.id]?.lastUpdate ?? null },
      ])));
      return;
    }

    const stopWatchers = activeJobs.map((assignment) => {
      setGpsStates((current) => ({
        ...current,
        [assignment.id]: { status: "starting", lastUpdate: current[assignment.id]?.lastUpdate ?? null },
      }));
      return startAutomaticGpsTracking(
        navigator.geolocation,
        (position) => {
          void fetch(`/api/delivery/jobs/${assignment.id}/locations`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...authHeaders(token) },
            body: JSON.stringify({
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              accuracy: position.coords.accuracy,
              speed: position.coords.speed,
              heading: position.coords.heading,
              recordedAt: new Date(position.timestamp).toISOString(),
            }),
          }).then(async (response) => {
            if (!response.ok) {
              const body = await response.json().catch(() => null) as { error?: string } | null;
              throw new Error(body?.error ?? "location-rejected");
            }
            const result = await response.json() as { throttled?: boolean };
            if (!result.throttled) {
              setGpsStates((current) => ({
                ...current,
                [assignment.id]: { status: "active", lastUpdate: new Date(position.timestamp).toISOString() },
              }));
            }
          }).catch((err) => {
            const paymentRequired = err instanceof Error && err.message.includes("Paiement de la course");
            setGpsStates((current) => ({
              ...current,
              [assignment.id]: {
                status: paymentRequired ? "payment_required" : "unavailable",
                lastUpdate: current[assignment.id]?.lastUpdate ?? null,
              },
            }));
          });
        },
        (error) => {
          setGpsStates((current) => ({
            ...current,
            [assignment.id]: {
              status: error.code === 1 ? "denied" : "unavailable",
              lastUpdate: current[assignment.id]?.lastUpdate ?? null,
            },
          }));
        },
      );
    });
    return () => stopWatchers.forEach((stop) => stop());
  }, [gpsAssignmentIds, token]);

  useEffect(() => {
    if (!token || !gpsAssignmentIds) return;
    let active = true;
    const refreshLocations = async () => {
      const activeJobs = assignments.filter((assignment) =>
        shouldTrackDelivery(assignment.acceptanceStatus, assignment.order?.status),
      );
      const entries = await Promise.all(activeJobs.map(async (assignment) => [
        assignment.id,
        await loadDeliveryLocations(assignment.id, authHeaders(token)),
      ] as const));
      if (active) setLocations((current) => ({ ...current, ...Object.fromEntries(entries) }));
    };
    void refreshLocations();
    const stopPolling = startDriverSessionPolling(() => { void refreshLocations(); }, undefined, 10_000);
    return () => {
      active = false;
      stopPolling();
    };
  }, [assignments, gpsAssignmentIds, token]);

  const requestOtp = async () => {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/driver-connexion/request-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json().catch(() => null) as { error?: string } | null;
      if (!res.ok) {
        throw new Error(data?.error ?? (isFrench ? "Impossible d'envoyer le code OTP." : "Unable to send OTP."));
      }
      setStep("otp");
      setMessage(isFrench ? "Code envoyé sur WhatsApp. Saisissez-le ci-dessous." : "Code sent on WhatsApp. Enter it below.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const verifyOtp = async () => {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/driver-connexion/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, otp }),
      });
      const data = await res.json().catch(() => null) as {
        error?: string;
        token?: string;
      } | null;
      if (!res.ok || !data?.token) {
        throw new Error(data?.error ?? (isFrench ? "Code OTP invalide." : "Invalid OTP code."));
      }
      localStorage.setItem(STORAGE_KEY, data.token);
      setToken(data.token);
      setMessage(isFrench ? "Connexion réussie." : "Signed in successfully.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const refreshAssignments = async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      await loadSession(token);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const setAvailability = async (isAvailable: boolean) => {
    if (!token) return;
    setAvailabilityLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/driver-connexion/availability", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(token),
        },
        body: JSON.stringify({ isAvailable }),
      });
      const data = await res.json().catch(() => null) as { error?: string } | null;
      if (!res.ok) {
        throw new Error(data?.error ?? (isFrench ? "Impossible de mettre à jour la disponibilité." : "Unable to update availability."));
      }
      setDriver((current) => current ? { ...current, isAvailable } : current);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAvailabilityLoading(false);
    }
  };

  const closeTransfer = useCallback(() => setTransferOpen(false), []);

  const handleTransferChanged = useCallback(async (info: string) => {
    setTransferOpen(false);
    setMessage(info);
    if (token) await loadSession(token).catch(() => undefined);
  }, [token, loadSession]);

  /** « Reprendre la commande » depuis le bouton principal : annule l'offre en attente puis referme le panneau. */
  const resumeAssignment = async () => {
    if (token && transferableAssignment) {
      await fetch(`/api/driver-connexion/assignments/${transferableAssignment.id}/transfer/cancel`, {
        method: "POST",
        headers: authHeaders(token),
      }).catch(() => undefined);
    }
    setTransferOpen(false);
  };

  // Plus de course transférable (transférée, terminée…) : le panneau se referme
  useEffect(() => {
    if (!hasTransferable) setTransferOpen(false);
  }, [hasTransferable]);

  // Livreur disponible : sa dernière position est partagée (une seule position conservée) pour que ses collègues
  // puissent lui transférer une course proche du vendeur. Refus de localisation : aucun effet, il n'est simplement pas proposé.
  useEffect(() => {
    if (!token || step !== "session" || !driver?.isAvailable || hasTransferable) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    let cancelled = false;
    const send = () => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          if (cancelled) return;
          void fetch("/api/driver-connexion/presence", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
            body: JSON.stringify({
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              accuracyMeters: position.coords.accuracy,
            }),
          }).catch(() => undefined);
        },
        () => undefined,
        { enableHighAccuracy: false, maximumAge: 30_000, timeout: 15_000 },
      );
    };
    send();
    const timer = setInterval(() => { if (document.visibilityState === "visible") send(); }, 60_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [token, step, driver?.isAvailable, hasTransferable]);

  const logout = async () => {
    if (token) {
      await fetch("/api/driver-connexion/logout", {
        method: "POST",
        headers: authHeaders(token),
      }).catch(() => null);
    }
    resetSession();
    setMessage(isFrench ? "Déconnecté." : "Signed out.");
    setError(null);
  };

  const respondToAssignment = async (assignmentId: number, action: "accept" | "refuse") => {
    if (!token) return;
    setBusyId(assignmentId);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/delivery/assignments/respond", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(token),
        },
        body: JSON.stringify({ deliveryJobId: assignmentId, action }),
      });
      const data = await res.json().catch(() => null) as { error?: string } | null;
      if (!res.ok) {
        throw new Error(data?.error ?? (isFrench ? "Impossible de traiter l'assignation." : "Unable to process assignment."));
      }
      setMessage(action === "accept"
        ? (isFrench ? "Mission acceptée." : "Assignment accepted.")
        : (isFrench ? "Mission refusée." : "Assignment declined."));
      await loadSession(token);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  useEffect(() => {
    const timer = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const cancelUnpaidAssignment = async (assignmentId: number) => {
    if (!token) return;
    setBusyId(assignmentId);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/delivery/assignments/cancel-unpaid", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(token),
        },
        body: JSON.stringify({ deliveryJobId: assignmentId }),
      });
      const data = await res.json().catch(() => null) as { error?: string } | null;
      if (!res.ok) {
        throw new Error(data?.error ?? (isFrench ? "Impossible d'annuler la mission." : "Unable to cancel the assignment."));
      }
      setMessage(isFrench ? "Mission annulée. Vous êtes de nouveau disponible." : "Assignment cancelled. You are available again.");
      await loadSession(token);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const requestQr = async (assignment: DriverAssignment, stage: "delivery" | "return") => {
    if (!token || !navigator.geolocation) return;
    setQrLoadingId(assignment.id);
    setQrError(null);
    try {
      const position = await new Promise<GpsPositionLike["coords"]>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          ({ coords }) => resolve(coords),
          () => reject(new Error(isFrench ? "Position GPS indisponible." : "GPS location unavailable.")),
          { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
        );
      });
      const qr = await requestDriverDeliveryQr(assignment.id, stage, token, position);
      setQrTokens((current) => ({ ...current, [assignment.id]: qr }));
    } catch (err) {
      setQrError(err instanceof Error ? err.message : String(err));
    } finally {
      setQrLoadingId(null);
    }
  };

  return (
    <div className="min-h-screen bg-muted/30 py-8 px-4">
      <div className="mx-auto max-w-2xl space-y-4">
        <div className="rounded-2xl border bg-card p-6 shadow-sm space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Truck className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold">{isFrench ? "Connexion livreur" : "Driver sign in"}</h1>
              <p className="text-sm text-muted-foreground">
                {isFrench
                  ? "Recevez votre code OTP sur WhatsApp puis gérez vos missions."
                  : "Receive your OTP on WhatsApp, then manage your assignments."}
              </p>
            </div>
          </div>

          {error && <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>}
          {message && <div className="rounded-xl border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-700">{message}</div>}
          {token && step === "session" && <DriverPushControl token={token} />}
          {token && step === "session" && <DriverNotificationBanner token={token} />}

          {step !== "session" && (
            <div className="space-y-3">
              <div className="space-y-2">
                <label htmlFor="driver-phone" className="text-sm font-medium">{isFrench ? "Numéro WhatsApp" : "WhatsApp number"}</label>
                <Input
                  id="driver-phone"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="+228 XX XX XX XX"
                />
              </div>

              {step === "otp" && (
              <div className="space-y-2">
                <label htmlFor="driver-otp" className="text-sm font-medium">{isFrench ? "Code OTP" : "OTP code"}</label>
                <Input
                  id="driver-otp"
                  value={otp}
                  onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="123456"
                    inputMode="numeric"
                  />
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                {step === "phone" ? (
                  <Button onClick={requestOtp} disabled={loading || phone.trim().length < 8}>
                    {loading ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : null}
                    {isFrench ? "Recevoir le code OTP" : "Send OTP"}
                  </Button>
                ) : (
                  <>
                    <Button onClick={verifyOtp} disabled={loading || phone.trim().length < 8 || otp.trim().length !== 6}>
                      {loading ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : null}
                      {isFrench ? "Se connecter" : "Sign in"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setOtp("");
                        setStep("phone");
                      }}
                      disabled={loading}
                    >
                      {isFrench ? "Changer de numéro" : "Change number"}
                    </Button>
                  </>
                )}
              </div>
            </div>
          )}

          {step === "session" && driver && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/30 p-4">
                <div className="flex items-center gap-3">
                  <div className="h-14 w-14 overflow-hidden rounded-full bg-muted flex items-center justify-center">
                    {driver.photoUrl
                      ? <img src={resolveImageUrl(driver.photoUrl)} alt="" className="h-full w-full object-cover" />
                      : <Truck className="h-6 w-6 text-muted-foreground" />}
                  </div>
                  <div>
                    <p className="font-semibold">{driver.firstName} {driver.lastName}</p>
                    <p className="text-sm text-muted-foreground">{driver.workZone}</p>
                    <p className="text-xs text-muted-foreground">{driver.phone}</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" size="sm" onClick={refreshAssignments} disabled={loading}>
                    <RefreshCw className={`w-4 h-4 mr-1.5 ${loading ? "animate-spin" : ""}`} />
                    {isFrench ? "Actualiser" : "Refresh"}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => { void logout(); }}>
                    <LogOut className="w-4 h-4 mr-1.5" />
                    {isFrench ? "Déconnexion" : "Sign out"}
                  </Button>
                </div>
              </div>

              <div className="flex items-center justify-between rounded-xl border p-4">
                <div>
                  <p className="font-medium">{isFrench ? "Disponibilité" : "Availability"}</p>
                  <p className="text-sm text-muted-foreground">
                    {hasTransferable
                      ? (isFrench ? "Course en cours : trop loin du vendeur ? Vous pouvez la transférer à un collègue." : "Delivery in progress: too far from the seller? You can hand it to a colleague.")
                      : driver.isAvailable
                        ? (isFrench ? "Vous pouvez recevoir de nouvelles missions." : "You can receive new assignments.")
                        : (isFrench ? "Vous ne recevrez pas de nouvelles missions." : "You will not receive new assignments.")}
                  </p>
                </div>
                <Button
                  variant={hasTransferable || driver.isAvailable ? "outline" : "default"}
                  onClick={() => {
                    if (hasTransferable) {
                      if (transferOpen) void resumeAssignment();
                      else setTransferOpen(true);
                      return;
                    }
                    void setAvailability(!driver.isAvailable);
                  }}
                  disabled={availabilityLoading}
                >
                  {availabilityLoading ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : null}
                  {hasTransferable
                    ? (transferOpen
                      ? (isFrench ? "Reprendre la commande" : "Resume the delivery")
                      : (isFrench ? "Passer indisponible" : "Go unavailable"))
                    : driver.isAvailable
                      ? (isFrench ? "Passer indisponible" : "Go unavailable")
                      : (isFrench ? "Passer disponible" : "Go available")}
                </Button>
              </div>

              {transferOpen && transferableAssignment && token && (
                <DriverTransferPanel
                  token={token}
                  deliveryJobId={transferableAssignment.id}
                  orderId={transferableAssignment.orderId ?? null}
                  isFrench={isFrench}
                  onClose={closeTransfer}
                  onChanged={handleTransferChanged}
                />
              )}

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-bold">
                    {isFrench ? "Mes assignations" : "My assignments"} ({activeAssignments.length})
                  </h2>
                </div>

                {assignments.length === 0 ? (
                  <div className="rounded-xl border bg-muted/20 p-6 text-sm text-muted-foreground text-center">
                    {isFrench ? "Aucune assignation pour le moment." : "No assignments yet."}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {assignments.map((assignment) => {
                      const pending = assignment.acceptanceStatus === "pending_driver_response";
                      const accepted = assignment.acceptanceStatus === "accepted_by_driver";
                      return (
                        <div key={assignment.id} className="rounded-xl border bg-card p-4 space-y-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <p className="font-semibold">
                                {isFrench ? "Commande" : "Order"} #{assignment.orderId}
                              </p>
                              <p className="text-sm text-muted-foreground">
                                {assignment.order
                                  ? `${assignment.order.firstName} ${assignment.order.lastName} — ${assignment.order.phone}`
                                  : (isFrench ? "Commande introuvable" : "Order not found")}
                              </p>
                            </div>
                            <span className={`text-xs rounded-full px-2.5 py-1 font-semibold ${
                              pending
                                ? "bg-amber-100 text-amber-700"
                                : accepted
                                  ? "bg-green-100 text-green-700"
                                  : "bg-muted text-muted-foreground"
                            }`}>
                              {getAssignmentStatusLabel(assignment.acceptanceStatus, isFrench ? "fr" : "en")}
                            </span>
                          </div>

                          {token && (
                            <DriverAssignmentDetails
                              token={token}
                              deliveryJobId={assignment.id}
                              isFrench={isFrench}
                              fallbackOrder={assignment.order}
                              finished={isTerminalDeliveryStatus(assignment.order?.status)}
                              onReadyChange={(ready) => setDetailsReady((current) => (
                                current[assignment.id] === ready ? current : { ...current, [assignment.id]: ready }
                              ))}
                            />
                          )}

                          {assignment.assignmentExpiresAt && (
                            <p className="text-xs text-muted-foreground">
                              {isFrench ? "Expire le" : "Expires on"} {new Date(assignment.assignmentExpiresAt).toLocaleString(isFrench ? "fr-FR" : "en-US")}
                            </p>
                          )}

                          {pending && (
                            <div className="flex flex-wrap gap-2">
                              <Button
                                className="gap-1.5"
                                onClick={() => respondToAssignment(assignment.id, "accept")}
                                disabled={busyId === assignment.id || !detailsReady[assignment.id]}
                                title={detailsReady[assignment.id] ? undefined : (isFrench ? "Disponible dès que la distance et la rémunération sont affichées" : "Available once the distance and pay are shown")}
                              >
                                {busyId === assignment.id ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                                {isFrench ? "Accepter" : "Accept"}
                              </Button>
                              <Button
                                variant="outline"
                                className="gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/5"
                                onClick={() => respondToAssignment(assignment.id, "refuse")}
                                disabled={busyId === assignment.id}
                              >
                                <XCircle className="w-4 h-4" />
                                {isFrench ? "Refuser" : "Decline"}
                              </Button>
                            </div>
                          )}
                          {accepted && isTerminalDeliveryStatus(assignment.order?.status) && (
                            <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800" role="status" data-testid="delivery-finished-notice">
                              {(assignment.order?.status ?? "").toUpperCase() === "RETURN_CONFIRMED"
                                ? (isFrench ? "Retour confirmé par QR code. Le suivi de position est arrêté et les coordonnées ont été retirées." : "Return confirmed by QR code. Location sharing has stopped and the contact details were removed.")
                                : (isFrench ? "Livraison confirmée par QR code. Le suivi de position est arrêté et les coordonnées ont été retirées." : "Delivery confirmed by QR code. Location sharing has stopped and the contact details were removed.")}
                            </p>
                          )}
                          {accepted && !isTerminalDeliveryStatus(assignment.order?.status) && (
                            <div className="space-y-3">
                              <p className="text-xs text-muted-foreground" role="status">
                                {gpsStates[assignment.id]?.status === "active" && isLocationStale(gpsStates[assignment.id]?.lastUpdate)
                                  ? (isFrench ? "Signal GPS reçu, mais position ancienne" : "GPS signal received, but location is stale")
                                  : gpsStates[assignment.id]?.status === "active"
                                  ? (isFrench ? "GPS actif automatiquement" : "GPS is active automatically")
                                  : gpsStates[assignment.id]?.status === "payment_required"
                                    ? (isFrench ? "En attente du paiement de la course : le suivi démarrera après paiement" : "Waiting for delivery payment: tracking starts once paid")
                                  : gpsStates[assignment.id]?.status === "denied"
                                    ? (isFrench ? "Autorisation GPS refusée" : "GPS permission denied")
                                    : gpsStates[assignment.id]?.status === "unavailable"
                                      ? (isFrench ? "Signal GPS indisponible" : "GPS signal unavailable")
                                      : (isFrench ? "Activation automatique du GPS…" : "Starting GPS automatically…")}
                                {gpsStates[assignment.id]?.lastUpdate && ` · ${isFrench ? "Dernière mise à jour" : "Last update"} ${new Date(gpsStates[assignment.id]!.lastUpdate!).toLocaleTimeString(isFrench ? "fr-FR" : "en-US")}`}
                              </p>
                              {assignment.acceptedAt
                                && nowTick - new Date(assignment.acceptedAt).getTime() >= 10 * 60 * 1000
                                && assignment.order?.status !== "DELIVERED" && (
                                <Button
                                  type="button"
                                  variant="outline"
                                  className="gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/5"
                                  onClick={() => cancelUnpaidAssignment(assignment.id)}
                                  disabled={busyId === assignment.id}
                                >
                                  <XCircle className="w-4 h-4" />
                                  {isFrench ? "Annuler (paiement non reçu après 10 min)" : "Cancel (payment not received after 10 min)"}
                                </Button>
                              )}
                              <DeliveryTrackingMap
                                deliveryJobId={assignment.id}
                                acceptanceStatus={assignment.acceptanceStatus}
                                orderStatus={assignment.order?.status ?? ""}
                                locations={locations[assignment.id] ?? []}
                                role="driver"
                                language={isFrench ? "fr" : "en"}
                              />
                              {assignment.order && (
                                <div className="flex flex-wrap gap-2">
                                  {canRequestDeliveryQr("delivery", assignment.order.status) && (
                                    <Button type="button" size="sm" variant="outline" disabled={qrLoadingId === assignment.id} onClick={() => { void requestQr(assignment, "delivery"); }}>
                                      {isFrench ? "Demander le QR de livraison" : "Request delivery QR"}
                                    </Button>
                                  )}
                                  {canRequestDeliveryQr("return", assignment.order.status) && (
                                    <Button type="button" size="sm" variant="outline" disabled={qrLoadingId === assignment.id} onClick={() => { void requestQr(assignment, "return"); }}>
                                      {isFrench ? "Demander le QR de retour" : "Request return QR"}
                                    </Button>
                                  )}
                                </div>
                              )}
                              {qrError && <p className="text-xs text-destructive" role="alert">{qrError}</p>}
                              {qrTokens[assignment.id] && (
                                <DeliveryQrDisplay
                                  rawToken={qrTokens[assignment.id]!.rawToken}
                                  expiresAt={qrTokens[assignment.id]!.expiresAt}
                                  language={isFrench ? "fr" : "en"}
                                  onExpired={() => setQrTokens((current) => {
                                    const qr = current[assignment.id];
                                    return qr ? { ...current, [assignment.id]: { ...qr, rawToken: "" } } : current;
                                  })}
                                />
                              )}
                              {isLocationStale(gpsStates[assignment.id]?.lastUpdate) && gpsStates[assignment.id]?.lastUpdate && (
                                <p className="text-xs text-amber-700">{isFrench ? "Votre dernière position GPS est ancienne." : "Your last GPS location is stale."}</p>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              {token && (
                <WalletSummary
                  loadUrl="/api/driver-connexion/wallet"
                  withdrawUrl="/api/driver-connexion/withdraw"
                  withdrawBody={{}}
                  headers={authHeadersForSession}
                  phoneNumber={driver.phone}
                  language={isFrench ? "fr" : "en"}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
