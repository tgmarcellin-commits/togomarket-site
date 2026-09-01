import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID } from "node:crypto";
import test from "node:test";
import bcrypt from "bcryptjs";
import { io as connect, type Socket } from "socket.io-client";
import { Server } from "socket.io";
import {
  adminAccountsTable,
  conversationsTable,
  db,
  messagesTable,
  pool,
  vendorsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import app from "../app";
import { registerSocketHandlers, setIo } from "./socket-io";

type ApiResult = {
  response: Response;
  body: unknown;
};

type InboxMessage = {
  id: number;
  conversationId: number;
  senderType: string;
  content: string | null;
};

type NewMessageEvent = {
  conversationId: number;
  message: InboxMessage;
};

let server: http.Server;
let ioServer: Server;
let baseUrl: string;

test.before(async () => {
  server = http.createServer(app);
  ioServer = new Server(server, {
    path: "/api/socket.io",
    cors: { origin: "*", methods: ["GET", "POST"] },
    transports: ["polling", "websocket"],
  });
  setIo(ioServer);
  registerSocketHandlers(ioServer);

  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve());
    server.once("error", reject);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server did not expose a TCP address");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.after(async () => {
  await new Promise<void>((resolve, reject) => {
    ioServer.close((error) => error ? reject(error) : resolve());
  });
  await pool.end();
});

async function request(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
): Promise<ApiResult> {
  const method = options.method ?? "GET";
  const headers = new Headers(options.headers);
  if (options.body !== undefined) {
    headers.set("content-type", "application/json");
  }
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    const csrfResponse = await fetch(`${baseUrl}/api/security/csrf-token`);
    assert.equal(csrfResponse.status, 200);
    const csrf = await csrfResponse.json() as { csrfToken: string };
    headers.set("x-csrf-token", csrf.csrfToken);
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  return {
    response,
    body: text ? JSON.parse(text) as unknown : null,
  };
}

function waitForEvent<T>(socket: Socket, event: string, timeoutMs = 5_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handleEvent);
      reject(new Error(`Timed out waiting for Socket.io event "${event}"`));
    }, timeoutMs);
    const handleEvent = (payload: T) => {
      clearTimeout(timer);
      socket.off(event, handleEvent);
      resolve(payload);
    };
    socket.once(event, handleEvent);
  });
}

function collectEvents<T>(socket: Socket, event: string, count: number, timeoutMs = 5_000): Promise<T[]> {
  return new Promise<T[]>((resolve, reject) => {
    const received: T[] = [];
    const timer = setTimeout(() => {
      socket.off(event, handleEvent);
      reject(new Error(`Timed out waiting for ${count} "${event}" events`));
    }, timeoutMs);
    const handleEvent = (payload: T) => {
      received.push(payload);
      if (received.length < count) return;
      clearTimeout(timer);
      socket.off(event, handleEvent);
      resolve(received);
    };
    socket.on(event, handleEvent);
  });
}

async function connectSocket(): Promise<Socket> {
  const socket = connect(baseUrl, {
    path: "/api/socket.io",
    transports: ["websocket"],
    autoConnect: false,
  });
  const connected = waitForEvent<void>(socket, "connect");
  socket.connect();
  await connected;
  return socket;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("authenticated admin room receives concurrent vendor replies and clears its unread badge", async () => {
  const adminUsername = `socket-test-${randomUUID()}`;
  const adminCode = randomUUID();
  const vendorPassword = randomUUID();
  const vendorPhone = `228${Date.now()}${Math.floor(Math.random() * 10_000)}`;
  let vendorId: number | undefined;
  let adminAccountId: number | undefined;
  let adminSocket: Socket | undefined;
  let unauthenticatedSocket: Socket | undefined;

  try {
    const [adminAccount] = await db.insert(adminAccountsTable).values({
      username: adminUsername,
      role: "superadmin",
      codeHash: await bcrypt.hash(adminCode, 4),
    }).returning({ id: adminAccountsTable.id });
    adminAccountId = adminAccount.id;

    const [vendor] = await db.insert(vendorsTable).values({
      firstName: "Socket",
      lastName: "Integration",
      phone: vendorPhone,
      passwordHash: await bcrypt.hash(vendorPassword, 4),
      verified: true,
      isPublished: true,
      expiryDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
      paymentStatus: "active",
      validationMethod: "test",
    }).returning({ id: vendorsTable.id });
    vendorId = vendor.id;

    const [conversation] = await db.insert(conversationsTable).values({
      vendorId: vendor.id,
      buyerName: "TogoMarket",
      buyerPhone: "##007##",
      buyerToken: randomUUID(),
      buyerKeyHash: null,
      listingTitle: "Message de test",
      adminUnreadCount: 0,
    }).returning({ id: conversationsTable.id });
    await db.insert(messagesTable).values({
      conversationId: conversation.id,
      senderType: "buyer",
      content: "Message initial TogoMarket",
    });

    adminSocket = await connectSocket();
    unauthenticatedSocket = await connectSocket();
    const adminAuth = waitForEvent<void>(adminSocket, "admin_auth_ok");
    adminSocket.emit("admin_auth", { password: adminCode });
    await adminAuth;

    const unauthenticatedEvents: NewMessageEvent[] = [];
    unauthenticatedSocket.on("new_message", (payload: NewMessageEvent) => {
      unauthenticatedEvents.push(payload);
    });
    const adminEvents = collectEvents<NewMessageEvent>(adminSocket, "new_message", 2);

    const replies = await Promise.all([
      request(`/api/conversations/${conversation.id}/messages`, {
        method: "POST",
        headers: {
          "x-vendor-phone": vendorPhone,
          "x-vendor-password": vendorPassword,
        },
        body: { content: "Réponse vendeur concurrente A" },
      }),
      request(`/api/conversations/${conversation.id}/messages`, {
        method: "POST",
        headers: {
          "x-vendor-phone": vendorPhone,
          "x-vendor-password": vendorPassword,
        },
        body: { content: "Réponse vendeur concurrente B" },
      }),
    ]);
    assert.deepEqual(replies.map(({ response }) => response.status), [201, 201]);

    const events = await adminEvents;
    assert.equal(events.length, 2);
    assert.ok(events.every((event) => event.conversationId === conversation.id));
    assert.deepEqual(
      new Set(events.map((event) => event.message.content)),
      new Set(["Réponse vendeur concurrente A", "Réponse vendeur concurrente B"]),
    );
    await delay(100);
    assert.equal(unauthenticatedEvents.length, 0);

    const listed = await request("/api/admin/broadcast-inbox", {
      method: "POST",
      body: { password: adminCode },
    });
    assert.equal(listed.response.status, 200);
    const listedBody = listed.body as {
      conversations: Array<{ id: number; adminUnreadCount: number; lastMessage: string | null }>;
    };
    const listedConversation = listedBody.conversations.find(({ id }) => id === conversation.id);
    assert.ok(listedConversation);
    assert.equal(listedConversation.adminUnreadCount, 2);
    assert.ok(
      ["Réponse vendeur concurrente A", "Réponse vendeur concurrente B"].includes(
        listedConversation.lastMessage ?? "",
      ),
    );

    const thread = await request(`/api/admin/broadcast-inbox/${conversation.id}/messages`, {
      method: "POST",
      body: { password: adminCode },
    });
    assert.equal(thread.response.status, 200);
    const threadMessages = (thread.body as { messages: InboxMessage[] }).messages;
    assert.equal(threadMessages.length, 3);
    assert.deepEqual(
      new Set(threadMessages.map((message) => message.content)),
      new Set([
        "Message initial TogoMarket",
        "Réponse vendeur concurrente A",
        "Réponse vendeur concurrente B",
      ]),
    );

    const markedRead = await request(`/api/admin/broadcast-inbox/${conversation.id}/read`, {
      method: "POST",
      body: { password: adminCode },
    });
    assert.equal(markedRead.response.status, 200);
    assert.deepEqual(markedRead.body, { ok: true });

    const afterRead = await request("/api/admin/broadcast-inbox", {
      method: "POST",
      body: { password: adminCode },
    });
    const afterReadConversation = (afterRead.body as {
      conversations: Array<{ id: number; adminUnreadCount: number }>;
    }).conversations.find(({ id }) => id === conversation.id);
    assert.ok(afterReadConversation);
    assert.equal(afterReadConversation.adminUnreadCount, 0);
  } finally {
    adminSocket?.disconnect();
    unauthenticatedSocket?.disconnect();
    if (vendorId !== undefined) {
      await db.delete(vendorsTable).where(eq(vendorsTable.id, vendorId));
    }
    if (adminAccountId !== undefined) {
      await db.delete(adminAccountsTable).where(eq(adminAccountsTable.id, adminAccountId));
    }
  }
});