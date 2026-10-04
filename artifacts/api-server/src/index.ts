import http from "node:http";
import { Server } from "socket.io";
import app from "./app";
import { logger } from "./lib/logger";
import { startRenewalReminderCron } from "./lib/renewal-reminder";
import { startConversationsCleanupCron } from "./lib/conversations-cleanup";
import { registerSocketHandlers, setIo } from "./lib/socket-io";
import { startDeliveryAssignmentExpiryCron } from "./lib/delivery-assignment-expiry";
import { startPartyLocationPurgeCron } from "./lib/party-location-purge";
import { runBuyerWalletMigrationOnStartup } from "./lib/buyer-accounts";
import { startDriverTransferExpiryCron } from "./lib/driver-transfer";
import { startWithdrawalReconcileCron } from "./lib/wallet-payouts";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Wrap Express in an HTTP server so Socket.io can share the port
const httpServer = http.createServer(app);

const io = new Server(httpServer, {
  path: "/api/socket.io",
  cors: { origin: "*", methods: ["GET", "POST"] },
  transports: ["websocket"],
});

setIo(io);
registerSocketHandlers(io);

function startListening(): void {
  httpServer.listen(port, (err?: Error) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
    startRenewalReminderCron();
    startConversationsCleanupCron();
    startDeliveryAssignmentExpiryCron();
    startPartyLocationPurgeCron();
    startDriverTransferExpiryCron();
    startWithdrawalReconcileCron();
  });
}

// Portefeuille unique par numéro (BUYER_WALLET_BY_PHONE=true) : le regroupement des anciens portefeuilles acheteur se
// termine AVANT d'accepter la moindre requête, pour qu'aucun paiement ni règlement ne touche un portefeuille à moitié
// migré. Sans la variable, cette étape est instantanée. Garde-fou : le serveur démarre quand même après 60 s.
const MIGRATION_TIMEOUT_MS = 60_000;
void Promise.race([
  runBuyerWalletMigrationOnStartup(),
  new Promise<void>((resolve) => setTimeout(resolve, MIGRATION_TIMEOUT_MS)),
]).finally(startListening);
