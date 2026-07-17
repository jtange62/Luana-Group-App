import { json, verifyToken, bearer, clean } from "./_helpers.js";

const PROGRAMS = ["Preschool", "Kinder", "After School", "Summer School"];
// What a block auto-fills with in the Day view. Stored NULL for "none".
const SOURCES = [
  "week_focus", "week_activities", "week_phonics", "week_questions",
  "month_theme", "month_song", "month_vocab", "month_activities", "month_phonics",
  "day_subtheme", "day_vocab", "day_activities", // Summer School daily themes
];

function cleanProgram(raw) {
  const v = clean(raw, 40);
  return PROGRAMS.includes(v) ? v : null;
}
function cleanTime(raw) {
  const v = clean(raw, 5);
  return /^\d{2}:\d{2}$/.test(v) ? v : null;
}
function cleanSource(raw) {
  const v = clean(raw, 40);
  return SOURCES.includes(v) ? v : null;
}

// Add a time block to a program's daily rhythm.
export async function onRequestPost({ request, env }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }

  const program = cleanProgram(body.program);
  if (!program) return json({ error: "valid program required" }, 400);
  const startTime = cleanTime(body.start_time);
  if (!startTime) return json({ error: "valid start time required" }, 400);
  const label = clean(body.label, 200);
  if (!label) return json({ error: "label required" }, 400);

  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO schedule_blocks (id, program, start_time, end_time, label, source, author, created_at) VALUES (?,?,?,?,?,?,?,?)"
  ).bind(
    id, program, startTime,
    cleanTime(body.end_time),
    label,
    cleanSource(body.source),
    clean(body.author, 60) || "anonymous",
    Date.now()
  ).run();

  return json({ ok: true, id });
}

// Edit a block. Any signed-in teacher may edit the shared template.
export async function onRequestPatch({ request, env }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }

  const id = clean(body.id, 60);
  if (!id) return json({ error: "missing id" }, 400);

  const existing = await env.DB.prepare("SELECT id FROM schedule_blocks WHERE id = ?").bind(id).first();
  if (!existing) return json({ error: "not found" }, 404);

  // start_time and label are NOT NULL — reject updates that blank them.
  if ("start_time" in body && !cleanTime(body.start_time)) return json({ error: "valid start time required" }, 400);
  if ("label" in body && !clean(body.label, 200)) return json({ error: "label required" }, 400);

  // Only touch the fields the caller sent.
  const sets = [];
  const vals = [];
  const maybe = (key, col, val) => { if (key in body) { sets.push(col + " = ?"); vals.push(val); } };
  maybe("start_time", "start_time", cleanTime(body.start_time));
  maybe("end_time", "end_time", cleanTime(body.end_time));
  maybe("label", "label", clean(body.label, 200));
  maybe("source", "source", cleanSource(body.source));
  if (!sets.length) return json({ ok: true });

  vals.push(id);
  await env.DB.prepare("UPDATE schedule_blocks SET " + sets.join(", ") + " WHERE id = ?").bind(...vals).run();
  return json({ ok: true });
}

// Delete a block and any day notes pinned to it.
export async function onRequestDelete({ request, env }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }

  const id = clean(body.id, 60);
  if (!id) return json({ error: "missing id" }, 400);

  await env.DB.batch([
    env.DB.prepare("DELETE FROM day_block_notes WHERE block_id = ?").bind(id),
    env.DB.prepare("DELETE FROM schedule_blocks WHERE id = ?").bind(id),
  ]);
  return json({ ok: true });
}
