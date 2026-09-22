import { json, makeToken, clean, safeEqual } from "./_helpers.js";
import {passwordMatches,passwordHash} from './_passwords.js';

export function onRequestGet({env}){return json({mode:env.AUTH_MODE==='accounts'?'accounts':'shared'});}

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

  const pw = typeof body.password==='string' && body.password.length<=200 ? body.password : '';
  let user=null,accepted=false;
  if(env.AUTH_MODE==='accounts'){
    user=await env.DB.prepare('SELECT * FROM staff_accounts WHERE username=? COLLATE NOCASE').bind(clean(body.username,60).toLowerCase()).first();
    if(user){accepted=await passwordMatches(pw,user.password_hash,env.SESSION_SECRET);accepted=accepted&&user.active===1;}
    else{await passwordHash(pw,env.SESSION_SECRET,'unknown-account-timing');}
  }else accepted=!!pw && await safeEqual(pw.trim(),env.STAFF_PASSWORD||'');
  if (!pw || !accepted) {
    // Record the failure; pruning aged-out rows keeps the table tiny.
    await env.DB.batch([
      env.DB.prepare("INSERT INTO login_attempts (ip, created_at) VALUES (?,?)").bind(ip, Date.now()),
      env.DB.prepare("DELETE FROM login_attempts WHERE created_at <= ?").bind(cutoff),
    ]);
    return json({ error: env.AUTH_MODE==='accounts'?"Incorrect username or password.":"wrong password" }, 401);
  }

  const token = await makeToken(env,user);
  return json({ token, ...(user?{user:{id:user.id,name:user.name,username:user.username,role:user.role,must_change:user.must_change}}:{}) });
}
