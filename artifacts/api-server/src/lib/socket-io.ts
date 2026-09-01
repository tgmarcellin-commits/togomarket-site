import { Server } from "socket.io";
import bcrypt from "bcryptjs";
import { db, vendorsTable } from "@workspace/db";
import { normalizePhone, phoneEq } from "./phone";
import { lookupVendorSessionDetails } from "./vendor-auth";
import { resolveBuyerConversationId } from "./conversation-access";
import { isSuperAdmin } from "./admin-auth";
import { logger } from "./logger";

// Singleton Socket.io instance, initialised in index.ts
let _io: Server | null = null;

export const ADMIN_ROOM = "admin";

export function setIo(io: Server) {
  _io = io;
}

export function getIo(): Server {
  if (!_io) throw new Error("Socket.io not initialised");
  return _io;
}

/**
 * Broadcast an event to authenticated superadmin sockets.
 * Socket.io creates the room when the first admin joins it.
 */
export function emitToAdmin(event: string, payload: unknown): void {
  getIo().to(ADMIN_ROOM).emit(event, payload);
}

/**
 * Register the authentication and conversation room handlers used by the
 * production Socket.io server. Keeping the registration here lets integration
 * tests exercise the exact same handlers without importing the process entry
 * point (which would also start the server and background jobs).
 */
export function registerSocketHandlers(io: Server): void {
  io.on("connection", (socket) => {
    logger.debug({ id: socket.id }, "socket connected");
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    const assignVendor = (vendorId: number, expiresAt?: Date) => {
      socket.leave(ADMIN_ROOM);
      socket.data.admin = false;
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

    // The admin dashboard authenticates separately because its session is kept
    // in memory in the browser rather than in the vendor cookie.
    socket.on("admin_auth", async ({ password }: { password?: string }) => {
      if (!password) return;
      try {
        if (!await isSuperAdmin(password)) return;
        await cookieAuth;

        // Never keep a socket authenticated as both a vendor and an admin.
        for (const room of socket.rooms) {
          if (room.startsWith("vendor:")) socket.leave(room);
        }
        socket.join(ADMIN_ROOM);
        socket.data.admin = true;
        socket.emit("admin_auth_ok");
        logger.debug({ id: socket.id }, "admin socket authed");
      } catch (err) {
        logger.warn({ err }, "admin socket authentication error");
      }
    });

    socket.on("admin_leave", () => {
      socket.leave(ADMIN_ROOM);
      socket.data.admin = false;
    });

    socket.on("disconnect", () => {
      if (expiryTimer) clearTimeout(expiryTimer);
      logger.debug({ id: socket.id }, "socket disconnected");
    });

    // Buyer joins a conversation room: emit "join_conv" { conversationId, buyerToken }
    // The token is validated against the DB before the socket is admitted to the room.
    socket.on("join_conv", async (
      { conversationId, buyerToken }: { conversationId: number; buyerToken: string },
      acknowledge?: (result: { ok: boolean; conversationId?: number }) => void,
    ) => {
      if (!conversationId || !buyerToken) {
        acknowledge?.({ ok: false });
        return;
      }
      try {
        const canonicalId = await resolveBuyerConversationId(conversationId, buyerToken);
        if (!canonicalId) {
          logger.warn({ conversationId }, "socket join_conv rejected: invalid token");
          acknowledge?.({ ok: false });
          return;
        }
        socket.join(`conv:${canonicalId}`);
        acknowledge?.({ ok: true, conversationId: canonicalId });
        socket.emit("join_conv_ok", { requestedConversationId: conversationId, conversationId: canonicalId });
      } catch (err) {
        acknowledge?.({ ok: false });
        logger.error({ err }, "socket join_conv error");
      }
    });
  });
}
