import { json, makeToken, clean, safeEqual } from "./_helpers.js";

// Brute-force guard: after this many wrong passwords from one IP inside the
// window, further tries get a 429 until the failures age out.
const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILURES = 5;

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const cutoff = Date.now() - WINDOW_MS;
  const recent = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ? AND created_at > ?"
  ).bind(ip, cutoff).first();
  if ((recent && recent.n) >= MAX_FAILURES) {
    return json({ error: "Too many attempts — wait a few minutes and try again." }, 429);
  }

  const pw = clean(body.password, 200);
  if (!pw || !(await safeEqual(pw, env.STAFF_PASSWORD || ""))) {
    // Record the failure; pruning aged-out rows keeps the table tiny.
    await env.DB.batch([
      env.DB.prepare("INSERT INTO login_attempts (ip, created_at) VALUES (?,?)").bind(ip, Date.now()),
      env.DB.prepare("DELETE FROM login_attempts WHERE created_at <= ?").bind(cutoff),
    ]);
    return json({ error: "wrong password" }, 401);
  }

  const token = await makeToken(env);
  return json({ token });
}
