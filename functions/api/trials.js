import { json, verifyToken, bearer, clean } from "./_helpers.js";

const PROGRAMS = ["Preschool", "Kinder", "After School", "Summer School"];

// GET    /api/trials?date=YYYY-MM-DD           -> list trials for a single date
// GET    /api/trials?from=YYYY-MM-DD&to=...    -> list trials for a date range
// POST   /api/trials {name,program,date}        -> add a trial
// DELETE /api/trials {id}                       -> remove a trial
export async function onRequestGet({ request, env }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);
  const p = new URL(request.url).searchParams;
  const date = p.get("date");
  const from = p.get("from");
  const to   = p.get("to");
  let res;
  if (date) {
    res = await env.DB.prepare(
      "SELECT id, name, program, date FROM trials WHERE date = ? ORDER BY created_at"
    ).bind(date).all();
  } else if (from && to) {
    res = await env.DB.prepare(
      "SELECT id, name, program, date FROM trials WHERE date >= ? AND date <= ? ORDER BY date, created_at"
    ).bind(from, to).all();
  } else {
    return json({ error: "date or from/to required" }, 400);
  }
  return json({ trials: res.results || [] });
}

export async function onRequestPost({ request, env }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);
  let body; try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }
  const name = clean(body.name, 80);
  const program = PROGRAMS.includes(clean(body.program, 40)) ? clean(body.program, 40) : null;
  const date = clean(body.date, 10);
  if (!name) return json({ error: "name required" }, 400);
  if (!program) return json({ error: "valid class required" }, 400);
  if (!date) return json({ error: "date required" }, 400);
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO trials (id, name, program, date, created_at) VALUES (?,?,?,?,?)"
  ).bind(id, name, program, date, Date.now()).run();
  return json({ ok: true, id });
}

export async function onRequestDelete({ request, env }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);
  let body; try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }
  if (!body.id) return json({ error: "missing id" }, 400);
  await env.DB.prepare("DELETE FROM trials WHERE id = ?").bind(body.id).run();
  return json({ ok: true });
}
