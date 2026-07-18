import test from "node:test";
import assert from "node:assert/strict";

const values = new Map([["luana_token", "test-token"], ["luana_name", "Tester"]]);
globalThis.window = globalThis;
globalThis.localStorage = {
  getItem(key) { return values.has(key) ? values.get(key) : null; },
  setItem(key, value) { values.set(key, value); },
  removeItem(key) { values.delete(key); },
};
globalThis.location = { href: "/tools/ideas/" };

await import("../public/shared-auth.js");

test("shared API returns parsed JSON for successful responses", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: true }), { status: 200 });
  assert.deepEqual(await LuanaAuth.api("test"), { ok: true });
});

test("shared API rejects non-success responses with the server message", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ error: "specific failure" }), { status: 409 });
  await assert.rejects(
    () => LuanaAuth.api("test"),
    (error) => error.message === "specific failure" && error.status === 409
  );
});

test("shared API rejects malformed successful responses", async () => {
  globalThis.fetch = async () => new Response("not json", { status: 200 });
  await assert.rejects(() => LuanaAuth.api("test"), /invalid response/);
});

test("shared API signs out and redirects after an unauthorized response", async () => {
  values.set("luana_token", "expired-token");
  location.href = "/tools/ideas/";
  globalThis.fetch = async () => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });

  await assert.rejects(() => LuanaAuth.api("test"), /unauthorized/);
  assert.equal(values.has("luana_token"), false);
  assert.equal(location.href, "/");
});
