import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import bcrypt from "bcryptjs";
import {
  buyerPushSubscriptionsTable,
  conversationBuyerTokensTable,
  conversationsTable,
  db,
  messagesTable,
  pool,
  pushSubscriptionsTable,
  vendorsTable,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import app from "../app";
import { hashBuyerKey } from "./conversation-access";

type ApiResult = {
  response: Response;
  body: any;
};

type TestVendor = {
  id: number;
  phone: string;
  password: string;
};

let server: http.Server;
let baseUrl: string;

test.before(async () => {
  server = app.listen(0);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve());
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
    server.close((error) => error ? reject(error) : resolve());
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
    body: text ? JSON.parse(text) : null,
  };
}

async function createTestVendor(): Promise<TestVendor> {
  const password = "conversation-merge-test-password";
  const phone = `228${Date.now()}${Math.floor(Math.random() * 10000)}`;
  const [vendor] = await db.insert(vendorsTable).values({
    firstName: "Merge",
    lastName: "Test",
    phone,
    passwordHash: await bcrypt.hash(password, 4),
    verified: true,
    isPublished: true,
    expiryDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
    paymentStatus: "active",
    validationMethod: "test",
  }).returning({ id: vendorsTable.id, phone: vendorsTable.phone });
  return { ...vendor, password };
}

async function deleteTestVendor(vendorId: number): Promise<void> {
  await db.delete(vendorsTable).where(eq(vendorsTable.id, vendorId));
}

async function seedConversation(values: {
  vendorId: number;
  buyerName: string;
  buyerPhone: string;
  buyerToken: string;
  buyerKeyHash?: string | null;
  listingId?: number | null;
  listingTitle?: string | null;
  listingImage?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
  vendorUnreadCount?: number;
  buyerUnreadCount?: number;
  adminUnreadCount?: number;
}) {
  const [conversation] = await db.insert(conversationsTable).values({
    vendorId: values.vendorId,
    buyerName: values.buyerName,
    buyerPhone: values.buyerPhone,
    buyerToken: values.buyerToken,
    buyerKeyHash: values.buyerKeyHash ?? null,
    listingId: values.listingId ?? null,
    listingTitle: values.listingTitle ?? null,
    listingImage: values.listingImage ?? null,
    createdAt: values.createdAt,
    updatedAt: values.updatedAt,
    vendorUnreadCount: values.vendorUnreadCount,
    buyerUnreadCount: values.buyerUnreadCount,
    adminUnreadCount: values.adminUnreadCount,
  }).returning();
  return conversation;
}

test("concurrent creations with one buyer key return one conversation", async () => {
  const vendor = await createTestVendor();
  try {
    const buyerKey = `concurrent-buyer-key-${Date.now()}-${Math.random()}`;
    const results = await Promise.all([
      request("/api/conversations", {
        method: "POST",
        body: {
          vendorId: vendor.id,
          buyerName: "Acheteur concurrent A",
          buyerPhone: "22890000001",
          buyerKey,
        },
      }),
      request("/api/conversations", {
        method: "POST",
        body: {
          vendorId: vendor.id,
          buyerName: "Acheteur concurrent B",
          buyerPhone: "22890000001",
          buyerKey,
        },
      }),
    ]);

    assert.deepEqual(results.map(({ response }) => response.status).sort(), [200, 201]);
    assert.equal(results[0].body.id, results[1].body.id);
    assert.equal(results[0].body.buyerToken, results[1].body.buyerToken);

    const conversations = await db
      .select()
      .from(conversationsTable)
      .where(and(
        eq(conversationsTable.vendorId, vendor.id),
        eq(conversationsTable.buyerKeyHash, hashBuyerKey(`guest:${buyerKey}`)),
      ));
    assert.equal(conversations.length, 1);
  } finally {
    await deleteTestVendor(vendor.id);
  }
});

test("alias merge keeps legacy ids, messages, attachments, unread counters, and subscriptions", async () => {
  const vendor = await createTestVendor();
  try {
    const now = Date.now();
    const canonicalToken = `canonical-token-${now}`;
    const duplicateToken = `duplicate-token-${now}`;
    const canonical = await seedConversation({
      vendorId: vendor.id,
      buyerName: "Acheteur historique",
      buyerPhone: "22890000002",
      buyerToken: canonicalToken,
      listingId: 101,
      listingTitle: "Annonce historique A",
      listingImage: "/objects/uploads/listing-a",
      createdAt: new Date(now - 10_000),
      updatedAt: new Date(now - 5_000),
      vendorUnreadCount: 2,
      buyerUnreadCount: 1,
      adminUnreadCount: 3,
    });
    const duplicate = await seedConversation({
      vendorId: vendor.id,
      buyerName: "Acheteur historique",
      buyerPhone: "22890000002",
      buyerToken: duplicateToken,
      buyerKeyHash: hashBuyerKey(`guest:alias-${now}`),
      listingId: 202,
      listingTitle: "Annonce historique B",
      listingImage: "/objects/uploads/listing-b",
      createdAt: new Date(now - 8_000),
      updatedAt: new Date(now - 1_000),
      vendorUnreadCount: 4,
      buyerUnreadCount: 5,
      adminUnreadCount: 6,
    });
    await db.insert(messagesTable).values([
      {
        conversationId: canonical.id,
        senderType: "buyer",
        content: "Message du fil canonique",
        createdAt: new Date(now - 7_000),
      },
      {
        conversationId: duplicate.id,
        senderType: "vendor",
        content: null,
        fileUrl: "/objects/uploads/merged-attachment",
        fileType: "pdf",
        createdAt: new Date(now - 500),
      },
    ]);
    await db.insert(buyerPushSubscriptionsTable).values({
      conversationId: duplicate.id,
      endpoint: `https://push.example.test/${now}`,
      keys: { auth: "auth", p256dh: "p256dh" },
    });

    const list = await request("/api/conversations/buyer-list", {
      method: "POST",
      body: { buyerTokens: [canonicalToken, duplicateToken] },
    });

    assert.equal(list.response.status, 200);
    assert.equal(list.body.conversations.length, 1);
    assert.equal(list.body.conversations[0].id, canonical.id);

    const [merged] = await db
      .select()
      .from(conversationsTable)
      .where(eq(conversationsTable.id, canonical.id));
    assert.ok(merged);
    assert.equal(merged.vendorUnreadCount, 6);
    assert.equal(merged.buyerUnreadCount, 6);
    assert.equal(merged.adminUnreadCount, 9);

    const removedDuplicate = await db
      .select()
      .from(conversationsTable)
      .where(eq(conversationsTable.id, duplicate.id));
    assert.equal(removedDuplicate.length, 0);

    const [alias] = await db
      .select()
      .from(conversationBuyerTokensTable)
      .where(eq(conversationBuyerTokensTable.token, duplicateToken));
    assert.ok(alias);
    assert.equal(alias.conversationId, canonical.id);
    assert.equal(alias.legacyConversationId, duplicate.id);

    const mergedMessages = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.conversationId, canonical.id));
    assert.equal(mergedMessages.length, 2);
    assert.ok(mergedMessages.some((message) => message.fileUrl === "/objects/uploads/merged-attachment"));
    assert.deepEqual(
      new Set(mergedMessages.map((message) => message.listingTitle)),
      new Set(["Annonce historique A", "Annonce historique B"]),
    );
    assert.deepEqual(
      new Set(mergedMessages.map((message) => message.listingId)),
      new Set([101, 202]),
    );

    const subscriptions = await db
      .select()
      .from(buyerPushSubscriptionsTable)
      .where(eq(buyerPushSubscriptionsTable.conversationId, canonical.id));
    assert.equal(subscriptions.length, 1);

    const legacyRead = await request(`/api/conversations/${duplicate.id}`, {
      headers: { "x-buyer-token": duplicateToken },
    });
    assert.equal(legacyRead.response.status, 200);
    assert.deepEqual(legacyRead.body, { id: canonical.id });

    const legacyMessages = await request(`/api/conversations/${duplicate.id}/messages`, {
      headers: { "x-buyer-token": duplicateToken },
    });
    assert.equal(legacyMessages.response.status, 200);
    assert.equal(legacyMessages.body.length, 2);
    assert.deepEqual(
      new Set(legacyMessages.body.map((message: { listingTitle: string | null }) => message.listingTitle)),
      new Set(["Annonce historique A", "Annonce historique B"]),
    );
  } finally {
    await deleteTestVendor(vendor.id);
  }
});

test("two stable identities sharing a phone remain isolated", async () => {
  const vendor = await createTestVendor();
  try {
    const sharedPhone = "22890000003";
    const first = await seedConversation({
      vendorId: vendor.id,
      buyerName: "Identité stable A",
      buyerPhone: sharedPhone,
      buyerToken: `stable-a-${Date.now()}`,
      buyerKeyHash: hashBuyerKey("stable-identity-a"),
    });
    const second = await seedConversation({
      vendorId: vendor.id,
      buyerName: "Identité stable B",
      buyerPhone: sharedPhone,
      buyerToken: `stable-b-${Date.now()}`,
      buyerKeyHash: hashBuyerKey("stable-identity-b"),
    });
    await db.insert(messagesTable).values([
      { conversationId: first.id, senderType: "buyer", content: "Privé A" },
      { conversationId: second.id, senderType: "buyer", content: "Privé B" },
    ]);

    const list = await request("/api/conversations/buyer-list", {
      method: "POST",
      body: { buyerTokens: [first.buyerToken, second.buyerToken] },
    });

    assert.equal(list.response.status, 200);
    assert.equal(list.body.conversations.length, 2);
    assert.deepEqual(
      new Set(list.body.conversations.map((conversation: { id: number }) => conversation.id)),
      new Set([first.id, second.id]),
    );

    const remaining = await db
      .select({ id: conversationsTable.id })
      .from(conversationsTable)
      .where(inArray(conversationsTable.id, [first.id, second.id]));
    assert.deepEqual(new Set(remaining.map(({ id }) => id)), new Set([first.id, second.id]));

    const messageRows = await db
      .select({ conversationId: messagesTable.conversationId })
      .from(messagesTable)
      .where(inArray(messagesTable.conversationId, [first.id, second.id]));
    assert.deepEqual(
      new Set(messageRows.map(({ conversationId }) => conversationId)),
      new Set([first.id, second.id]),
    );
  } finally {
    await deleteTestVendor(vendor.id);
  }
});

test("an authenticated vendor request with an explicit buyer token stays buyer-scoped", async () => {
  const vendor = await createTestVendor();
  try {
    const buyerToken = `explicit-buyer-token-${Date.now()}`;
    const conversation = await seedConversation({
      vendorId: vendor.id,
      buyerName: "Acheteur explicite",
      buyerPhone: "22890000004",
      buyerToken,
      buyerKeyHash: hashBuyerKey(`guest:explicit-${Date.now()}`),
    });
    await db.insert(pushSubscriptionsTable).values({
      vendorId: vendor.id,
      endpoint: `https://push.example.test/vendor-${Date.now()}`,
      keys: { auth: "auth", p256dh: "p256dh" },
    });
    await db
      .update(vendorsTable)
      .set({ wantsNotifications: false })
      .where(eq(vendorsTable.id, vendor.id));

    const login = await request("/api/vendors/login", {
      method: "POST",
      body: { phone: vendor.phone, password: vendor.password },
    });
    assert.equal(login.response.status, 200);
    const setCookie = (login.response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.()
      ?? [login.response.headers.get("set-cookie") ?? ""];
    const sessionCookie = setCookie[0]?.split(";")[0];
    assert.ok(sessionCookie);

    const sent = await request(`/api/conversations/${conversation.id}/messages`, {
      method: "POST",
      headers: {
        cookie: sessionCookie,
        "x-buyer-token": buyerToken,
      },
      body: { content: "Réponse envoyée avec le jeton acheteur" },
    });

    assert.equal(sent.response.status, 201);
    assert.equal(sent.body.senderType, "buyer");

    const [message] = await db
      .select()
      .from(messagesTable)
      .where(and(
        eq(messagesTable.conversationId, conversation.id),
        eq(messagesTable.content, "Réponse envoyée avec le jeton acheteur"),
      ));
    assert.ok(message);
    assert.equal(message.senderType, "buyer");
  } finally {
    await deleteTestVendor(vendor.id);
  }
});