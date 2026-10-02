import { useCallback, useEffect, useState } from "react";
import { Bell, BellOff, BellRing, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSiteSettings } from "@/lib/site-settings";
import {
  activateDriverPush,
  checkDriverPush,
  deactivateDriverPush,
  type DriverPushState,
} from "@/lib/driver-push";

const DISMISS_KEY = "tm_driver_push_dismissed";

/** « Plus tard » ne vaut que pour la connexion en cours : un nouveau jeton = un nouveau rappel. */
function fingerprint(token: string): string {
  return token.slice(0, 12);
}

/**
 * Notifications push du livreur, visibles en permanence sur sa page :
 *  - pas encore activées -> rappel avec bouton « Activer les notifications » à CHAQUE connexion ;
 *  - activées            -> simple pastille « Notifications activées », plus aucun rappel.
 */
export function DriverPushControl({ token }: { token: string }) {
  const { lang } = useSiteSettings();
  const isFrench = lang === "fr";
  const [state, setState] = useState<DriverPushState>("checking");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(() => {
    try { return sessionStorage.getItem(DISMISS_KEY) === fingerprint(token); } catch { return false; }
  });

  useEffect(() => {
    let cancelled = false;
    setState("checking");
    void checkDriverPush(token).then((next) => { if (!cancelled) setState(next); });
    return () => { cancelled = true; };
  }, [token]);

  const activate = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setState(await activateDriverPush(token));
    } catch {
      setError(isFrench
        ? "Activation impossible pour le moment. Réessayez dans un instant."
        : "Could not enable notifications right now. Please try again.");
    } finally {
      setBusy(false);
    }
  }, [token, isFrench]);

  const deactivate = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await deactivateDriverPush(token);
      setState("needs-activation");
      // Le livreur vient de désactiver volontairement : pas de rappel pour cette connexion.
      try { sessionStorage.setItem(DISMISS_KEY, fingerprint(token)); } catch { /* stockage indisponible */ }
      setDismissed(true);
    } finally {
      setBusy(false);
    }
  }, [token]);

  const later = () => {
    try { sessionStorage.setItem(DISMISS_KEY, fingerprint(token)); } catch { /* stockage indisponible */ }
    setDismissed(true);
  };

  if (state === "checking") return null;

  if (state === "active") {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-green-200 bg-green-50 px-4 py-2 text-xs text-green-800">
        <span className="inline-flex items-center gap-2">
          <BellRing className="h-4 w-4" aria-hidden="true" />
          {isFrench ? "Notifications activées" : "Notifications enabled"}
        </span>
        <button
          type="button"
          onClick={() => { void deactivate(); }}
          disabled={busy}
          className="underline underline-offset-2 hover:no-underline disabled:opacity-50"
        >
          {isFrench ? "Désactiver" : "Turn off"}
        </button>
      </div>
    );
  }

  // Pas activées : rappel à chaque connexion, sauf si le livreur a choisi « Plus tard » pour celle-ci.
  if (dismissed) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <BellOff className="h-4 w-4" aria-hidden="true" />
          {isFrench ? "Notifications désactivées" : "Notifications off"}
        </span>
        {state === "needs-activation" && (
          <button type="button" onClick={() => { void activate(); }} disabled={busy} className="font-semibold text-primary underline underline-offset-2 hover:no-underline disabled:opacity-50">
            {isFrench ? "Activer" : "Enable"}
          </button>
        )}
      </div>
    );
  }

  if (state === "unsupported") {
    return (
      <div className="rounded-xl border bg-muted/40 px-4 py-3 text-xs text-muted-foreground" role="status">
        <p>
          {isFrench
            ? "Ce navigateur ne permet pas les notifications. Sur iPhone, ajoutez TogoMarket à l'écran d'accueil puis rouvrez l'application."
            : "This browser does not support notifications. On iPhone, add TogoMarket to your home screen and reopen the app."}
        </p>
        <button type="button" onClick={later} className="mt-2 underline underline-offset-2 hover:no-underline">
          {isFrench ? "Plus tard" : "Later"}
        </button>
      </div>
    );
  }

  if (state === "denied") {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-900" role="status">
        <p className="font-semibold">{isFrench ? "Notifications bloquées" : "Notifications blocked"}</p>
        <p>
          {isFrench
            ? "Autorisez les notifications pour ce site dans les réglages du navigateur, puis rechargez la page. Vous serez ainsi prévenu dès qu'une course est payée."
            : "Allow notifications for this site in your browser settings, then reload. You will be alerted as soon as a delivery is paid."}
        </p>
        <button type="button" onClick={later} className="mt-2 underline underline-offset-2 hover:no-underline">
          {isFrench ? "Plus tard" : "Later"}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm" role="status">
      <p className="font-semibold">
        {isFrench ? "Activez les notifications" : "Enable notifications"}
      </p>
      <p className="text-xs text-muted-foreground">
        {isFrench
          ? "Soyez prévenu sur votre téléphone dès qu'une course est payée et que vous pouvez partir."
          : "Get alerted on your phone as soon as a delivery is paid and you can leave."}
      </p>
      {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
      <div className="flex items-center gap-3">
        <Button type="button" size="sm" className="gap-2" onClick={() => { void activate(); }} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />}
          {isFrench ? "Activer les notifications" : "Enable notifications"}
        </Button>
        <button type="button" onClick={later} disabled={busy} className="text-xs text-muted-foreground underline underline-offset-2 hover:no-underline">
          {isFrench ? "Plus tard" : "Later"}
        </button>
      </div>
    </div>
  );
}
