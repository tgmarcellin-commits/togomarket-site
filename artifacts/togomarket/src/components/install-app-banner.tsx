import { useState } from "react";
import { Download, Share } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePwaInstall } from "@/lib/pwa-install";
import { useSiteSettings } from "@/lib/site-settings";

/**
 * Bandeau « Installer l'application », affiché à l'arrivée par un lien de partage d'article.
 * N'apparaît que si TogoMarket n'est pas déjà installée (voir usePwaInstall).
 */
export function InstallAppBanner() {
  const { lang } = useSiteSettings();
  const { canInstall, ios, install } = usePwaInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (!canInstall) return null;

  const handleInstall = async () => {
    const result = await install();
    if (result === "ios-guide") setShowIOSGuide(true);
  };

  return (
    <div className="rounded-xl bg-primary text-primary-foreground p-3 shadow-lg">
      <div className="flex items-center gap-3">
        <Download className="w-5 h-5 flex-shrink-0" />
        <p className="flex-1 min-w-0 text-sm font-medium leading-tight">
          {lang === "fr"
            ? "Installez TogoMarket pour discuter avec le vendeur plus facilement."
            : "Install TogoMarket to chat with the seller more easily."}
        </p>
        <Button size="sm" variant="secondary" className="h-8 text-xs font-bold flex-shrink-0" onClick={handleInstall}>
          {lang === "fr" ? "Installer l'application" : "Install the app"}
        </Button>
      </div>
      {ios && showIOSGuide && (
        <p className="mt-2 text-xs leading-snug flex items-start gap-1.5">
          <Share className="w-4 h-4 flex-shrink-0 mt-px" />
          <span>
            {lang === "fr"
              ? "Dans Safari : appuyez sur Partager, puis « Sur l'écran d'accueil », puis « Ajouter »."
              : "In Safari: tap Share, then “Add to Home Screen”, then “Add”."}
          </span>
        </p>
      )}
    </div>
  );
}
