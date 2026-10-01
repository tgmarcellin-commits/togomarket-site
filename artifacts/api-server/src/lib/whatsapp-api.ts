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
  TEMPLATE_NOTIF_NUDGE,
  TEMPLATE_DRIVER_ASSIGNMENT,
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
import { normalizePhone } from "./phone";

// ─────────────────────────────────────────────────────────────────────────────
// Fonction interne : appel POST vers l'API Meta Cloud
// Expose les erreurs HTTP Meta pour que les routes puissent les journaliser
// et répondre sans transformer un échec d'envoi en faux succès.
// ─────────────────────────────────────────────────────────────────────────────
export class WhatsAppMetaError extends Error {
  constructor(
    public readonly status: number,
    public readonly responseBody: string,
  ) {
    super(`WhatsApp API ${status}: ${responseBody}`);
    this.name = "WhatsAppMetaError";
  }
}

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

  let responseBody: string;
  try {
    responseBody = await res.text();
  } catch (err) {
    responseBody = `Unable to read Meta response body: ${err instanceof Error ? err.message : String(err)}`;
  }
  if (!res.ok) throw new WhatsAppMetaError(res.status, responseBody);
}

// =============================================================================
// NORMALISATION WHATSAPP — Numéros béninois
// =============================================================================
// WhatsApp/Meta identifie les numéros béninois avec l'ANCIEN format
// international (229 + 8 chiffres), sans le préfixe national "01".
// On retire donc automatiquement le "01" (ou le "1" des numéros mal
// enregistrés) avant tout envoi, sinon l'OTP n'arrive jamais.
// =============================================================================
export function toWhatsAppNumber(raw: string): string {
  const s = normalizePhone(raw); // canonique : 22901XXXXXXXX pour le Bénin
  if (/^22901\d{8}$/.test(s)) return "229" + s.slice(5); // 22901XXXXXXXX → 229XXXXXXXX
  return s;
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
    to: toWhatsAppNumber(phone),
    type: "text",
    text: { body: text },
  });
}

// =============================================================================
// 1. ENVOI OTP — Template d'Authentification
// =============================================================================
// Envoie le code uniquement via le template Meta de type "Authentication".
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
  _firstName: string,
): Promise<void> {
  await callMetaAPI({
    messaging_product: "whatsapp",
    to: toWhatsAppNumber(phone),
    type: "template",
    template: {
      name: TEMPLATE_OTP_AUTH,
      language: { code: "fr" },
      components: [
        {
          type: "body",
          parameters: [{ type: "text", text: code }],
        },
        {
          type: "button",
          sub_type: "url",
          index: "0",
          parameters: [{ type: "text", text: code }],
        },
      ],
    },
  });
}

export async function sendWhatsAppUtilityTemplate(
  phone: string,
  templateName: string,
  parameters: string[],
): Promise<void> {
  await callMetaAPI({
    messaging_product: "whatsapp",
    to: toWhatsAppNumber(phone),
    type: "template",
    template: {
      name: templateName || TEMPLATE_DRIVER_ASSIGNMENT,
      language: { code: "fr" },
      components: [{
        type: "body",
        parameters: parameters.map((text) => ({ type: "text", text })),
      }],
    },
  });
}

// =============================================================================
// 2. RELANCE ACTIVATION NOTIFICATIONS — Template Utilitaire Meta
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
    to: toWhatsAppNumber(phone),
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
