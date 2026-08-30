import { Server } from "socket.io";

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
