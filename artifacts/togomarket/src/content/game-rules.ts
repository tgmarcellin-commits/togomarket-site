/**
 * Contenu du challenge « 10Défis » (carte « Divertissement » et règlement). Tout le texte à modifier est ICI :
 * le composant de la fenêtre n'en contient aucun.
 *
 * ⚠️ Si vous modifiez le règlement, changez GAME_RULES_VERSION ET CURRENT_GAME_RULES_VERSION
 * (artifacts/api-server/src/lib/game-rules.ts) : chacun devra ré-accepter la nouvelle version.
 */
export const GAME_RULES_VERSION = "2026-10";

export type GameRulesArticle = { title: string; body: string };

export type GameContent = {
  card: {
    title: string;
    badge: string;
    description: string;
    highlights: string[];
    /** Texte alternatif de l'affiche (lecteurs d'écran, image absente) : reprend tout ce que dit l'affiche. */
    imageAlt: string;
    button: string;
  };
  dialog: {
    title: string;
    description: string;
    rulesRegionLabel: string;
    nameLabel: string;
    namePlaceholder: string;
    phoneLabel: string;
    phoneHelp: string;
    phonePlaceholder: string;
    accountNote: string;
    checkbox: string;
    cancel: string;
    sendCode: string;
    codeLabel: string;
    /** {phone} est remplacé par le numéro masqué. */
    codeHelp: string;
    codePlaceholder: string;
    verifyAndPlay: string;
    resend: string;
    changeNumber: string;
    play: string;
    playing: string;
    gameUnavailable: string;
    genericError: string;
    networkError: string;
  };
  rules: GameRulesArticle[];
};

export const GAME_CONTENT_FR: GameContent = {
  card: {
    title: "Divertissement",
    badge: "Challenge mensuel · Gratuit",
    description:
      "Relevez le challenge « 10Défis » : terminez les 10 niveaux chaque semaine, grimpez au classement du mois et gagnez un solde 10défis à dépenser sur TogoMarket.",
    highlights: [
      "100 % gratuit, aucune obligation d'achat",
      "Un solde 10défis chaque semaine pour celui qui termine les 10 niveaux",
      "Une dotation en plus pour le top 3 du mois",
    ],
    imageAlt:
      "Affiche du challenge « 10Défis » : terminez les 10 niveaux chaque semaine, grimpez au classement du mois et gagnez un solde 10défis à dépenser sur TogoMarket. 100 % gratuit, aucune obligation d'achat. Un solde 10défis chaque semaine pour celui qui termine les 10 niveaux. Une dotation en plus pour le top 3 du mois.",
    button: "Découvrir le challenge",
  },
  dialog: {
    title: "Règlement du challenge « 10Défis »",
    description: "Lisez le règlement, indiquez votre nom et votre numéro WhatsApp, puis acceptez pour continuer. Un code de vérification vous sera envoyé par WhatsApp.",
    rulesRegionLabel: "Règlement du jeu (zone défilante)",
    nameLabel: "Votre nom",
    namePlaceholder: "Ex : Amavi Koffi",
    phoneLabel: "Votre numéro WhatsApp",
    phoneHelp: "Avec l'indicatif de votre pays, par exemple +22897000000.",
    phonePlaceholder: "Ex : +22897000000",
    accountNote: "Pas encore de compte acheteur TogoMarket ? Il sera créé automatiquement avec ce numéro.",
    checkbox: "J'ai lu et j'accepte le règlement du jeu",
    cancel: "Annuler",
    sendCode: "Continuer : recevoir mon code WhatsApp",
    codeLabel: "Code reçu sur WhatsApp",
    codeHelp: "Un code à 6 chiffres a été envoyé sur WhatsApp au numéro {phone}. Il est valable 5 minutes.",
    codePlaceholder: "123456",
    verifyAndPlay: "Valider et jouer",
    resend: "Renvoyer un code",
    changeNumber: "Modifier mon numéro",
    play: "Continuer / Jouer",
    playing: "Un instant…",
    gameUnavailable: "Le jeu n'est pas disponible pour le moment. Réessayez plus tard.",
    genericError: "Enregistrement impossible pour le moment. Réessayez.",
    networkError: "Connexion impossible. Vérifiez votre réseau et réessayez.",
  },
  rules: [
    {
      title: "Article 1 : Organisation",
      body: "TogoMarket organise un challenge ludique mensuel et gratuit intitulé « 10Défis ».",
    },
    {
      title: "Article 2 : Gratuité et Sans Obligation d'Achat",
      body: "Le jeu est entièrement gratuit et sans aucune obligation d'achat. Aucune mise financière n'est requise.",
    },
    {
      title: "Article 3 : Principe du Jeu",
      body: "Le challenge combine habileté et score sur un classement mensuel.",
    },
    {
      title: "Article 4 : Dotations",
      body:
        "Chaque semaine, le joueur qui termine les 10 niveaux reçoit un solde virtuel \"10défis\". En fin de mois, les trois premiers du classement reçoivent en plus une dotation supplémentaire. Ce solde est utilisable exclusivement pour acheter des articles sur TogoMarket. Il est strictement non-retirable et non-convertible en espèces (cash).",
    },
    {
      title: "Article 5 : Anti-Triche",
      body: "L'organisateur se réserve le droit de disqualifier tout cas de triche ou multi-compte.",
    },
  ],
};

/** Traduction anglaise (le texte de référence est le texte français). */
export const GAME_CONTENT_EN: GameContent = {
  card: {
    title: "Entertainment",
    badge: "Monthly challenge · Free",
    description:
      "Take on the “10Défis” challenge: finish the 10 levels every week, climb the monthly ranking and win a 10défis balance to spend on TogoMarket.",
    highlights: [
      "100% free, no purchase required",
      "A 10défis balance each week for whoever finishes the 10 levels",
      "An extra reward for the month's top 3",
    ],
    imageAlt:
      "“10Défis” challenge poster: finish the 10 levels every week, climb the monthly ranking and win a 10défis balance to spend on TogoMarket. 100% free, no purchase required. A 10défis balance each week for whoever finishes the 10 levels. An extra reward for the month's top 3.",
    button: "Discover the challenge",
  },
  dialog: {
    title: "“10Défis” challenge rules",
    description: "Read the rules, enter your name and WhatsApp number, then accept to continue. A verification code will be sent to you on WhatsApp.",
    rulesRegionLabel: "Game rules (scrollable area)",
    nameLabel: "Your name",
    namePlaceholder: "e.g. Amavi Koffi",
    phoneLabel: "Your WhatsApp number",
    phoneHelp: "With your country code, for example +22897000000.",
    phonePlaceholder: "e.g. +22897000000",
    accountNote: "No TogoMarket buyer account yet? One will be created automatically with this number.",
    checkbox: "I have read and accept the game rules",
    cancel: "Cancel",
    sendCode: "Continue: get my WhatsApp code",
    codeLabel: "Code received on WhatsApp",
    codeHelp: "A 6-digit code was sent on WhatsApp to {phone}. It is valid for 5 minutes.",
    codePlaceholder: "123456",
    verifyAndPlay: "Verify and play",
    resend: "Send a new code",
    changeNumber: "Change my number",
    play: "Continue / Play",
    playing: "One moment…",
    gameUnavailable: "The game is not available right now. Please try again later.",
    genericError: "Could not save right now. Please try again.",
    networkError: "Connection failed. Check your network and try again.",
  },
  rules: [
    {
      title: "Article 1: Organisation",
      body: "TogoMarket organises a free monthly game challenge called “10Défis”.",
    },
    {
      title: "Article 2: Free of charge, no purchase necessary",
      body: "The game is entirely free and no purchase is necessary. No financial stake is required.",
    },
    {
      title: "Article 3: How the game works",
      body: "The challenge combines skill and score on a monthly ranking.",
    },
    {
      title: "Article 4: Rewards",
      body:
        "Each week, the player who finishes the 10 levels receives a virtual “10défis” balance. At the end of the month, the top three of the ranking also receive an additional reward. This balance can be used exclusively to buy items on TogoMarket. It is strictly non-withdrawable and cannot be converted into cash.",
    },
    {
      title: "Article 5: Anti-cheating",
      body: "The organiser reserves the right to disqualify any case of cheating or multiple accounts.",
    },
  ],
};

export function getGameContent(lang: string): GameContent {
  return lang === "fr" ? GAME_CONTENT_FR : GAME_CONTENT_EN;
}
