import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import QRCode from "qrcode";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { scanDeliveryQr, type DeliveryLocation, type QrScanResult } from "@/lib/delivery-api";
import {
  canWithdrawWallet,
  createSingleFlightGuard,
  getQrRemainingSeconds,
  getDeliveryRoutePhase,
  isLocationStale,
  type DeliveryRoutePhase,
} from "@/lib/delivery-ui";

type Language = "fr" | "en";
type ScannerRole = "buyer" | "seller";

const routeLabels: Record<Language, Record<DeliveryRoutePhase, string>> = {
  fr: {
    waiting: "En attente du livreur",
    "to-seller": "En route vers le vendeur",
    "picked-up": "Colis récupéré",
    "to-buyer": "En route vers l'acheteur",
    arrived: "Arrivé à la zone de retour",
    delivered: "Livraison confirmée",
    returning: "Retour vers le vendeur",
    returned: "Retour confirmé",
  },
  en: {
    waiting: "Waiting for driver",
    "to-seller": "Going to seller",
    "picked-up": "Picked up",
    "to-buyer": "Going to buyer",
    arrived: "Arrived at return zone",
    delivered: "Delivery confirmed",
    returning: "Returning to seller",
    returned: "Return confirmed",
  },
};

function formatFcfa(amount: number, language: Language): string {
  return `${new Intl.NumberFormat(language === "fr" ? "fr-FR" : "en-US").format(amount)} FCFA`;
}

export function DeliveryTrackingMap({
  deliveryJobId,
  acceptanceStatus,
  orderStatus,
  locations,
  role,
  language,
  pickup,
  dropoff,
}: {
  deliveryJobId: number;
  acceptanceStatus: string;
  orderStatus: string;
  locations: DeliveryLocation[];
  role: "driver" | "buyer" | "seller" | "admin";
  language: Language;
  pickup?: { latitude: number; longitude: number } | null;
  dropoff?: { latitude: number; longitude: number } | null;
}) {
  const mapRef = useRef<HTMLDivElement>(null);
  const latest = locations.reduce<DeliveryLocation | null>(
    (newest, location) => !newest || new Date(location.recordedAt) > new Date(newest.recordedAt) ? location : newest,
    null,
  );
  const stale = isLocationStale(latest?.recordedAt);
  const phase = getDeliveryRoutePhase(acceptanceStatus, orderStatus);
  const points = useMemo(() => {
    const ordered = [...locations].sort(
      (left, right) => new Date(left.recordedAt).getTime() - new Date(right.recordedAt).getTime(),
    );
    return ordered.slice(-80).map((location) => ({
      latitude: location.latitude,
      longitude: location.longitude,
      label: "driver",
    })).concat(
      pickup ? [{ ...pickup, label: "pickup" }] : [],
      dropoff ? [{ ...dropoff, label: "dropoff" }] : [],
    );
  }, [locations, pickup, dropoff]);
  const driverPoints = points.filter((point) => point.label === "driver");
  useEffect(() => {
    const element = mapRef.current;
    if (!element) return;
    const track = driverPoints.map((point) => L.latLng(point.latitude, point.longitude));
    const markers = [
      ...(pickup ? [{ location: pickup, color: "#16a34a", title: language === "fr" ? "Retrait vendeur" : "Seller pickup" }] : []),
      ...(dropoff ? [{ location: dropoff, color: "#9333ea", title: language === "fr" ? "Acheteur" : "Buyer dropoff" }] : []),
      ...(latest ? [{ location: latest, color: "#2563eb", title: language === "fr" ? "Livreur" : "Driver" }] : []),
    ];
    const center = latest
      ? L.latLng(latest.latitude, latest.longitude)
      : L.latLng(6.1319, 1.2228);
    const map = L.map(element, { scrollWheelZoom: false }).setView(center, latest ? 14 : 12);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" rel="noreferrer">OpenStreetMap</a>',
    }).addTo(map);
    if (track.length > 1) L.polyline(track, { color: "#2563eb", weight: 4 }).addTo(map);
    markers.forEach(({ location, color, title }) => {
      L.circleMarker([location.latitude, location.longitude], {
        radius: 8,
        color: "#fff",
        weight: 3,
        fillColor: color,
        fillOpacity: 1,
      }).bindTooltip(title).addTo(map);
    });
    const bounds = [...track, ...markers.map(({ location }) => L.latLng(location.latitude, location.longitude))];
    if (bounds.length > 1) map.fitBounds(L.latLngBounds(bounds).pad(0.2));
    const resize = window.setTimeout(() => map.invalidateSize(), 0);
    return () => {
      window.clearTimeout(resize);
      map.remove();
    };
  }, [deliveryJobId, driverPoints, dropoff, language, latest, pickup]);

  return (
    <section className="rounded-xl border bg-card p-3 space-y-2" data-testid="delivery-tracking-map" data-role={role}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">
            {language === "fr" ? `Suivi de la livraison #${deliveryJobId}` : `Delivery #${deliveryJobId} tracking`}
          </h3>
          <p className="text-xs text-muted-foreground">{routeLabels[language][phase]}</p>
        </div>
        {stale && (
          <span className="rounded-full bg-amber-100 px-2 py-1 text-[11px] font-medium text-amber-800" role="status">
            {language === "fr" ? "Position GPS obsolète" : "GPS location is stale"}
          </span>
        )}
      </div>
      <div ref={mapRef} role="application" aria-label={routeLabels[language][phase]} className="h-56 w-full rounded-lg" />
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-blue-600" />{language === "fr" ? "Livreur" : "Driver"}</span>
        <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-green-600" />{language === "fr" ? "Retrait vendeur" : "Seller pickup"}{!pickup && ` (${language === "fr" ? "position non fournie" : "location unavailable"})`}</span>
        <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-purple-600" />{language === "fr" ? "Acheteur" : "Buyer dropoff"}{!dropoff && ` (${language === "fr" ? "position non fournie" : "location unavailable"})`}</span>
        <span className="ml-auto">
          {latest
            ? `${language === "fr" ? "Dernière position" : "Last location"}: ${new Date(latest.recordedAt).toLocaleString(language === "fr" ? "fr-FR" : "en-US")}`
            : (language === "fr" ? "Aucune position reçue" : "No location received")}
        </span>
      </div>
    </section>
  );
}

export function AdminDeliverySupervisor({
  deliveryJobId,
  orderStatus,
  adminCode,
  language = "fr",
}: {
  deliveryJobId: number;
  orderStatus: string;
  adminCode: string;
  language?: Language;
}) {
  const [locations, setLocations] = useState<DeliveryLocation[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch(`/api/delivery/jobs/${deliveryJobId}/locations`, {
          headers: { "x-admin-code": adminCode },
        });
        if (!response.ok) throw new Error(language === "fr" ? "Suivi GPS indisponible." : "GPS tracking is unavailable.");
        const result = await response.json() as { locations?: DeliveryLocation[] };
        if (active) {
          setLocations(Array.isArray(result.locations) ? result.locations : []);
          setError(null);
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      }
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 15_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [adminCode, deliveryJobId, language]);

  return (
    <div className="space-y-2">
      {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
      <DeliveryTrackingMap
        deliveryJobId={deliveryJobId}
        acceptanceStatus="accepted_by_driver"
        orderStatus={orderStatus}
        locations={locations}
        role="admin"
        language={language}
      />
    </div>
  );
}

export function DeliveryQrDisplay({
  rawToken,
  expiresAt,
  language,
  onExpired,
}: {
  rawToken: string;
  expiresAt: string;
  language: Language;
  onExpired?: () => void;
}) {
  const [imageUrl, setImageUrl] = useState("");
  const [remaining, setRemaining] = useState(() => getQrRemainingSeconds(expiresAt));
  const onExpiredRef = useRef(onExpired);
  const expiryNotifiedRef = useRef(false);

  useEffect(() => {
    onExpiredRef.current = onExpired;
  }, [onExpired]);

  useEffect(() => {
    let active = true;
    expiryNotifiedRef.current = false;
    if (getQrRemainingSeconds(expiresAt) > 0) {
      void QRCode.toDataURL(rawToken, { errorCorrectionLevel: "M", margin: 2, width: 240 })
        .then((url) => { if (active && getQrRemainingSeconds(expiresAt) > 0) setImageUrl(url); })
        .catch(() => { if (active) setImageUrl(""); });
    } else {
      setImageUrl("");
    }
    const timer = window.setInterval(() => {
      const seconds = getQrRemainingSeconds(expiresAt);
      setRemaining(seconds);
      if (seconds === 0) {
        setImageUrl("");
        if (!expiryNotifiedRef.current) {
          expiryNotifiedRef.current = true;
          onExpiredRef.current?.();
        }
      }
    }, 1_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [expiresAt, rawToken]);

  return (
    <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-center space-y-2" data-testid="delivery-qr">
      <p className="font-semibold">{language === "fr" ? "QR code à scanner" : "QR code to scan"}</p>
      {remaining > 0 && imageUrl
        ? <img src={imageUrl} alt={language === "fr" ? "QR code de livraison" : "Delivery QR code"} className="mx-auto h-48 w-48" />
        : null}
      {remaining > 0
        ? <p role="timer">{language === "fr" ? "Expire dans" : "Expires in"} {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}</p>
        : <p role="status" className="font-medium text-destructive">{language === "fr" ? "Ce QR code a expiré. Demandez-en un nouveau." : "This QR code has expired. Request a new one."}</p>}
      <p className="text-xs text-muted-foreground">{language === "fr" ? "Validité maximale : 3 minutes." : "Maximum validity: 3 minutes."}</p>
    </div>
  );
}

export function DeliveryQrScanner({
  role,
  language,
  onSuccess,
  headers,
}: {
  role: ScannerRole;
  language: Language;
  onSuccess?: (result: QrScanResult) => void;
  headers: Record<string, string>;
}) {
  const [rawToken, setRawToken] = useState("");
  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setScanning(false);
  };

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  useEffect(() => {
    if (!scanning || !videoRef.current || !streamRef.current) return;
    type Detector = { detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue?: string }>> };
    type DetectorConstructor = new (options: { formats: string[] }) => Detector;
    const DetectorClass = (window as Window & { BarcodeDetector?: DetectorConstructor }).BarcodeDetector;
    if (!DetectorClass) {
      setCameraError(language === "fr" ? "Lecture QR non prise en charge ici. Saisissez le code ci-dessous." : "QR camera scanning is unsupported here. Enter the code below.");
      return;
    }
    const detector = new DetectorClass({ formats: ["qr_code"] });
    let frame = 0;
    let active = true;
    const detect = async () => {
      if (!active || !videoRef.current) return;
      try {
        const results = await detector.detect(videoRef.current);
        if (results[0]?.rawValue) {
          setRawToken(results[0].rawValue);
          stopCamera();
          return;
        }
      } catch {
        setCameraError(language === "fr" ? "Lecture caméra indisponible." : "Camera scanning unavailable.");
      }
      frame = window.requestAnimationFrame(() => { void detect(); });
    };
    frame = window.requestAnimationFrame(() => { void detect(); });
    return () => {
      active = false;
      window.cancelAnimationFrame(frame);
    };
  }, [language, scanning]);

  const startCamera = async () => {
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } } });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setScanning(true);
    } catch {
      setCameraError(language === "fr" ? "Autorisez l'accès à la caméra pour scanner le QR code." : "Allow camera access to scan the QR code.");
    }
  };

  const submitScan = async () => {
    if (!rawToken.trim() || loading) return;
    setLoading(true);
    setScanError(null);
    setSuccess(false);
    try {
      const position = await new Promise<{ latitude: number; longitude: number }>((resolve, reject) => {
        if (!navigator.geolocation) {
          reject(new Error(language === "fr" ? "Géolocalisation indisponible." : "Geolocation is unavailable."));
          return;
        }
        navigator.geolocation.getCurrentPosition(
          ({ coords }) => resolve({ latitude: coords.latitude, longitude: coords.longitude }),
          () => reject(new Error(language === "fr" ? "Position actuelle requise pour valider." : "Current location is required to confirm.")),
          { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
        );
      });
      const result = await scanDeliveryQr(rawToken.trim(), role, position, fetch, headers);
      setSuccess(true);
      setRawToken("");
      onSuccess?.(result);
    } catch (error) {
      setScanError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const stageLabel = role === "buyer"
    ? (language === "fr" ? "Acheteur — livraison" : "Buyer — delivery")
    : (language === "fr" ? "Vendeur — retour" : "Seller — return");

  return (
    <section className="rounded-xl border bg-card p-3 space-y-2" data-testid="delivery-qr-scanner" data-scanner-role={role}>
      <p className="text-sm font-semibold">{stageLabel}</p>
      <Button type="button" variant="outline" size="sm" onClick={() => { void startCamera(); }}>
        {language === "fr" ? "Scanner avec la caméra" : "Scan with camera"}
      </Button>
      {scanning && (
        <div className="space-y-2">
          <video ref={videoRef} playsInline muted className="max-h-52 w-full rounded-lg bg-black" aria-label={language === "fr" ? "Caméra du scanner QR" : "QR scanner camera"} />
          <Button type="button" variant="outline" size="sm" onClick={stopCamera}>{language === "fr" ? "Fermer la caméra" : "Close camera"}</Button>
        </div>
      )}
      <label className="block text-xs text-muted-foreground" htmlFor={`delivery-qr-${role}`}>
        {language === "fr" ? "Ou collez le code QR" : "Or paste the QR code"}
      </label>
      <Input id={`delivery-qr-${role}`} value={rawToken} onChange={(event) => setRawToken(event.target.value)} autoComplete="off" />
      <Button type="button" size="sm" onClick={() => { void submitScan(); }} disabled={loading || !rawToken.trim()}>
        {loading
          ? (language === "fr" ? "Vérification…" : "Verifying…")
          : (language === "fr" ? "Confirmer le scan" : "Confirm scan")}
      </Button>
      {cameraError && <p className="text-xs text-amber-700" role="status">{cameraError}</p>}
      {scanError && <p className="text-xs text-destructive" role="alert">{scanError}</p>}
      {success && (
        <p className="text-xs text-green-700" role="status">
          {language === "fr"
            ? "Scan vérifié. Le règlement a été confirmé par le serveur."
            : "Scan verified. Settlement was confirmed by the server."}
        </p>
      )}
    </section>
  );
}

export interface WalletSummaryResponse {
  availableBalance: number;
  lockedBalance: number;
  pendingPayoutBalance: number;
  paidOutBalance: number;
  withdrawalReadiness?: { canWithdraw?: boolean; maxWithdrawableAmount?: number };
  withdrawalAvailability?: { canWithdraw?: boolean; availableForWithdrawal?: number; lockedAmount?: number; pendingPayout?: number; statusLabel?: string; estimatedPayoutDays?: string };
  recentMovements?: Array<{ id: number; entryType: string; amount: number; direction: string; createdAt: string }>;
}

export function WalletSummary({
  loadUrl,
  withdrawUrl,
  withdrawBody,
  headers,
  phoneNumber,
  language,
  onUpdated,
}: {
  loadUrl: string;
  withdrawUrl: string;
  withdrawBody: Record<string, unknown>;
  headers: Record<string, string>;
  phoneNumber: string;
  language: Language;
  onUpdated?: () => void;
}) {
  const [wallet, setWallet] = useState<WalletSummaryResponse | null>(null);
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submitGuard = useRef(createSingleFlightGuard()).current;

  const refresh = async () => {
    const response = await fetch(loadUrl, { headers, credentials: "include" });
    if (!response.ok) throw new Error(language === "fr" ? "Portefeuille indisponible." : "Wallet is unavailable.");
    setWallet(await response.json() as WalletSummaryResponse);
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    void fetch(loadUrl, { headers, credentials: "include" })
      .then(async (response) => {
        if (!response.ok) throw new Error(language === "fr" ? "Portefeuille indisponible." : "Wallet is unavailable.");
        return await response.json() as WalletSummaryResponse;
      })
      .then((data) => { if (active) setWallet(data); })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [headers, language, loadUrl]);

  const ready = canWithdrawWallet(wallet);
  const submit = async () => {
    const requested = Number(amount);
    const serverMaximum = wallet?.withdrawalReadiness?.maxWithdrawableAmount
      ?? wallet?.withdrawalAvailability?.availableForWithdrawal
      ?? 0;
    if (submitGuard.isPending() || !ready || !Number.isInteger(requested) || requested <= 0 || requested > serverMaximum) return;
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const withdrawalMessage = await submitGuard.run(async () => {
        const response = await fetch(withdrawUrl, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ ...withdrawBody, amount: requested, phoneNumber }),
        });
        const result = await response.json().catch(() => ({})) as { error?: string; status?: string; withdrawal?: { status?: string } };
        if (!response.ok) throw new Error(result.error ?? (language === "fr" ? "Demande de retrait refusée." : "Withdrawal request failed."));
        const status = result.status ?? result.withdrawal?.status ?? "pending";
        return `${language === "fr" ? "Demande reçue" : "Request received"} — ${status}. ${language === "fr" ? "Virement estimé sous 2–3 jours ouvrés." : "Transfer estimated in 2–3 business days."}`;
      });
      if (!withdrawalMessage) return;
      setMessage(withdrawalMessage);
      setAmount("");
      await refresh();
      onUpdated?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <section className="rounded-xl border p-4 text-sm text-muted-foreground">{language === "fr" ? "Chargement du portefeuille…" : "Loading wallet…"}</section>;

  return (
    <section className="rounded-xl border bg-card p-4 space-y-3" data-testid="wallet-summary">
      <h2 className="font-semibold">{language === "fr" ? "Mon portefeuille" : "My wallet"}</h2>
      {!wallet && <p className="text-sm text-destructive">{error}</p>}
      {wallet && (
        <>
          <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
            <p>{language === "fr" ? "Disponible" : "Available"}<strong className="block">{formatFcfa(wallet.availableBalance ?? 0, language)}</strong></p>
            <p>{language === "fr" ? "Bloqué" : "Locked"}<strong className="block">{formatFcfa(wallet.lockedBalance ?? 0, language)}</strong></p>
            <p>{language === "fr" ? "En attente" : "Pending"}<strong className="block">{formatFcfa(wallet.pendingPayoutBalance ?? 0, language)}</strong></p>
            <p>{language === "fr" ? "Déjà versé" : "Paid out"}<strong className="block">{formatFcfa(wallet.paidOutBalance ?? 0, language)}</strong></p>
          </div>
          <p className="text-xs text-muted-foreground">
            {wallet.withdrawalAvailability?.statusLabel
              ?? (ready
                ? (language === "fr" ? "Fonds disponibles pour retrait immédiat." : "Funds available for withdrawal now.")
                : (language === "fr" ? "Retrait indisponible : aucun fonds retirable." : "Withdrawal unavailable: no withdrawable funds."))}
            {" "}{language === "fr" ? "Délai FedaPay estimé : 2–3 jours ouvrés." : "Estimated FedaPay transfer: 2–3 business days."}
          </p>
          <div className="flex flex-wrap gap-2">
            <Input
              aria-label={language === "fr" ? "Montant du retrait" : "Withdrawal amount"}
              inputMode="numeric"
              value={amount}
              onChange={(event) => setAmount(event.target.value.replace(/\D/g, ""))}
              placeholder={language === "fr" ? "Montant FCFA" : "Amount FCFA"}
              disabled={!ready || submitting}
              className="max-w-48"
            />
            <Button type="button" onClick={() => { void submit(); }} disabled={!ready || submitting || !amount}>
              {submitting ? (language === "fr" ? "Envoi…" : "Submitting…") : (language === "fr" ? "Retirer" : "Withdraw")}
            </Button>
          </div>
          {message && <p className="text-xs text-green-700" role="status">{message}</p>}
          {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
          <div className="space-y-1">
            <h3 className="text-xs font-semibold">{language === "fr" ? "Mouvements récents" : "Recent movements"}</h3>
            {(wallet.recentMovements ?? []).slice(0, 5).map((movement) => (
              <p key={movement.id} className="flex justify-between gap-2 text-xs text-muted-foreground">
                <span>{movement.entryType} · {new Date(movement.createdAt).toLocaleDateString(language === "fr" ? "fr-FR" : "en-US")}</span>
                <span>{movement.direction === "credit" ? "+" : "−"}{formatFcfa(movement.amount, language)}</span>
              </p>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
