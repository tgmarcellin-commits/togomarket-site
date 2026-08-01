// =============================================================================
// WHATSAPP BUSINESS API — Fonctions d'envoi
// =============================================================================
// Ce fichier contient toutes les fonctions d'envoi WhatsApp.
// Les noms de templates et clés API sont dans whatsapp-config.ts.
// =============================================================================

import {
  WHATSAPP_ACCESS_TOKEN,
  WHATSAPP_PHONE_NUMBER_ID,
  META_API_VERSION,
  TEMPLATE_OTP_AUTH,
  TEMPLATE_RENEWAL_REMINDER,
  TEMPLATE_NOTIF_NUDGE,
} from "./whatsapp-config";

// ─────────────────────────────────────────────────────────────────────────────
// Rate-limit en mémoire : 1 relance WhatsApp max par vendeur par heure
// Clé = vendorId, Valeur = timestamp du dernier envoi (ms)
// ─────────────────────────────────────────────────────────────────────────────
const notifNudgeLastSent = new Map<number, number>();
const NUDGE_COOLDOWN_MS = 60 * 60 * 1000; // 1 heure

export function canSendNudge(vendorId: number): boolean {
  const last = notifNudgeLastSent.get(vendorId);
  return !last || Date.now() - last > NUDGE_COOLDOWN_MS;
}

export function markNudgeSent(vendorId: number): void {
  notifNudgeLastSent.set(vendorId, Date.now());
}
import { logger } from "./logger";

// ─────────────────────────────────────────────────────────────────────────────
// Fonction interne : appel POST vers l'API Meta Cloud
// Ne lève une exception que si l'API répond avec une erreur HTTP.
// L'appelant est responsable de la gestion d'erreur non-fatale.
// ─────────────────────────────────────────────────────────────────────────────
async function callMetaAPI(payload: unknown): Promise<void> {
  if (!WHATSAPP_ACCESS_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
    throw new Error(
      "WhatsApp non configuré : définissez WHATSAPP_ACCESS_TOKEN et WHATSAPP_PHONE_NUMBER_ID dans les Secrets Replit."
    );
  }

  const url = `https://graph.facebook.com/${META_API_VERSION}/${WHATSAPP_PHONE_NUMBER_ID}/messages`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    // Timeout de 15 secondes — le serveur ne se bloque pas si Meta ne répond pas
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "unknown error");
    throw new Error(`WhatsApp API ${res.status}: ${errText}`);
  }
}

// =============================================================================
// 0. ENVOI TEXTE LIBRE — Notification interne / admin
// =============================================================================
// Envoie un message texte libre à un numéro donné (ex. notification admin).
// À utiliser uniquement pour des numéros ayant déjà contacté le compte WhatsApp
// Business dans les 24h (contrainte Meta "user-initiated window").
// Pour les notifications sortantes vers des vendeurs, utiliser les templates.
// =============================================================================
export async function sendWhatsAppText(phone: string, text: string): Promise<void> {
  await callMetaAPI({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: phone,
    type: "text",
    text: { body: text },
  });
}

// =============================================================================
// 1. ENVOI OTP — Template d'Authentification
// =============================================================================
// Tente d'envoyer le code via le template Meta de type "Authentication".
// Si le template n'est pas encore approuvé par Meta, bascule automatiquement
// en message texte libre (fallback) pour ne pas bloquer l'inscription.
//
// ⚠️  Configuration du template dans Meta Business Suite :
//     Type    : Authentication
//     Langue  : Français (fr)
//     Corps   : "Votre code de validation TogoMarket est : {{1}}"
//     Bouton  : "Copier le code" (auto-fill, paramètre = code OTP)
//     Nom     : voir TEMPLATE_OTP_AUTH dans whatsapp-config.ts
// =============================================================================
export async function sendWhatsAppOTP(
  phone: string,
  code: string,
  firstName: string
): Promise<void> {
  // ── Tentative via template d'Authentification Meta ──────────────────────
  try {
    await callMetaAPI({
      messaging_product: "whatsapp",
      to: phone,
      type: "template",
      template: {
        // ⚠️  Remplacez dans whatsapp-config.ts ou via env WHATSAPP_TEMPLATE_OTP
        name: TEMPLATE_OTP_AUTH,
        language: { code: "fr" },
        components: [
          {
            // Paramètre {{1}} du corps : le code OTP à 6 chiffres
            type: "body",
            parameters: [{ type: "text", text: code }],
          },
          {
            // Bouton "Copier le code" (index 0 du template Authentication)
            // Le paramètre est le même code OTP
            type: "button",
            sub_type: "url",
            index: "0",
            parameters: [{ type: "text", text: code }],
          },
        ],
      },
    });
    return; // Succès via template — on s'arrête ici
  } catch (err) {
    // Le template n'est peut-être pas encore approuvé — on logue et on continue
    logger.warn(
      { err, phone },
      "Template OTP Auth indisponible — fallback vers message texte libre"
    );
  }

  // ── Fallback : texte libre (fonctionne avant approbation Meta) ───────────
  // À SUPPRIMER une fois le template approuvé par Meta si souhaité.
  await callMetaAPI({
    messaging_product: "whatsapp",
    to: phone,
    type: "text",
    text: {
      body:
        `Bonjour ${firstName} 👋\n\n` +
        `Votre code de vérification TogoMarket :\n\n` +
        `*${code}*\n\n` +
        `Ce code est valable 5 minutes. Ne le partagez avec personne.\n\n` +
        `— L'équipe TogoMarket`,
    },
  });
}

// =============================================================================
// 2. RAPPEL DE RENOUVELLEMENT — Template Utilitaire
// =============================================================================
// Envoie un rappel 3 jours avant l'expiration de la boutique.
// Cette fonction est appelée par le cron quotidien (renewal-reminder.ts).
//
// ⚠️  Configuration du template dans Meta Business Suite :
//     Type    : Utility
//     Langue  : Français (fr)
//     Corps   : "Bonjour {{1}}, votre boutique sur TogoMarket expire dans
//                3 jours. Pour éviter toute interruption, renouvelez votre
//                abonnement ici."
//     Bouton  : Type = URL dynamique
//               Texte du bouton = "Renouveler maintenant"
//               URL de base = "https://togomarket.site/api/vendors/renewal-link/"
//               Suffixe dynamique {{1}} = l'ID du vendeur (ex: "42")
//     Nom     : voir TEMPLATE_RENEWAL_REMINDER dans whatsapp-config.ts
//
// Si le template n'est pas approuvé, cette fonction lève une exception
// que le cron capture pour logger et continuer sans bloquer les autres envois.
// =============================================================================
// =============================================================================
// 3. RELANCE ACTIVATION NOTIFICATIONS — Template Utilitaire Meta
// =============================================================================
// Envoyé quand un acheteur écrit à un vendeur qui n'a pas activé les notifs push.
// Rate-limit : 1 message max par heure par vendeur (voir canSendNudge / markNudgeSent).
//
// ⚠️  Configuration du template dans Meta Business Suite :
//     Nom      : togomarket_notif_nudge  (ou valeur de WHATSAPP_TEMPLATE_NOTIF_NUDGE)
//     Type     : Utility (Utilitaire)
//     Langue   : Français (fr)
//     En-tête  : (aucun)
//     Corps    : "Bonjour {{1}}, vous avez un nouveau message de {{2}} sur TogoMarket.
//                 Activez les notifications pour ne rien manquer :
//                 Ouvrez l'app → onglet Messages → Activer les notifications."
//     Pied     : (aucun)
//     Bouton   : Type = URL statique
//                Texte = "Ouvrir TogoMarket"
//                URL   = https://togomarket.site
// =============================================================================
export async function sendWhatsAppNotifNudge(
  phone: string,
  firstName: string,
  buyerName: string,
): Promise<void> {
  await callMetaAPI({
    messaging_product: "whatsapp",
    to: phone,
    type: "template",
    template: {
      name: TEMPLATE_NOTIF_NUDGE,
      language: { code: "fr" },
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: firstName },   // {{1}} = prénom du vendeur
            { type: "text", text: buyerName },   // {{2}} = nom de l'acheteur
          ],
        },
      ],
    },
  });
}

export async function sendRenewalReminderTemplate(
  phone: string,
  firstName: string,
  vendorId: number
): Promise<void> {
  await callMetaAPI({
    messaging_product: "whatsapp",
    to: phone,
    type: "template",
    template: {
      // ⚠️  Remplacez dans whatsapp-config.ts ou via env WHATSAPP_TEMPLATE_RENEWAL
      name: TEMPLATE_RENEWAL_REMINDER,
      language: { code: "fr" },
      components: [
        {
          // Paramètre {{1}} du corps : le prénom du vendeur
          type: "body",
          parameters: [{ type: "text", text: firstName }],
        },
        {
          // Bouton CTA URL (index 0) : suffixe dynamique = ID vendeur
          // URL finale = https://togomarket.site/api/vendors/renewal-link/<vendorId>
          type: "button",
          sub_type: "url",
          index: "0",
          parameters: [{ type: "text", text: String(vendorId) }],
        },
      ],
    },
  });
}
