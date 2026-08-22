import { db, platformSettingsTable } from "@workspace/db";
import { logger } from "./logger";
import { normalizePhone } from "./phone";
import { sendWhatsAppOTP } from "./whatsapp-api";

export const OTP_PROVIDERS = ["WHATSAPP", "TECHSOFT", "MANUAL"] as const;
export type OtpProvider = (typeof OTP_PROVIDERS)[number];

const DEFAULT_OTP_PROVIDER: OtpProvider = "WHATSAPP";
const DEFAULT_VALIDATION_WHATSAPP = "22870703131";

function configuredProvider(value: string | null | undefined): OtpProvider {
  if (!value) return DEFAULT_OTP_PROVIDER;
  if (OTP_PROVIDERS.includes(value as OtpProvider)) return value as OtpProvider;
  logger.warn({ value }, "Unknown OTP provider in platform settings; using WHATSAPP");
  return DEFAULT_OTP_PROVIDER;
}

export async function getOtpConfiguration(): Promise<{
  provider: OtpProvider;
  whatsappValidation: string;
}> {
  const [settings] = await db.select({
    otpProvider: platformSettingsTable.otpProvider,
    whatsappValidation: platformSettingsTable.whatsappValidation,
  }).from(platformSettingsTable).limit(1);

  return {
    provider: configuredProvider(settings?.otpProvider),
    whatsappValidation: settings?.whatsappValidation || DEFAULT_VALIDATION_WHATSAPP,
  };
}

async function sendTechsoftOTP(phone: string, code: string, firstName: string): Promise<void> {
  const endpoint = process.env.TECHSOFT_API_ENDPOINT?.trim();
  const apiKey = process.env.TECHSOFT_API_KEY?.trim();
  const senderId = process.env.TECHSOFT_SENDER_ID?.trim();

  if (!endpoint || !apiKey || !senderId) {
    throw new Error("Techsoft OTP is selected but its endpoint, API key, or sender ID is missing");
  }

  const message =
    `Bonjour ${firstName} ! Votre code de vérification TogoMarket est ${code}. ` +
    "Il est valable 5 minutes. Ne le partagez avec personne.";

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "X-API-Key": apiKey,
      "api-key": apiKey,
    },
    body: JSON.stringify({
      to: normalizePhone(phone),
      phone: normalizePhone(phone),
      message,
      senderId,
      sender_id: senderId,
      from: senderId,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const responseText = await response.text().catch(() => "");
    throw new Error(`Techsoft responded with HTTP ${response.status}: ${responseText.slice(0, 300)}`);
  }
}

export async function dispatchVendorOTP(
  phone: string,
  code: string,
  firstName: string,
): Promise<{ provider: OtpProvider; sent: boolean }> {
  let configuration: Awaited<ReturnType<typeof getOtpConfiguration>>;
  try {
    configuration = await getOtpConfiguration();
  } catch (err) {
    logger.error({ err }, "Unable to read OTP configuration");
    return { provider: DEFAULT_OTP_PROVIDER, sent: false };
  }

  if (configuration.provider === "MANUAL") {
    logger.info({ phone: normalizePhone(phone) }, "OTP stored for manual activation");
    return { provider: configuration.provider, sent: false };
  }

  try {
    if (configuration.provider === "WHATSAPP") {
      await sendWhatsAppOTP(phone, code, firstName);
    } else {
      await sendTechsoftOTP(phone, code, firstName);
    }
    return { provider: configuration.provider, sent: true };
  } catch (err) {
    logger.error(
      { err, provider: configuration.provider, phone: normalizePhone(phone) },
      "OTP delivery failed; code remains stored for manual recovery",
    );
    return { provider: configuration.provider, sent: false };
  }
}