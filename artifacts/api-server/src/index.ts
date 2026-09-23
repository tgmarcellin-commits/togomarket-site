import http from "node:http";
import { Server } from "socket.io";
import app from "./app";
import { logger } from "./lib/logger";
import { startRenewalReminderCron } from "./lib/renewal-reminder";
import { startConversationsCleanupCron } from "./lib/conversations-cleanup";
import { registerSocketHandlers, setIo } from "./lib/socket-io";
import { startDeliveryAssignmentExpiryCron } from "./lib/delivery-assignment-expiry";

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

httpServer.listen(port, (err?: Error) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  startRenewalReminderCron();
  startConversationsCleanupCron();
  startDeliveryAssignmentExpiryCron();
});
