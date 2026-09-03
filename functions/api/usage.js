import { json, verifyToken, bearer, clean } from "./_helpers.js";

// Counts tool opens, nothing else. There was previously no way to answer "is
// anyone using this?" without Cloudflare dashboard access, which made every
// decision about what to build next a guess.
//
// POST /api/usage {tool}       -> increment today's counter (fire and forget)
// GET  /api/usage?days=14      -> [{ day, tool, hits }] newest first

const TOOLS = ["board", "today", "tools", "calendar", "curriculum", "students", "website"];

export async function onRequestPost({ request, env }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);
  let body; try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }

  const tool = clean(body.tool, 20);
  if (!TOOLS.includes(tool)) return json({ error: "unknown tool" }, 400);

  const day = new Date().toISOString().slice(0, 10);
  await env.DB.prepare(
    "INSERT INTO usage_daily (day, tool, hits) VALUES (?,?,1) " +
    "ON CONFLICT(day, tool) DO UPDATE SET hits = hits + 1"
  ).bind(day, tool).run();

  return json({ ok: true });
}

export async function onRequestGet({ request, env }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);

  const requested = Number(new URL(request.url).searchParams.get("days") || 14);
  const days = Number.isInteger(requested) ? Math.max(1, Math.min(requested, 90)) : 14;
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

  const res = await env.DB.prepare(
    "SELECT day, tool, hits FROM usage_daily WHERE day >= ? ORDER BY day DESC, hits DESC"
  ).bind(since).all();

  return json({ days, usage: res.results || [] });
}
