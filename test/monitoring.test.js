import test from "node:test";
import assert from "node:assert/strict";
import { onRequest as monitor } from "../functions/api/_middleware.js";
import { onRequestGet as health } from "../functions/api/health.js";

test("API middleware adds a request ID to successful responses", async () => {
  const data = {};
  const response = await monitor({
    request: new Request("https://example.test/api/posts", { headers: { "x-request-id": "test-request-123" } }),
    data,
    next: async () => new Response("ok"),
  });
  assert.equal(response.headers.get("x-request-id"), "test-request-123");
  assert.equal(data.requestId, "test-request-123");
});

test("API middleware sanitizes uncaught errors", async () => {
  const original = console.error;
  console.error = () => {};
  try {
    const response = await monitor({
      request: new Request("https://example.test/api/posts"), data: {},
      next: async () => { throw new Error("secret database detail"); },
    });
    assert.equal(response.status, 500);
    const body = await response.json();
    assert.equal(body.error, "internal error");
    assert.ok(body.request_id);
    assert.doesNotMatch(JSON.stringify(body), /secret database detail/);
    assert.equal(response.headers.get("x-request-id"), body.request_id);
  } finally { console.error = original; }
});

test("health check is hidden without its dedicated token", async () => {
  const response = await health({
    request: new Request("https://example.test/api/health"),
    env: { HEALTH_CHECK_TOKEN: "monitor-token" }, data: {},
  });
  assert.equal(response.status, 404);
});

test("health check verifies D1 and R2 bindings", async () => {
  const response = await health({
    request: new Request("https://example.test/api/health", { headers: { authorization: "Bearer monitor-token" } }),
    env: {
      HEALTH_CHECK_TOKEN: "monitor-token",
      DB: { prepare: () => ({ first: async () => ({ ok: 1 }) }) },
      FILES: { head: async () => null },
    },
    data: { requestId: "health-request" },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
});

test("health check reports dependency failure without details", async () => {
  const original = console.error;
  console.error = () => {};
  try {
    const response = await health({
      request: new Request("https://example.test/api/health", { headers: { authorization: "Bearer monitor-token" } }),
      env: {
        HEALTH_CHECK_TOKEN: "monitor-token",
        DB: { prepare: () => ({ first: async () => { throw new Error("private D1 detail"); } }) },
        FILES: { head: async () => null },
      },
      data: { requestId: "health-request" },
    });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { status: "unavailable" });
  } finally { console.error = original; }
});

