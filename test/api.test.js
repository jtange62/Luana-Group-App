import test from "node:test";
import assert from "node:assert/strict";

import { json, makeToken, verifyToken } from "../functions/api/_helpers.js";
import { onRequestGet as getEvents } from "../functions/api/events.js";

const SESSION_SECRET = "test-only-session-secret-that-is-long-enough";

test("private JSON responses disable caching", async () => {
  const response = json({ ok: true });
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("Content-Type"), "application/json; charset=utf-8");
  assert.deepEqual(await response.json(), { ok: true });
});

test("session tokens verify only with the configured secret", async () => {
  const token = await makeToken({ SESSION_SECRET });
  assert.equal(await verifyToken({ SESSION_SECRET }, token), true);
  assert.equal(await verifyToken({ SESSION_SECRET: "different-secret" }, token), false);
  await assert.rejects(() => makeToken({}), /SESSION_SECRET is not configured/);
});

function databaseSpy(results = []) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      const call = { sql, bindings: [] };
      calls.push(call);
      return {
        bind(...bindings) { call.bindings = bindings; return this; },
        async all() { return { results }; },
      };
    },
  };
}

async function authorizedRequest(url) {
  const token = await makeToken({ SESSION_SECRET });
  return new Request(url, { headers: { Authorization: `Bearer ${token}` } });
}

test("event range queries bind the inclusive range in recurrence-safe order", async () => {
  const DB = databaseSpy([{ id: "event-1" }]);
  const request = await authorizedRequest("https://example.test/api/events?from=2026-07-01&to=2026-07-31");
  const response = await getEvents({ request, env: { DB, SESSION_SECRET } });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { events: [{ id: "event-1" }] });
  assert.deepEqual(DB.calls[0].bindings, ["2026-07-31", "2026-07-01", "2026-07-01", "2026-07-31"]);
  assert.match(DB.calls[0].sql, /recur_until/);
  assert.match(DB.calls[0].sql, /start_date BETWEEN \? AND \?/);
});

test("event range validation rejects incomplete, reversed, and malformed ranges", async () => {
  const cases = [
    "?from=2026-07-01",
    "?from=2026-08-01&to=2026-07-01",
    "?from=July-1&to=2026-07-31",
  ];

  for (const query of cases) {
    const DB = databaseSpy();
    const request = await authorizedRequest(`https://example.test/api/events${query}`);
    const response = await getEvents({ request, env: { DB, SESSION_SECRET } });
    assert.equal(response.status, 400);
    assert.equal(DB.calls.length, 0);
  }
});

test("event endpoint remains backward compatible without a range", async () => {
  const DB = databaseSpy();
  const request = await authorizedRequest("https://example.test/api/events");
  const response = await getEvents({ request, env: { DB, SESSION_SECRET } });

  assert.equal(response.status, 200);
  assert.equal(DB.calls.length, 1);
  assert.deepEqual(DB.calls[0].bindings, []);
  assert.doesNotMatch(DB.calls[0].sql, /BETWEEN/);
});

test("event endpoint rejects missing authentication before querying D1", async () => {
  const DB = databaseSpy();
  const request = new Request("https://example.test/api/events");
  const response = await getEvents({ request, env: { DB, SESSION_SECRET } });

  assert.equal(response.status, 401);
  assert.equal(DB.calls.length, 0);
});
