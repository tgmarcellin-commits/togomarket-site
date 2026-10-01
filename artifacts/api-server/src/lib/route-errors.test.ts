import assert from "node:assert/strict";
import test from "node:test";
import type { Request, Response } from "express";
import { logAndRespondInternalError } from "./route-errors";

function createMockResponse() {
  const state: { statusCode?: number; body?: unknown; headersSent: boolean } = {
    headersSent: false,
  };
  const res = {
    get headersSent() {
      return state.headersSent;
    },
    status(code: number) {
      state.statusCode = code;
      return res;
    },
    json(body: unknown) {
      state.body = body;
      return res;
    },
  } as unknown as Response;
  return { res, state };
}

function createMockRequest(): Request {
  return {} as Request;
}

test("logAndRespondInternalError responds with 500 and the safe message", () => {
  const { res, state } = createMockResponse();
  const req = createMockRequest();

  logAndRespondInternalError(req, res, {
    route: "GET /test/route",
    message: "Impossible de charger les données.",
    err: new Error("boom"),
  });

  assert.equal(state.statusCode, 500);
  assert.deepEqual(state.body, { error: "Impossible de charger les données." });
});

test("logAndRespondInternalError includes only the safe message, never the raw error", () => {
  const { res, state } = createMockResponse();
  const req = createMockRequest();

  logAndRespondInternalError(req, res, {
    route: "GET /test/route",
    message: "Message sûr pour l'utilisateur.",
    err: new Error("internal secret stack trace detail"),
    context: { orderId: 42 },
  });

  const body = state.body as { error?: string };
  assert.equal(body.error, "Message sûr pour l'utilisateur.");
  assert.ok(!JSON.stringify(body).includes("internal secret stack trace detail"));
});

test("logAndRespondInternalError does not attempt to respond again if headers were already sent", () => {
  const { res, state } = createMockResponse();
  state.headersSent = true;
  const req = createMockRequest();

  logAndRespondInternalError(req, res, {
    route: "GET /test/route",
    message: "Impossible de charger les données.",
    err: new Error("boom"),
  });

  assert.equal(state.statusCode, undefined);
  assert.equal(state.body, undefined);
});
