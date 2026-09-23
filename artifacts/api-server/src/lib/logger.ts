import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "req.headers.x-csrf-token",
    "req.headers.x-admin-code",
    "req.headers.x-vendor-password",
    "req.body.password",
    "req.body.code",
    "req.body.newCode",
    "req.body.vendorPassword",
    "req.body.ownerCredential",
    "req.body.editToken",
    "res.headers['set-cookie']",
  ],
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
