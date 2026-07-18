import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { json, makeToken, verifyToken } from "../functions/api/_helpers.js";
import { onRequestGet as getEvents } from "../functions/api/events.js";
import { onRequestGet as getPosts } from "../functions/api/posts.js";
import { onRequestGet as getSubmissions } from "../functions/api/submissions.js";
import { onRequestGet as getLessons } from "../functions/api/lessons.js";

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

function batchedDatabase(resultSets) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      const call = { sql, bindings: [] };
      calls.push(call);
      return { bind(...bindings) { call.bindings = bindings; return this; } };
    },
    async batch() {
      return resultSets.map((results) => ({ results }));
    },
  };
}

test("posts endpoint returns stable cursor pagination with one lookahead row", async () => {
  const rows = [
    { id: "c", created_at: 30 },
    { id: "b", created_at: 20 },
    { id: "a", created_at: 10 },
  ];
  const DB = batchedDatabase([rows, [], []]);
  const request = await authorizedRequest("https://example.test/api/posts?limit=2");
  const response = await getPosts({ request, env: { DB, SESSION_SECRET } });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.posts.map((post) => post.id), ["c", "b"]);
  assert.equal(body.has_more, true);
  assert.equal(body.next_cursor, "20|b");
  assert.deepEqual(DB.calls.map((call) => call.bindings), [[3], [3], [3]]);
});

test("posts cursor binds timestamp and id consistently across the D1 batch", async () => {
  const DB = batchedDatabase([[], [], []]);
  const request = await authorizedRequest("https://example.test/api/posts?limit=30&before=20%7Cb");
  const response = await getPosts({ request, env: { DB, SESSION_SECRET } });

  assert.equal(response.status, 200);
  assert.deepEqual(DB.calls.map((call) => call.bindings), [
    [20, 20, "b", 31], [20, 20, "b", 31], [20, 20, "b", 31],
  ]);
  assert.ok(DB.calls.every((call) => /id < \?/.test(call.sql)));
});

test("posts endpoint rejects malformed cursors before querying D1", async () => {
  const DB = batchedDatabase([]);
  const request = await authorizedRequest("https://example.test/api/posts?before=broken");
  const response = await getPosts({ request, env: { DB, SESSION_SECRET } });
  assert.equal(response.status, 400);
  assert.equal(DB.calls.length, 0);
});

test("submissions paginate within the selected status and return global counts", async () => {
  const rows = [
    { id: "c", status: "new", created_at: 30 },
    { id: "b", status: "new", created_at: 20 },
    { id: "a", status: "new", created_at: 10 },
  ];
  const DB = batchedDatabase([rows, [], [{ status: "new", n: 7 }, { status: "done", n: 4 }]]);
  const request = await authorizedRequest("https://example.test/api/submissions?status=new&limit=2");
  const response = await getSubmissions({ request, env: { DB, SESSION_SECRET } });
  const body = await response.json();

  assert.deepEqual(body.submissions.map((submission) => submission.id), ["c", "b"]);
  assert.deepEqual(body.counts, { new: 7, done: 4, all: 11 });
  assert.equal(body.has_more, true);
  assert.equal(body.next_cursor, "20|b");
  assert.deepEqual(DB.calls[0].bindings, ["new", 3]);
  assert.deepEqual(DB.calls[1].bindings, ["new", 3]);
});

test("submissions reject unsupported status filters", async () => {
  const DB = batchedDatabase([]);
  const request = await authorizedRequest("https://example.test/api/submissions?status=deleted");
  const response = await getSubmissions({ request, env: { DB, SESSION_SECRET } });
  assert.equal(response.status, 400);
  assert.equal(DB.calls.length, 0);
});

test("lessons apply server-side filters, escaped search, and cursor pagination", async () => {
  const rows = [
    { id: "b", program: "Kinder", month: 7, created_at: 20 },
    { id: "a", program: "Kinder", month: 7, created_at: 10 },
  ];
  const DB = batchedDatabase([rows, []]);
  const request = await authorizedRequest("https://example.test/api/lessons?limit=1&program=Kinder&month=7&q=100%25&before=30%7Cc");
  const response = await getLessons({ request, env: { DB, SESSION_SECRET } });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.lessons.map((lesson) => lesson.id), ["b"]);
  assert.equal(body.has_more, true);
  assert.equal(body.next_cursor, "20|b");
  assert.deepEqual(DB.calls[0].bindings, [
    "Kinder", "7", "%100\\%%", "%100\\%%", "%100\\%%", "%100\\%%", 30, 30, "c", 2,
  ]);
  assert.match(DB.calls[0].sql, /EXISTS \(SELECT 1 FROM lesson_files/);
});

test("lessons can fetch a directly linked lesson without pagination", async () => {
  const DB = batchedDatabase([[{ id: "target", created_at: 1 }], []]);
  const request = await authorizedRequest("https://example.test/api/lessons?id=target&limit=30");
  const response = await getLessons({ request, env: { DB, SESSION_SECRET } });
  const body = await response.json();
  assert.equal(body.lessons[0].id, "target");
  assert.equal(body.has_more, false);
  assert.deepEqual(DB.calls[0].bindings, ["target", 1]);
});

test("canonical schema includes composite indexes for every cursor endpoint", async () => {
  const schema = await readFile(new URL("../schema.sql", import.meta.url), "utf8");
  assert.match(schema, /idx_posts_cursor ON posts \(created_at DESC, id DESC\)/);
  assert.match(schema, /idx_lessons_cursor ON lessons \(created_at DESC, id DESC\)/);
  assert.match(schema, /idx_lessons_filter ON lessons \(program, month, created_at DESC, id DESC\)/);
  assert.match(schema, /idx_submissions_cursor ON submissions \(created_at DESC, id DESC\)/);
  assert.match(schema, /idx_submissions_status_cursor ON submissions \(status, created_at DESC, id DESC\)/);
});
