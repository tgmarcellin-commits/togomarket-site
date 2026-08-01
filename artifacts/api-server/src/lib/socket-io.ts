import { Server } from "socket.io";

// Singleton Socket.io instance, initialised in index.ts
let _io: Server | null = null;

export function setIo(io: Server) {
  _io = io;
}

export function getIo(): Server {
  if (!_io) throw new Error("Socket.io not initialised");
  return _io;
}
