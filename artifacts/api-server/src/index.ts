import http from "node:http";
import { Server } from "socket.io";
import bcrypt from "bcryptjs";
import app from "./app";
import { logger } from "./lib/logger";
import { startRenewalReminderCron } from "./lib/renewal-reminder";
import { startListingsCleanupCron } from "./lib/listings-cleanup";
// Note: startConversationsCleanupCron est défini dans conversations-cleanup.ts
// mais n'est pas activé ici : la suppression auto des conversations n'est pas dans le scope actuel.
import { setIo } from "./lib/socket-io";
import { db, vendorsTable, conversationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { normalizePhone, phoneEq } from "./lib/phone";

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
  transports: ["polling", "websocket"],
});

setIo(io);

// Vendor socket authentication
io.on("connection", (socket) => {
  logger.debug({ id: socket.id }, "socket connected");

  // Vendor authenticates: emit "auth" { phone, password }
  socket.on("auth", async ({ phone, password }: { phone: string; password: string }) => {
    if (!phone || !password) return;
    try {
      const norm = normalizePhone(phone);
      // Use phoneEq inside Drizzle .where() — correct usage as a SQL predicate
      const vendors = await db
        .select()
        .from(vendorsTable)
        .where(phoneEq(vendorsTable.phone, norm))
        .limit(1);
      if (!vendors.length) return;
      const vendor = vendors[0];
      const ok = await bcrypt.compare(password, vendor.passwordHash);
      if (!ok) return;
      // Un socket ne doit appartenir qu'à un seul vendeur à la fois :
      // quitter toute room vendeur précédente (changement de compte sur la même page)
      for (const room of socket.rooms) {
        if (room.startsWith("vendor:") && room !== `vendor:${vendor.id}`) {
          socket.leave(room);
        }
      }
      socket.join(`vendor:${vendor.id}`);
      socket.emit("auth_ok", { vendorId: vendor.id });
      logger.debug({ vendorId: vendor.id }, "vendor socket authed");
    } catch (err) {
      logger.error({ err }, "socket auth error");
    }
  });

  // Buyer joins a conversation room: emit "join_conv" { conversationId, buyerToken }
  // The token is validated against the DB before the socket is admitted to the room.
  socket.on("join_conv", async ({ conversationId, buyerToken }: { conversationId: number; buyerToken: string }) => {
    if (!conversationId || !buyerToken) return;
    try {
      const rows = await db
        .select({ buyerToken: conversationsTable.buyerToken })
        .from(conversationsTable)
        .where(eq(conversationsTable.id, conversationId))
        .limit(1);
      if (!rows.length || rows[0].buyerToken !== buyerToken) {
        logger.warn({ conversationId }, "socket join_conv rejected: invalid token");
        return;
      }
      socket.join(`conv:${conversationId}`);
    } catch (err) {
      logger.error({ err }, "socket join_conv error");
    }
  });

  socket.on("disconnect", () => {
    logger.debug({ id: socket.id }, "socket disconnected");
  });
});

httpServer.listen(port, (err?: Error) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  startRenewalReminderCron();
  startListingsCleanupCron();
  // startConversationsCleanupCron(); // activé ultérieurement (hors scope tâche actuelle)
});
