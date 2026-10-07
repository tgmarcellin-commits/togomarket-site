import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  /** Message affiché à la place de la fenêtre du jeu. */
  message: string;
  retryLabel: string;
  /** Appelé quand la fenêtre plante (ex. pour la refermer). */
  onFailure?: () => void;
};

/**
 * Filet de sécurité autour de la fenêtre du challenge « 10Défis » : si elle plante à l'affichage, seul le challenge est
 * indisponible. Sans lui, l'erreur remonte jusqu'au filet global du site et TOUTE la page devient « Une erreur est survenue ».
 */
export class GameDialogBoundary extends Component<Props, { failed: boolean; detail: string }> {
  state = { failed: false, detail: "" };

  static getDerivedStateFromError(error: unknown): { failed: boolean; detail: string } {
    // Seul le MESSAGE de l'erreur est conservé (jamais la pile) : assez pour identifier la cause sur une capture d'écran
    const message = error instanceof Error ? error.message : String(error);
    return { failed: true, detail: message.slice(0, 200) };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Message explicite dans la console du navigateur pour retrouver la cause (ex. fichier de contenu obsolète)
    console.error("Challenge 10Défis : erreur d'affichage de la fenêtre —", error.message, info.componentStack);
    this.props.onFailure?.();
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="mx-4 mb-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive" data-testid="game-dialog-failed">
        <p>{this.props.message}</p>
        {this.state.detail && (
          <p className="mt-1 break-words font-mono text-[10px] text-muted-foreground" data-testid="game-dialog-failed-detail">
            Détail technique : {this.state.detail}
          </p>
        )}
        <button
          type="button"
          onClick={() => this.setState({ failed: false, detail: "" })}
          className="mt-1.5 font-medium underline underline-offset-2 hover:no-underline"
        >
          {this.props.retryLabel}
        </button>
      </div>
    );
  }
}
