import { useState } from "react";
import { Gamepad2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GameDialogBoundary } from "@/components/game-dialog-boundary";
import { GameRulesDialog } from "@/components/game-rules-dialog";
import { getGameContent } from "@/content/game-rules";
import { useSiteSettings } from "@/lib/site-settings";

/**
 * Affiche du challenge, servie depuis le dossier public du site : artifacts/togomarket/public/challenge-10defis.jpg
 * (même convention que /services-banner.jpg). Pour la remplacer, il suffit de remplacer ce fichier, sans toucher au code.
 * Format conseillé : JPG de 1280 × 630 px (rapport 2 : 1), moins de 250 Ko.
 */
export const GAME_CHALLENGE_IMAGE_SRC = "/challenge-10defis.jpg";

/** Carte « Divertissement » de la section Services : affiche du challenge mensuel « 10Défis » et ouverture du règlement. */
export function GameChallengeCard() {
  const { lang } = useSiteSettings();
  const { card } = getGameContent(lang);
  const [open, setOpen] = useState(false);
  // Image absente ou illisible : la carte retombe sur le texte, elle n'affiche jamais une image cassée
  const [imageFailed, setImageFailed] = useState(false);

  return (
    <>
      <section
        aria-labelledby="game-challenge-title"
        className="mt-6 overflow-hidden rounded-2xl border-2 border-primary/25 bg-gradient-to-br from-primary/10 via-background to-amber-50 shadow-sm"
        data-testid="game-challenge-card"
      >
        <div className="flex items-start gap-3 p-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow" aria-hidden="true">
            <Gamepad2 className="h-6 w-6" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 id="game-challenge-title" className="text-base font-bold leading-tight">{card.title}</h3>
            <p className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
              <Sparkles className="h-3 w-3" aria-hidden="true" />
              {card.badge}
            </p>
            {imageFailed && (
              <>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{card.description}</p>
                <ul className="mt-2 space-y-1 text-xs text-foreground/80">
                  {card.highlights.map((line) => (
                    <li key={line} className="flex gap-1.5"><span aria-hidden="true">✓</span><span>{line}</span></li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
        {!imageFailed && (
          <div className="px-4 pb-4">
            <img
              src={GAME_CHALLENGE_IMAGE_SRC}
              alt={card.imageAlt}
              width={1280}
              height={630}
              loading="lazy"
              decoding="async"
              onError={() => setImageFailed(true)}
              className="h-auto w-full rounded-xl border border-primary/10 shadow-sm"
              data-testid="game-challenge-image"
            />
          </div>
        )}
        <div className="border-t border-primary/15 bg-background/60 p-3">
          <Button type="button" className="w-full gap-2" onClick={() => setOpen(true)}>
            <Gamepad2 className="h-4 w-4" aria-hidden="true" />
            {card.button}
          </Button>
        </div>
      </section>

      <GameDialogBoundary
        onFailure={() => setOpen(false)}
        message={lang === "fr"
          ? "Le challenge est momentanément indisponible. Réessayez dans un instant."
          : "The challenge is temporarily unavailable. Please try again shortly."}
        retryLabel={lang === "fr" ? "Réessayer" : "Try again"}
      >
        <GameRulesDialog open={open} onOpenChange={setOpen} />
      </GameDialogBoundary>
    </>
  );
}
