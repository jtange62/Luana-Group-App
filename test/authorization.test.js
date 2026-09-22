// Covers the account and authorization surface: sign-in, the admin-only policy
// in the middleware, and the shared ownership check the delete routes use.
// These modules carried the newest and most security-relevant logic in the app
// and had no unit tests.
import test from "node:test";
import assert from "node:assert/strict";

import { makeToken, requireOwner } from "../functions/api/_helpers.js";
import { passwordHash } from "../functions/api/_passwords.js";
import { onRequest as middleware } from "../functions/api/_middleware.js";
import { onRequestGet as loginMode, onRequestPost as login } from "../functions/api/login.js";
import { onRequestPost as accountSetup } from "../functions/api/account-setup.js";

const SESSION_SECRET = "test-authorization-secret-that-is-long-enough";

// Minimal D1 stand-in: `rows` answers first(), and every statement is recorded
// so a test can assert on what the route asked the database to do.
function db(handlers = {}) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      const call = { sql, bindings: [] };
      calls.push(call);
      return {
        bind(...bindings) { call.bindings = bindings; return this; },
        async first() {
          for (const [pattern, value] of Object.entries(handlers)) {
            if (sql.includes(pattern)) return typeof value === "function" ? value(call.bindings) : value;
          }
          return null;
        },
        async all() { return { results: [] }; },
        async run() { return { meta: { changes: 1 } }; },
      };
    },
    async batch(statements) { return statements.map(() => ({ results: [] })); },
  };
}

const staffUser = { id: "staff-1", username: "mia", name: "Mia", role: "staff", active: 1, version: 1, must_change: 0 };
const adminUser = { id: "admin-1", username: "jtange", name: "Justin", role: "admin", active: 1, version: 1, must_change: 0 };

function envFor(user) {
  return {
    AUTH_MODE: "accounts",
    SESSION_SECRET,
    DB: db({ "FROM staff_accounts WHERE id": { ...user } }),
  };
}

async function callAs(user, path, method = "GET", { next = async () => new Response("ok"), body } = {}) {
  const env = envFor(user);
  const headers = { Authorization: `Bearer ${await makeToken(env, user)}` };
  const init = { method, headers };
  if (body && !["GET", "HEAD"].includes(method)) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  return middleware({ env, data: {}, request: new Request("https://example.test" + path, init), next });
}

// ---------- Sign-in ----------

test("login advertises the configured mode", async () => {
  assert.deepEqual(await (await loginMode({ env: { AUTH_MODE: "accounts" } })).json(), { mode: "accounts" });
  assert.deepEqual(await (await loginMode({ env: {} })).json(), { mode: "shared" });
});

test("sign-in rejects a wrong password and records the attempt", async () => {
  const DB = db({
    "COUNT(*) AS n": { n: 0 },
    "FROM staff_accounts WHERE username": {
      ...staffUser, password_hash: await passwordHash("the real passphrase", SESSION_SECRET),
    },
  });
  const env = { AUTH_MODE: "accounts", SESSION_SECRET, DB };
  const response = await login({
    env,
    request: new Request("https://example.test/api/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "mia", password: "not the passphrase" }),
    }),
  });
  assert.equal(response.status, 401);
  assert.match((await response.json()).error, /Incorrect username or password/);
  assert.ok(DB.calls.some((c) => c.sql.includes("INSERT INTO login_attempts")), "failure should be recorded");
});

test("sign-in stops after too many failures from one address", async () => {
  const env = { AUTH_MODE: "accounts", SESSION_SECRET, DB: db({ "COUNT(*) AS n": { n: 5 } }) };
  const response = await login({
    env,
    request: new Request("https://example.test/api/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "mia", password: "anything" }),
    }),
  });
  assert.equal(response.status, 429);
});

test("sign-in succeeds with the right password and returns a usable session", async () => {
  const password = "a long enough staff passphrase";
  const DB = db({
    "COUNT(*) AS n": { n: 0 },
    "FROM staff_accounts WHERE username": { ...staffUser, password_hash: await passwordHash(password, SESSION_SECRET) },
  });
  const response = await login({
    env: { AUTH_MODE: "accounts", SESSION_SECRET, DB },
    request: new Request("https://example.test/api/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "mia", password }),
    }),
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.ok(payload.token);
  assert.equal(payload.user.role, "staff");
  assert.equal(payload.user.password_hash, undefined, "the hash must never leave the server");
});

test("a disabled account cannot sign in even with the right password", async () => {
  const password = "a long enough staff passphrase";
  const DB = db({
    "COUNT(*) AS n": { n: 0 },
    "FROM staff_accounts WHERE username": {
      ...staffUser, active: 0, password_hash: await passwordHash(password, SESSION_SECRET),
    },
  });
  const response = await login({
    env: { AUTH_MODE: "accounts", SESSION_SECRET, DB },
    request: new Request("https://example.test/api/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "mia", password }),
    }),
  });
  assert.equal(response.status, 401);
});

// ---------- Bootstrap ----------

test("administrator setup is invisible without the setup token", async () => {
  const response = await accountSetup({
    env: { SESSION_SECRET, DB: db() },
    request: new Request("https://example.test/api/account-setup", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "jtange", password: "a long enough passphrase", setup_token: "guess" }),
    }),
  });
  assert.equal(response.status, 404, "a wrong token should not reveal that the route exists");
});

test("administrator setup requires a long password", async () => {
  const response = await accountSetup({
    env: { SESSION_SECRET, STAFF_SETUP_TOKEN: "correct-token", DB: db() },
    request: new Request("https://example.test/api/account-setup", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "jtange", password: "short", setup_token: "correct-token" }),
    }),
  });
  assert.equal(response.status, 400);
});

// ---------- Role policy ----------

test("the middleware keeps structural changes with an administrator", async () => {
  for (const [path, method] of [
    ["/api/students", "DELETE"],
    ["/api/school-years", "POST"],
    ["/api/summer-weeks", "POST"],
    ["/api/staff", "GET"],
  ]) {
    const denied = await callAs(staffUser, path, method, { body: { id: "x" } });
    assert.equal(denied.status, 403, `${method} ${path} should be refused for staff`);
    assert.match((await denied.json()).error, /Administrator/);

    const allowed = await callAs(adminUser, path, method, { body: { id: "x" } });
    assert.equal(allowed.status, 200, `${method} ${path} should be allowed for an admin`);
  }
});

test("everyday work is not gated behind an administrator", async () => {
  for (const [path, method] of [
    ["/api/students", "POST"],
    ["/api/event", "DELETE"],
    ["/api/attendance", "POST"],
    ["/api/post", "POST"],
  ]) {
    const response = await callAs(staffUser, path, method, { body: { id: "x" } });
    assert.equal(response.status, 200, `${method} ${path} should stay open to staff`);
  }
});

test("an unauthenticated call never reaches the route, in either auth mode", async () => {
  for (const AUTH_MODE of ["accounts", "shared"]) {
    let reached = false;
    const response = await middleware({
      env: { AUTH_MODE, SESSION_SECRET, DB: db() }, data: {},
      request: new Request("https://example.test/api/students"),
      next: async () => { reached = true; return new Response("ok"); },
    });
    assert.equal(response.status, 401, `${AUTH_MODE} mode should reject an anonymous call`);
    assert.equal(reached, false, `${AUTH_MODE} mode should not run the route`);
  }
});

test("the signed-in user is handed to routes and the byline cannot be spoofed", async () => {
  let seen = null;
  const env = envFor(staffUser);
  const data = {};
  await middleware({
    env, data,
    request: new Request("https://example.test/api/post", {
      method: "POST", headers: { Authorization: `Bearer ${await makeToken(env, staffUser)}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text: "hello", author: "Somebody Else" }),
    }),
    next: async (request) => { seen = await request.json(); return new Response("ok"); },
  });
  assert.equal(seen.author, "Mia");
  assert.equal(data.user.id, "staff-1");
});

// ---------- Ownership ----------

test("ownership lets people manage their own rows, and admins anything", async () => {
  const context = (user, owner) => ({
    env: { DB: db({ "AS owner FROM": owner === null ? null : { owner } }) },
    data: user ? { user } : {},
  });

  assert.equal(await requireOwner(context(staffUser, "Mia"), { table: "submissions", id: "1" }), null);
  assert.equal((await requireOwner(context(staffUser, "Justin"), { table: "submissions", id: "1" })).status, 403);
  assert.equal(await requireOwner(context(adminUser, "Mia"), { table: "submissions", id: "1" }), null);
  assert.equal((await requireOwner(context(staffUser, null), { table: "submissions", id: "1" })).status, 404);
  // Legacy shared-password deployments have no accounts to compare against.
  assert.equal(await requireOwner(context(null, "Justin"), { table: "submissions", id: "1" }), null);
});
