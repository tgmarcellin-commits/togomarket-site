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
import { lookupVendorSessionDetails } from "./lib/vendor-auth";

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
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  const assignVendor = (vendorId: number, expiresAt?: Date) => {
    for (const room of socket.rooms) {
      if (room.startsWith("vendor:") && room !== `vendor:${vendorId}`) socket.leave(room);
    }
    socket.join(`vendor:${vendorId}`);
    socket.data.vendorId = vendorId;
    if (expiryTimer) clearTimeout(expiryTimer);
    if (expiresAt) {
      const delay = Math.max(0, Math.min(expiresAt.getTime() - Date.now(), 2_147_483_647));
      expiryTimer = setTimeout(() => socket.disconnect(true), delay);
    }
    socket.emit("auth_ok", { vendorId });
  };

  // Resolve cookie auth once and make it authoritative for this connection.
  // Legacy auth waits for this promise, preventing dual-vendor room races.
  const cookieAuth = lookupVendorSessionDetails(socket.handshake.headers.cookie)
    .then((session) => {
      if (session) assignVendor(session.vendor.id, session.expiresAt);
      return session;
    })
    .catch((err) => {
      logger.warn({ err }, "socket session authentication error");
      return null;
    });

  // Vendor authenticates: emit "auth" { phone, password }
  socket.on("auth", async ({ phone, password }: { phone: string; password: string }) => {
    if (!phone || !password) return;
    try {
      const session = await cookieAuth;
      if (session) {
        assignVendor(session.vendor.id, session.expiresAt);
        return;
      }
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
      assignVendor(vendor.id);
      logger.debug({ vendorId: vendor.id }, "vendor socket authed");
    } catch (err) {
      logger.error({ err }, "socket auth error");
    }
  });

  socket.on("disconnect", () => {
    if (expiryTimer) clearTimeout(expiryTimer);
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
