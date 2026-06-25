import { json, verifyToken, bearer, clean } from "./_helpers.js";

const PROGRAMS = ["Preschool", "Kinder", "After School", "Summer School"];

function cleanDays(raw) {
  if (raw == null) return null;
  const set = String(raw).split(",")
    .map((d) => parseInt(d, 10))
    .filter((d) => d >= 0 && d <= 6);
  const uniq = [...new Set(set)].sort((a, b) => a - b);
  return uniq.length ? uniq.join(",") : null;
}

export async function onRequestGet({ request, env }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);
  const res = await env.DB.prepare(
    `SELECT id, name, program, days, birthday, allergies,
            emergency_contact, emergency_phone, notes
     FROM students WHERE active = 1 ORDER BY program, name COLLATE NOCASE`
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
    `INSERT INTO students (id, name, program, days, birthday, allergies,
      emergency_contact, emergency_phone, notes, active, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,1,?)`
  ).bind(
    id, name, program, cleanDays(body.days),
    body.birthday || null, clean(body.allergies, 500) || null,
    clean(body.emergency_contact, 200) || null, clean(body.emergency_phone, 50) || null,
    clean(body.notes, 2000) || null, Date.now()
  ).run();
  return json({ ok: true, id });
}

export async function onRequestPatch({ request, env }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);
  let body; try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }
  if (!body.id) return json({ error: "missing id" }, 400);

  const updates = [], params = [];
  if (body.name !== undefined) {
    const n = clean(body.name, 80); if (!n) return json({ error: "name required" }, 400);
    updates.push("name = ?"); params.push(n);
  }
  if (body.program !== undefined) {
    const p = PROGRAMS.includes(clean(body.program, 40)) ? clean(body.program, 40) : null;
    if (!p) return json({ error: "valid class required" }, 400);
    updates.push("program = ?"); params.push(p);
  }
  if (body.days !== undefined) { updates.push("days = ?"); params.push(cleanDays(body.days)); }
  if (body.birthday !== undefined) { updates.push("birthday = ?"); params.push(body.birthday || null); }
  if (body.allergies !== undefined) { updates.push("allergies = ?"); params.push(clean(body.allergies, 500) || null); }
  if (body.emergency_contact !== undefined) { updates.push("emergency_contact = ?"); params.push(clean(body.emergency_contact, 200) || null); }
  if (body.emergency_phone !== undefined) { updates.push("emergency_phone = ?"); params.push(clean(body.emergency_phone, 50) || null); }
  if (body.notes !== undefined) { updates.push("notes = ?"); params.push(clean(body.notes, 2000) || null); }

  if (!updates.length) return json({ error: "nothing to update" }, 400);
  params.push(body.id);
  await env.DB.prepare("UPDATE students SET " + updates.join(", ") + " WHERE id = ?").bind(...params).run();
  return json({ ok: true });
}

export async function onRequestDelete({ request, env }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);
  let body; try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }
  if (!body.id) return json({ error: "missing id" }, 400);
  await env.DB.prepare("UPDATE students SET active = 0 WHERE id = ?").bind(body.id).run();
  return json({ ok: true });
}
