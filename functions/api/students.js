import { json, verifyToken, bearer, clean } from "./_helpers.js";

const PROGRAMS = ["Preschool", "Kinder", "After School", "Summer School"];

// GET  /api/students            -> list all active students
// POST /api/students {name,program}   -> add
// PATCH /api/students {id,name,program} -> rename / move class
// DELETE /api/students {id}      -> remove (soft delete keeps attendance history)
export async function onRequestGet({ request, env }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);
  const res = await env.DB.prepare(
    "SELECT id, name, program FROM students WHERE active = 1 ORDER BY program, name COLLATE NOCASE"
  ).all();
  return json({ students: res.results || [] });
}

export async function onRequestPost({ request, env }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);
  let body; try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }
  const name = clean(body.name, 80);
  const program = PROGRAMS.includes(clean(body.program, 40)) ? clean(body.program, 40) : null;
  if (!name) return json({ error: "name required" }, 400);
  if (!program) return json({ error: "valid class required" }, 400);
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO students (id, name, program, active, created_at) VALUES (?,?,?,1,?)"
  ).bind(id, name, program, Date.now()).run();
  return json({ ok: true, id });
}

export async function onRequestPatch({ request, env }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);
  let body; try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }
  if (!body.id) return json({ error: "missing id" }, 400);
  const name = clean(body.name, 80);
  const program = PROGRAMS.includes(clean(body.program, 40)) ? clean(body.program, 40) : null;
  if (!name || !program) return json({ error: "name and class required" }, 400);
  await env.DB.prepare("UPDATE students SET name = ?, program = ? WHERE id = ?").bind(name, program, body.id).run();
  return json({ ok: true });
}

export async function onRequestDelete({ request, env }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);
  let body; try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }
  if (!body.id) return json({ error: "missing id" }, 400);
  await env.DB.prepare("UPDATE students SET active = 0 WHERE id = ?").bind(body.id).run();
  return json({ ok: true });
}
