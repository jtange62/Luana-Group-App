// Shared helpers used by all API routes.

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

// Very small signed-token scheme: we don't need user accounts, just proof that
// the visitor knew the staff password. Token = base64(expiry).HMAC(expiry).
export async function makeToken(env, user) {
  const expiry = Date.now() + 1000 * 60 * 60 * 24 * 30; // 30 days
  const payload = user ? JSON.stringify({exp:Date.now()+1000*60*60*12,sub:user.id,v:user.version}) : String(expiry);
  const sig = await hmac(env.SESSION_SECRET, payload);
  return btoa(payload) + "." + sig;
}

export async function verifyToken(env, token) {
  return !!(await sessionUser(env,token));
}

export async function sessionUser(env, token) {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  let payload;
  try { payload = atob(parts[0]); } catch { return false; }
  const expected = await hmac(env.SESSION_SECRET, payload);
  if(!timingSafeEqual(expected,parts[1]))return false;
  if(payload.startsWith('{')){
    let claim;try{claim=JSON.parse(payload);}catch{return false;}
    if(!Number.isFinite(claim.exp)||Date.now()>claim.exp||typeof claim.sub!=='string'||!Number.isInteger(claim.v))return false;
    const user=await env.DB.prepare('SELECT id,username,name,role,active,version,must_change FROM staff_accounts WHERE id=?').bind(claim.sub).first();
    return user && user.active===1 && user.version===claim.v ? user : false;
  }
  if(env.AUTH_MODE==='accounts')return false;
  const expiry=Number(payload);
  return expiry && Date.now()<=expiry ? {id:null,role:'legacy'} : false;
}

export function bearer(request) {
  const h = request.headers.get("Authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}

// ---------- Authorization ----------
//
// `_middleware.js` is the enforcement point: it rejects unauthenticated calls,
// applies the admin-only policy, and hands routes the signed-in user on
// `context.data.user`. The per-route `requireAuth` below is deliberate
// defence-in-depth — one shared implementation instead of the copy of this
// check that each route used to carry — so a route stays closed even if it is
// ever reached without the middleware.

// Returns a 401 Response when the caller is not signed in, otherwise null.
export async function requireAuth(env, request) {
  return (await verifyToken(env, bearer(request)))
    ? null
    : json({ error: "unauthorized" }, 401);
}

// Resource-level ownership. Admins may act on any row; everyone else only on
// rows they authored. Legacy shared-password deployments have no accounts to
// compare against, so `user` is absent there and the check stays permissive —
// exactly the behaviour those routes had before.
//
//   const denied = await requireOwner(context, { table: "submissions", id });
//   if (denied) return denied;
export async function requireOwner({ env, data }, { table, id, column = "author" }) {
  const row = await env.DB.prepare(`SELECT ${column} AS owner FROM ${table} WHERE id = ?`).bind(id).first();
  if (!row) return json({ error: "not found" }, 404);
  const user = data && data.user;
  if (!user || user.role === "admin") return null;
  return row.owner === user.name ? null : json({ error: "forbidden" }, 403);
}

async function hmac(secret, message) {
  if (!secret) throw new Error("SESSION_SECRET is not configured");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Constant-time string comparison for secrets (e.g. the staff password).
// Both sides are hashed first so neither length nor prefix timing leaks.
export async function safeEqual(a, b) {
  const [ha, hb] = await Promise.all([sha256hex(a), sha256hex(b)]);
  return timingSafeEqual(ha, hb);
}

async function sha256hex(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(s)));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
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
