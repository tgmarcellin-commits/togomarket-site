import { useEffect, useState } from "react";

/**
 * Installation de la PWA TogoMarket — état partagé par toute l'application.
 *
 * L'événement `beforeinstallprompt` n'est déclenché par le navigateur (Chrome/Android) QUE si
 * l'application n'est pas déjà installée : tant qu'il n'est pas reçu, on ne propose rien.
 * Ce module est importé dans main.tsx pour capter l'événement dès le chargement de la page,
 * avant que les composants React ne soient affichés.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function isIOS(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

/** Vrai quand la page tourne DANS l'application installée (donc déjà installée). */
export function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let installedThisSession = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    installedThisSession = false; // le navigateur confirme que l'app n'est pas installée
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    installedThisSession = true;
    notify();
  });
}

export type PwaInstallResult = "accepted" | "dismissed" | "ios-guide" | "unavailable";

export function usePwaInstall() {
  const [, rerender] = useState(0);
  useEffect(() => {
    const listener = () => rerender((n) => n + 1);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);

  const ios = isIOS();
  // On ne propose l'installation que si l'app n'est pas déjà installée / ouverte en mode application.
  const canInstall = !installedThisSession && !isStandalone() && (ios || deferredPrompt !== null);

  const install = async (): Promise<PwaInstallResult> => {
    if (ios) return "ios-guide"; // iOS : pas d'invite native, on affiche le guide Safari
    const prompt = deferredPrompt;
    if (!prompt) return "unavailable";
    deferredPrompt = null; // l'événement n'est utilisable qu'une seule fois
    notify();
    try {
      await prompt.prompt();
      const { outcome } = await prompt.userChoice;
      if (outcome === "accepted") {
        installedThisSession = true;
        notify();
      }
      return outcome;
    } catch {
      return "unavailable";
    }
  };

  return { canInstall, ios, install };
}
