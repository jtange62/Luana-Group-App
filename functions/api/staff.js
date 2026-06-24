import { json, verifyToken, bearer, clean } from "./_helpers.js";

// GET /api/staff           -> list active staff
// POST /api/staff {name}   -> add
// DELETE /api/staff {id}    -> remove (soft delete)
export async function onRequestGet({ request, env }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);
  const res = await env.DB.prepare(
    "SELECT id, name FROM staff WHERE active = 1 ORDER BY name COLLATE NOCASE"
  ).all();
  return json({ staff: res.results || [] });
}

export async function onRequestPost({ request, env }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);
  let body; try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }
  const name = clean(body.name, 80);
  if (!name) return json({ error: "name required" }, 400);
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO staff (id, name, active, created_at) VALUES (?,?,1,?)"
  ).bind(id, name, Date.now()).run();
  return json({ ok: true, id, name });
}

export async function onRequestDelete({ request, env }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);
  let body; try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }
  if (!body.id) return json({ error: "missing id" }, 400);
  await env.DB.prepare("UPDATE staff SET active = 0 WHERE id = ?").bind(body.id).run();
  return json({ ok: true });
}
