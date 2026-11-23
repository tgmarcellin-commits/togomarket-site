// =============================================================================
// E-MAILS TRANSACTIONNELS — Brevo (ex-Sendinblue)
// =============================================================================
// Variables d'environnement :
//   BREVO_API_KEY       : clé API v3 Brevo
//   BREVO_SENDER_EMAIL  : expéditeur (doit être un expéditeur validé dans Brevo)
//   BREVO_SENDER_NAME   : nom affiché de l'expéditeur (défaut « TogoMarket »)
// =============================================================================

const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";
const DEFAULT_SENDER_NAME = "TogoMarket";

interface BrevoConfig {
  apiKey: string;
  senderEmail: string;
  senderName: string;
}

function readConfig(): BrevoConfig | null {
  const apiKey = process.env.BREVO_API_KEY?.trim();
  const senderEmail = process.env.BREVO_SENDER_EMAIL?.trim();
  if (!apiKey || !senderEmail) return null;
  return {
    apiKey,
    senderEmail,
    senderName: process.env.BREVO_SENDER_NAME?.trim() || DEFAULT_SENDER_NAME,
  };
}

export function isBrevoConfigured(): boolean {
  return readConfig() !== null;
}

export interface BrevoEmail {
  to: string;
  toName?: string;
  subject: string;
  htmlContent: string;
  textContent: string;
}

/** Envoie un e-mail via l'API Brevo. Lève une erreur (sans secret dans le message) si l'envoi échoue. */
export async function sendBrevoEmail(email: BrevoEmail): Promise<void> {
  const config = readConfig();
  if (!config) {
    throw new Error("Brevo n'est pas configuré (BREVO_API_KEY ou BREVO_SENDER_EMAIL manquant)");
  }

  const response = await fetch(BREVO_API_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "api-key": config.apiKey,
    },
    body: JSON.stringify({
      sender: { name: config.senderName, email: config.senderEmail },
      to: [{ email: email.to, ...(email.toName ? { name: email.toName } : {}) }],
      subject: email.subject,
      htmlContent: email.htmlContent,
      textContent: email.textContent,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const responseText = await response.text().catch(() => "");
    throw new Error(`Brevo a répondu HTTP ${response.status}: ${responseText.slice(0, 300)}`);
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const CHANGE_PASSWORD_PATH = "Profil / Paramètres / Sécurité";

/** E-mail contenant le mot de passe temporaire (ne jamais journaliser `temporaryPassword`). */
export async function sendVendorTemporaryPasswordEmail(params: {
  to: string;
  firstName: string;
  temporaryPassword: string;
}): Promise<void> {
  const { to, firstName, temporaryPassword } = params;
  const name = firstName.trim() || "vendeur";

  const textContent =
    `Bonjour ${name},\n\n` +
    `Vous avez demandé la réinitialisation de votre mot de passe TogoMarket.\n\n` +
    `Votre mot de passe temporaire : ${temporaryPassword}\n\n` +
    `Connectez-vous avec ce mot de passe (avec votre e-mail ou votre numéro), puis modifiez-le immédiatement dans ` +
    `${CHANGE_PASSWORD_PATH}.\n\n` +
    `Si vous n'êtes pas à l'origine de cette demande, contactez l'administrateur TogoMarket.\n\n` +
    `— L'équipe TogoMarket`;

  const htmlContent =
    `<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;color:#111;line-height:1.5">` +
    `<h2 style="margin:0 0 12px">Réinitialisation de votre mot de passe</h2>` +
    `<p>Bonjour ${escapeHtml(name)},</p>` +
    `<p>Vous avez demandé la réinitialisation de votre mot de passe TogoMarket. Voici votre mot de passe temporaire :</p>` +
    `<p style="font-size:22px;font-weight:bold;letter-spacing:2px;background:#f3f4f6;border-radius:8px;padding:12px 16px;text-align:center;font-family:monospace">` +
    `${escapeHtml(temporaryPassword)}</p>` +
    `<p><strong>Important :</strong> après votre connexion, modifiez ce mot de passe dans ` +
    `<strong>${escapeHtml(CHANGE_PASSWORD_PATH)}</strong>.</p>` +
    `<p style="font-size:13px;color:#555">Si vous n'êtes pas à l'origine de cette demande, contactez l'administrateur TogoMarket.</p>` +
    `<p style="font-size:13px;color:#555">— L'équipe TogoMarket</p>` +
    `</div>`;

  await sendBrevoEmail({
    to,
    toName: name,
    subject: "TogoMarket — Votre mot de passe temporaire",
    htmlContent,
    textContent,
  });
}
