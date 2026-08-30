import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { CorsOptions } from "cors";

const CSRF_COOKIE = "tm_csrf";
const CSRF_HEADER = "x-csrf-token";
const CSRF_TTL_MS = 8 * 60 * 60 * 1000;
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const WEBHOOK_PATHS = new Set(["/api/fedapay-callback"]);

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET?.trim();
  if (!secret) {
    throw new Error("SESSION_SECRET must be configured as a Replit Secret");
  }
  return secret;
}

function configuredOrigins(): Set<string> {
  const values = [
    "https://togomarket.site",
    "https://www.togomarket.site",
    ...(process.env.ALLOWED_ORIGINS ?? "").split(","),
    ...(process.env.REPLIT_DOMAINS ?? "").split(",").map((domain) => domain.trim() ? `https://${domain.trim()}` : ""),
    process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "",
  ];
  return new Set(values.map((value) => value.trim().replace(/\/+$/, "")).filter(Boolean));
}

export function isAllowedOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    if (configuredOrigins().has(url.origin)) return true;
    if (process.env.NODE_ENV !== "production") {
      return (
        (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)) ||
        (url.protocol === "https:" && url.hostname.endsWith(".replit.dev"))
      );
    }
    return false;
  } catch {
    return false;
  }
}

export const corsOptions: CorsOptions = {
  credentials: true,
  methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Accept",
    "Authorization",
    "Content-Type",
    "X-CSRF-Token",
    "X-Buyer-Token",
    "X-Vendor-Phone",
    "X-Vendor-Password",
  ],
  origin(origin, callback) {
    // Requests without Origin are server-to-server, same-origin navigations, or health checks.
    if (!origin || isAllowedOrigin(origin)) {
      callback(null, true);
      return;
    }
    // Do not turn an expected hostile-origin rejection into a 500. CORS omits
    // access headers, then the CSRF middleware returns a controlled 403.
    callback(null, false);
  },
};

export const securityHeaders: RequestHandler = (_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(self), geolocation=()");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
  res.setHeader("Cache-Control", "no-store");
  if (process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
};

function signToken(payload: string): string {
  return createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
}

function createCsrfToken(): string {
  const payload = `${Date.now() + CSRF_TTL_MS}.${randomBytes(24).toString("base64url")}`;
  return `${payload}.${signToken(payload)}`;
}

function validSignature(token: string): boolean {
  const [expiresRaw, nonce, signature, ...extra] = token.split(".");
  if (extra.length || !expiresRaw || !nonce || !signature) return false;
  const expiresAt = Number(expiresRaw);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;
  const expected = Buffer.from(signToken(`${expiresRaw}.${nonce}`));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function issueCsrfToken(_req: Request, res: Response): void {
  const token = createCsrfToken();
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${CSRF_COOKIE}=${encodeURIComponent(token)}; Path=/api; Max-Age=${Math.floor(CSRF_TTL_MS / 1000)}; HttpOnly; SameSite=Strict${secure}`,
  );
  res.setHeader("Cache-Control", "no-store");
  res.json({ csrfToken: token });
}

function requestOrigin(req: Request): string | null {
  const origin = req.headers.origin;
  if (typeof origin === "string" && origin) return origin;
  const referer = req.headers.referer;
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

function isSameRequestOrigin(req: Request, origin: string): boolean {
  try {
    const originUrl = new URL(origin);
    const requestHost = req.get("host");
    if (!requestHost) return false;
    return originUrl.origin === `${req.protocol}://${requestHost}`;
  } catch {
    return false;
  }
}

export const csrfProtection: RequestHandler = (req, res, next) => {
  if (!UNSAFE_METHODS.has(req.method) || WEBHOOK_PATHS.has(req.originalUrl.split("?")[0])) {
    next();
    return;
  }

  const origin = requestOrigin(req);
  if (origin && !isSameRequestOrigin(req, origin) && !isAllowedOrigin(origin)) {
    res.status(403).json({ error: "Origine de requête non autorisée" });
    return;
  }

  const headerToken = req.headers[CSRF_HEADER];
  if (typeof headerToken !== "string" || !validSignature(headerToken)) {
    res.status(403).json({ error: "Jeton CSRF manquant ou invalide", code: "csrf_invalid" });
    return;
  }

  next();
};

type RateRule = { bucket: string; limit: number; windowMs: number };
type RateEntry = { count: number; resetAt: number };
const rateEntries = new Map<string, RateEntry>();

function rateRule(req: Request): RateRule {
  const path = req.path;
  if (/\/(login|verify|verify-otp)$/.test(path)) {
    return { bucket: "auth", limit: 20, windowMs: 15 * 60 * 1000 };
  }
  if (/\/(resend-otp|request-manual-activation|register)$/.test(path)) {
    return { bucket: "otp", limit: 10, windowMs: 10 * 60 * 1000 };
  }
  if (path.includes("/storage/uploads/video")) {
    return { bucket: "video-upload", limit: 5, windowMs: 15 * 60 * 1000 };
  }
  if (path.includes("/storage/uploads/")) {
    return { bucket: "upload", limit: 30, windowMs: 15 * 60 * 1000 };
  }
  if (/\/(orders|contact-requests|reviews|conversations)/.test(path)) {
    return { bucket: "public-mutation", limit: 60, windowMs: 15 * 60 * 1000 };
  }
  return { bucket: "api", limit: req.method === "GET" ? 600 : 240, windowMs: 15 * 60 * 1000 };
}

export const apiRateLimit: RequestHandler = (req, res, next) => {
  const rule = rateRule(req);
  const now = Date.now();
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const key = `${ip}:${rule.bucket}`;
  const current = rateEntries.get(key);
  const entry = !current || current.resetAt <= now
    ? { count: 1, resetAt: now + rule.windowMs }
    : { count: current.count + 1, resetAt: current.resetAt };
  rateEntries.set(key, entry);

  res.setHeader("RateLimit-Limit", String(rule.limit));
  res.setHeader("RateLimit-Remaining", String(Math.max(0, rule.limit - entry.count)));
  res.setHeader("RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));

  if (entry.count > rule.limit) {
    res.setHeader("Retry-After", String(Math.max(1, Math.ceil((entry.resetAt - now) / 1000))));
    res.status(429).json({ error: "Trop de requêtes. Réessayez plus tard." });
    return;
  }

  if (rateEntries.size > 10_000) {
    for (const [entryKey, value] of rateEntries) {
      if (value.resetAt <= now) rateEntries.delete(entryKey);
    }
  }
  next();
};

export function sanitizedErrorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  req.log.error({ err }, "Unhandled request error");
  if (res.headersSent) return;
  res.status(500).json({ error: "Erreur interne" });
}