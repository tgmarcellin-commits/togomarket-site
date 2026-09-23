import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Download, X, Share } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isInStandaloneMode() {
  return window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true;
}

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [showIOSGuide, setShowIOSGuide] = useState(false);
  const ios = isIOS();

  useEffect(() => {
    if (isInStandaloneMode()) return;
    const dismissed = localStorage.getItem("pwa-install-dismissed");
    if (dismissed) return;

    if (ios) {
      const timer = setTimeout(() => setVisible(true), 3000);
      return () => clearTimeout(timer);
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setVisible(true);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, [ios]);

  const handleInstall = async () => {
    if (ios) {
      setShowIOSGuide(true);
      return;
    }
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") setVisible(false);
    setDeferredPrompt(null);
  };

  const handleDismiss = () => {
    setVisible(false);
    setShowIOSGuide(false);
    localStorage.setItem("pwa-install-dismissed", "1");
  };

  if (!visible) return null;

  return (
    <>
      {/* Bannière principale */}
      <div className="fixed top-0 left-0 right-0 z-[100] bg-primary text-primary-foreground px-4 py-3 flex items-center justify-between gap-3 shadow-lg">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <Download className="w-5 h-5 flex-shrink-0" />
          <p className="text-sm font-medium leading-tight">
            Installez TogoMarket sur votre téléphone !
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button
            size="sm"
            variant="secondary"
            className="h-8 text-xs font-bold"
            onClick={handleInstall}
          >
            Installer
          </Button>
          <button onClick={handleDismiss} className="p-1 opacity-80 hover:opacity-100">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Guide iOS */}
      {showIOSGuide && (
        <div
          className="fixed inset-0 z-[110] bg-black/60 flex items-end justify-center p-4"
          onClick={() => setShowIOSGuide(false)}
        >
          <div
            className="bg-white rounded-2xl w-full max-w-sm p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-base">Installer TogoMarket</h3>
              <button onClick={() => setShowIOSGuide(false)}>
                <X className="w-5 h-5 text-muted-foreground" />
              </button>
            </div>
            <p className="text-sm text-muted-foreground">
              Sur iPhone, suivez ces 2 étapes simples dans Safari :
            </p>
            <div className="space-y-3">
              <div className="flex items-start gap-3 bg-muted/50 rounded-xl p-3">
                <div className="bg-primary text-white rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">1</div>
                <div>
                  <p className="text-sm font-semibold">Appuyez sur le bouton Partager</p>
                  <div className="flex items-center gap-1.5 mt-1">
                    <Share className="w-4 h-4 text-blue-500" />
                    <span className="text-xs text-muted-foreground">en bas de l'écran Safari</span>
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-3 bg-muted/50 rounded-xl p-3">
                <div className="bg-primary text-white rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">2</div>
                <div>
                  <p className="text-sm font-semibold">Choisissez "Sur l'écran d'accueil"</p>
                  <p className="text-xs text-muted-foreground mt-1">Puis appuyez sur "Ajouter"</p>
                </div>
              </div>
            </div>
            <Button className="w-full" onClick={() => { setShowIOSGuide(false); handleDismiss(); }}>
              Compris !
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
