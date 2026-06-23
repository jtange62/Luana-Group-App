// Shared helpers used by all API routes.

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Very small signed-token scheme: we don't need user accounts, just proof that
// the visitor knew the staff password. Token = base64(expiry).HMAC(expiry).
export async function makeToken(env) {
  const expiry = Date.now() + 1000 * 60 * 60 * 24 * 30; // 30 days
  const payload = String(expiry);
  const sig = await hmac(env.SESSION_SECRET, payload);
  return btoa(payload) + "." + sig;
}

export async function verifyToken(env, token) {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  let payload;
  try { payload = atob(parts[0]); } catch { return false; }
  const expiry = Number(payload);
  if (!expiry || Date.now() > expiry) return false;
  const expected = await hmac(env.SESSION_SECRET, payload);
  return timingSafeEqual(expected, parts[1]);
}

export function bearer(request) {
  const h = request.headers.get("Authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret || "fallback-secret-change-me"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

// Basic input cleanup. We store plain text and escape on render (frontend),
// so just trim and cap length here.
export function clean(s, max = 4000) {
  return String(s == null ? "" : s).trim().slice(0, max);
}
