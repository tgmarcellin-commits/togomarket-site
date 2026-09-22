import path from "node:path";
import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import {
  apiRateLimit,
  corsOptions,
  csrfProtection,
  issueCsrfToken,
  sanitizedErrorHandler,
  securityHeaders,
} from "./lib/http-security";

const app: Express = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(securityHeaders);
app.use(cors(corsOptions));
app.use(express.json({
  limit: "2mb",
  strict: true,
  verify(req, _res, buffer) {
    (req as typeof req & { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
  },
}));
app.use(express.urlencoded({ extended: false, limit: "256kb", parameterLimit: 100 }));

app.get("/api/security/csrf-token", issueCsrfToken);
app.use("/api", apiRateLimit);
app.use("/api", csrfProtection);
app.use("/api", router);

// --- AJOUT : Servir le frontend React en production ---
const frontendDistPath = path.resolve(__dirname, "../../togomarket/dist");
app.use(express.static(frontendDistPath));

// Route universelle (Catch-all) pour rediriger vers le frontend React (SPA)
app.get(/.*/, (_req, res) => {
  res.sendFile(path.resolve(frontendDistPath, "index.html"));
});
// ------------------------------------------------------

app.use(sanitizedErrorHandler);

export default app;
