import type { Request, Response } from "express";
import { logger } from "./logger";

/**
 * Marks a deliberate, hand-crafted business-rule validation failure (e.g.
 * "Journal déséquilibré", "Portefeuille introuvable") as safe to surface
 * verbatim to the client. Any other thrown error (DB/driver/infra failure)
 * must never reach the client as-is, since it may contain SQL/internal
 * details — see `respondToRouteError` below.
 */
export class BusinessRuleError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 | 409 = 400,
  ) {
    super(message);
    this.name = "BusinessRuleError";
  }
}

/**
 * Logs an unhandled route error with safe, non-sensitive context (route name,
 * request identifiers — never secrets, documents, or phone numbers) and
 * responds with the existing `{ error: string }` safe-message shape used
 * across the API, instead of letting the exception bubble up to the generic
 * sanitized error handler (which would hide the specific failing screen).
 *
 * Use this in catch blocks of routes that perform DB queries/aggregations on
 * legacy or partially migrated data, so a single failing subsection does not
 * turn into an opaque 500 for the whole screen.
 */
export function logAndRespondInternalError(
  req: Request,
  res: Response,
  options: {
    route: string;
    message: string;
    err: unknown;
    context?: Record<string, unknown>;
  },
): void {
  const log = req.log ?? logger;
  log.error(
    {
      err: options.err,
      route: options.route,
      ...options.context,
    },
    "Route handler failed",
  );
  if (res.headersSent) return;
  res.status(500).json({ error: options.message });
}

/**
 * Standard catch-block handler for routes whose underlying service function
 * throws `BusinessRuleError` for known, safe-to-expose validation failures
 * (invalid input, missing entity, duplicate action, etc.) and a plain
 * `Error` (or anything else) for unexpected infra/DB failures. Known errors
 * are returned verbatim with their intended status code; everything else is
 * logged server-side only and replaced with a safe generic French 500
 * message, so a raw DB/driver error message can never reach the client.
 */
export function respondToRouteError(
  req: Request,
  res: Response,
  err: unknown,
  options: {
    route: string;
    message: string;
    context?: Record<string, unknown>;
  },
): void {
  if (err instanceof BusinessRuleError) {
    if (res.headersSent) return;
    res.status(err.status).json({ error: err.message });
    return;
  }
  logAndRespondInternalError(req, res, { ...options, err });
}
