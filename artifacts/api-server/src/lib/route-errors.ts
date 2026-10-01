import type { Request, Response } from "express";
import { logger } from "./logger";

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
