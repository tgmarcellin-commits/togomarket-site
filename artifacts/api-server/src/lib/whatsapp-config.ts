// =============================================================================
// CONFIGURATION WHATSAPP BUSINESS API — TogoMarket
// =============================================================================
// Toutes les clés et noms de templates sont ici.
// Pour changer un template, modifiez UNIQUEMENT cette section ou les variables
// d'environnement correspondantes. Ne touchez pas au reste du code.
// =============================================================================

// ── Clés API ─────────────────────────────────────────────────────────────────
// Définissez ces variables dans Replit → Secrets
// WHATSAPP_ACCESS_TOKEN : votre Token permanent Meta (System User token)
// WHATSAPP_PHONE_NUMBER_ID : l'ID du numéro de téléphone dans Meta Business Suite

export const WHATSAPP_ACCESS_TOKEN: string =
  process.env.WHATSAPP_ACCESS_TOKEN ??
  process.env.WHATSAPP_TOKEN ??   // rétrocompatibilité avec l'ancien nom
  "";

export const WHATSAPP_PHONE_NUMBER_ID: string =
  process.env.WHATSAPP_PHONE_NUMBER_ID ?? "";

// Version de l'API Meta Graph (à mettre à jour si Meta publie une version plus récente)
export const META_API_VERSION = "v21.0";

// ── Noms des Message Templates ────────────────────────────────────────────────
// ⚠️  IMPORTANT : remplacez la valeur de chaque variable ci-dessous par le nom
//     EXACT du modèle tel qu'il apparaît dans Meta Business Suite une fois approuvé.
//     Vous pouvez aussi définir la variable d'environnement correspondante dans Replit.

/**
 * Template TYPE : Authentication
 * Langue        : fr
 * Corps prévu   : "Votre code de validation TogoMarket est : {{1}}"
 * Bouton        : "Copier le code" (natif Meta, paramètre = code OTP)
 *
 * ⚠️  Remplacez "togomarket_otp_auth" par le nom exact approuvé par Meta.
 *     Ou définissez la variable d'env WHATSAPP_TEMPLATE_OTP.
 */
export const TEMPLATE_OTP_AUTH: string =
  process.env.WHATSAPP_TEMPLATE_OTP ?? "togomarket_otp_auth";

/**
 * Template TYPE : Utility
 * Langue        : fr
 * Corps prévu   : "Bonjour {{1}}, votre boutique sur TogoMarket expire dans
 *                  3 jours. Pour éviter toute interruption, renouvelez votre
 *                  abonnement ici."
 * Bouton CTA    : "Renouveler" → https://togomarket.site/api/vendors/renewal-link/{{1}}
 *                  ({{1}} dans le bouton = l'ID vendeur, suffixe dynamique)
 *
 * ⚠️  Remplacez "togomarket_renewal_reminder" par le nom exact approuvé par Meta.
 *     Ou définissez la variable d'env WHATSAPP_TEMPLATE_RENEWAL.
 */
export const TEMPLATE_RENEWAL_REMINDER: string =
  process.env.WHATSAPP_TEMPLATE_RENEWAL ?? "togomarket_renewal_reminder";

/**
 * Template TYPE : Utility
 * Langue        : fr
 * Corps prévu   : "Bonjour {{1}}, vous avez un nouveau message de {{2}} sur
 *                  TogoMarket. Activez les notifications pour ne rien manquer :
 *                  Ouvrez l'app → onglet Messages → Activer les notifications."
 * Bouton CTA    : "Ouvrir TogoMarket" → https://togomarket.site
 *
 * ⚠️  Remplacez "togomarket_notif_nudge" par le nom exact approuvé par Meta.
 *     Ou définissez la variable d'env WHATSAPP_TEMPLATE_NOTIF_NUDGE.
 */
export const TEMPLATE_NOTIF_NUDGE: string =
  process.env.WHATSAPP_TEMPLATE_NOTIF_NUDGE ?? "togomarket_notif_nudge";

// URL de base de l'application (utilisée dans les liens CTA)
export const APP_BASE_URL: string =
  process.env.APP_BASE_URL ?? "https://togomarket.site";
