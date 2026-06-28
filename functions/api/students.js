import { json, verifyToken, bearer, clean } from "./_helpers.js";

const PROGRAMS = ["Preschool", "Kinder", "After School", "Summer School"];

// Profile fields beyond the core name/program/days. All optional text.
const PROFILE_FIELDS = ["birthday", "guardian", "phone", "email", "allergies", "emergency", "notes", "enrolled_at", "ss_weeks", "ss_type"];

// Normalize a weekday list like "3,5" -> sorted unique ints 0-6, or null.
// A non-numeric value (e.g. "x" for one-off trials) collapses to null.
function cleanDays(raw) {
  if (raw == null) return null;
  const set = String(raw).split(",")
    .map((d) => parseInt(d, 10))
    .filter((d) => d >= 0 && d <= 6);
  const uniq = [...new Set(set)].sort((a, b) => a - b);
  return uniq.length ? uniq.join(",") : null;
}

// GET  /api/students            -> list all active students with full profiles
// POST /api/students {name,program,...profile}   -> add
// PATCH /api/students {id,...any fields}  -> update only the fields provided
// DELETE /api/students {id}      -> soft delete (keeps attendance history)
export async function onRequestGet({ request, env }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);
  const res = await env.DB.prepare(
    "SELECT id, name, program, days, birthday, guardian, phone, email, allergies, emergency, notes, enrolled_at, photo_ok, ss_weeks, ss_type " +
    "FROM students WHERE active = 1 ORDER BY program, name COLLATE NOCASE"
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

  const cols = ["id", "name", "program", "days", "active", "created_at"];
  const vals = [crypto.randomUUID(), name, program, cleanDays(body.days), 1, Date.now()];
  PROFILE_FIELDS.forEach((f) => {
    if (body[f] != null) { cols.push(f); vals.push(clean(body[f], 1000)); }
  });
  if (body.photo_ok != null) { cols.push("photo_ok"); vals.push(body.photo_ok ? 1 : 0); }
  const placeholders = cols.map(() => "?").join(",");
  await env.DB.prepare(`INSERT INTO students (${cols.join(",")}) VALUES (${placeholders})`)
    .bind(...vals).run();
  return json({ ok: true, id: vals[0] });
}

export async function onRequestPatch({ request, env }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);
  let body; try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }
  if (!body.id) return json({ error: "missing id" }, 400);

  // Build the SET clause from only the fields actually present, so a partial
  // update (e.g. the calendar saving just days) never wipes profile data.
  const sets = [], vals = [];
  if (body.name != null) {
    const name = clean(body.name, 80);
    if (!name) return json({ error: "name cannot be empty" }, 400);
    sets.push("name = ?"); vals.push(name);
  }
  if (body.program != null) {
    const program = PROGRAMS.includes(clean(body.program, 40)) ? clean(body.program, 40) : null;
    if (!program) return json({ error: "valid class required" }, 400);
    sets.push("program = ?"); vals.push(program);
  }
  if (body.days != null) { sets.push("days = ?"); vals.push(cleanDays(body.days)); }
  PROFILE_FIELDS.forEach((f) => {
    if (body[f] != null) { sets.push(`${f} = ?`); vals.push(clean(body[f], 1000)); }
  });
  if (body.photo_ok != null) { sets.push("photo_ok = ?"); vals.push(body.photo_ok ? 1 : 0); }
  if (!sets.length) return json({ error: "nothing to update" }, 400);

  vals.push(body.id);
  await env.DB.prepare(`UPDATE students SET ${sets.join(", ")} WHERE id = ?`).bind(...vals).run();
  return json({ ok: true });
}

export async function onRequestDelete({ request, env }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);
  let body; try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }
  if (!body.id) return json({ error: "missing id" }, 400);
  await env.DB.prepare("UPDATE students SET active = 0 WHERE id = ?").bind(body.id).run();
  return json({ ok: true });
}
