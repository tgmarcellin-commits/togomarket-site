import { io, type Socket } from "socket.io-client";

let _socket: Socket | null = null;

/**
 * Returns a singleton Socket.io client.
 * The client connects to the same origin as the page, using the backend's
 * /api/socket.io path so it flows through Replit's reverse proxy correctly.
 */
export function getSocket(): Socket {
  if (!_socket) {
    _socket = io(window.location.origin, {
      path: "/api/socket.io",
      transports: ["polling", "websocket"],
      autoConnect: true,
      withCredentials: true,
    });
  }
  return _socket;
}

export async function joinBuyerConversationRooms(
  socket: Socket,
  sessions: Array<{ convId: number; buyerToken: string }>,
): Promise<void> {
  await Promise.allSettled(
    sessions.map(async (session) => {
      await socket.timeout(5_000).emitWithAck("join_conv", {
        conversationId: session.convId,
        buyerToken: session.buyerToken,
      });
    }),
  );
}
