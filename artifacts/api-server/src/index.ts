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
    startMessagesExpiryCleanupCron();
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

import { db, messagesTable } from "@workspace/db";
import { lt } from "drizzle-orm";

/**
 * Nettoyage automatique des messages expirés (> 72h) de la base de données.
 * Exécuté 30 secondes après le démarrage, puis toutes les 6 heures.
 */
function startMessagesExpiryCleanupCron(): void {
  const INTERVAL_MS = 6 * 60 * 60 * 1000;
  const STARTUP_DELAY_MS = 30 * 1000;

  const purgeExpiredMessages = async () => {
    try {
      const cutoffDate = new Date(Date.now() - 72 * 3600 * 1000);
      await db
        .delete(messagesTable)
        .where(lt(messagesTable.createdAt, cutoffDate));
      logger.info("Purge des messages expirés (> 72h) exécutée avec succès.");
    } catch (err) {
      logger.error({ err }, "Erreur lors de la purge automatique des messages expirés");
    }
  };

  setTimeout(async () => {
    await purgeExpiredMessages();
    setInterval(purgeExpiredMessages, INTERVAL_MS);
  }, STARTUP_DELAY_MS);
}
