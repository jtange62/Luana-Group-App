import { json, verifyToken, bearer, clean } from "./_helpers.js";

const PROGRAMS = ["Preschool", "Kinder", "After School", "Summer School", "General"];
const RECUR = ["none", "daily", "weekly", "monthly"];
const CALENDARS = ["students", "staff"];

function cleanProgram(raw) {
  const v = clean(raw, 40);
  return PROGRAMS.includes(v) ? v : "General";
}
function cleanCalendar(raw) {
  const v = clean(raw, 20);
  return CALENDARS.includes(v) ? v : "students";
}
function cleanDate(raw) {
  const v = clean(raw, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}
function cleanTime(raw) {
  const v = clean(raw, 5);
  return /^\d{2}:\d{2}$/.test(v) ? v : null;
}
function cleanRecur(raw) {
  const v = clean(raw, 10);
  return RECUR.includes(v) ? v : "none";
}

// Pull and validate the shared fields from a parsed body.
function fields(body) {
  const calendar = cleanCalendar(body.calendar);
  const staff_name = clean(body.staff_name, 60) || null;
  // Staff shifts fall back to the person's name as the title.
  const title = clean(body.title, 200) || (calendar === "staff" ? staff_name : "");
  const startDate = cleanDate(body.start_date);
  if (!title) return { error: calendar === "staff" ? "staff name required" : "title required" };
  if (!startDate) return { error: "valid date required" };
  return {
    title,
    calendar,
    program: cleanProgram(body.program),
    staff_name,
    lesson_id: calendar === "students" ? (clean(body.lesson_id, 64) || null) : null,
    start_date: startDate,
    start_time: cleanTime(body.start_time),
    end_time: cleanTime(body.end_time),
    notes: clean(body.notes, 4000) || null,
    recur: cleanRecur(body.recur),
    recur_until: cleanDate(body.recur_until),
  };
}

export async function onRequestPost({ request, env }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }

  const f = fields(body);
  if (f.error) return json({ error: f.error }, 400);

  const author = clean(body.author, 60) || "anonymous";
  const id = crypto.randomUUID();

  await env.DB.prepare(
    `INSERT INTO events (id, title, author, calendar, program, staff_name, lesson_id, start_date, start_time, end_time, notes, recur, recur_until, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    id, f.title, author, f.calendar, f.program, f.staff_name, f.lesson_id,
    f.start_date, f.start_time, f.end_time, f.notes, f.recur, f.recur_until, Date.now()
  ).run();

  return json({ ok: true, id });
}

export async function onRequestPatch({ request, env }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }
  if (!body.id) return json({ error: "missing id" }, 400);

  const existing = await env.DB.prepare("SELECT author FROM events WHERE id = ?").bind(body.id).first();
  if (!existing) return json({ error: "not found" }, 404);
  if (existing.author !== clean(body.author, 60)) return json({ error: "forbidden" }, 403);

  const f = fields(body);
  if (f.error) return json({ error: f.error }, 400);

  await env.DB.prepare(
    `UPDATE events SET title=?, calendar=?, program=?, staff_name=?, lesson_id=?, start_date=?, start_time=?, end_time=?, notes=?, recur=?, recur_until=? WHERE id=?`
  ).bind(
    f.title, f.calendar, f.program, f.staff_name, f.lesson_id,
    f.start_date, f.start_time, f.end_time, f.notes, f.recur, f.recur_until, body.id
  ).run();

  return json({ ok: true });
}

export async function onRequestDelete({ request, env }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }
  if (!body.id) return json({ error: "missing id" }, 400);

  const existing = await env.DB.prepare("SELECT author FROM events WHERE id = ?").bind(body.id).first();
  if (!existing) return json({ error: "not found" }, 404);
  if (existing.author !== clean(body.author, 60)) return json({ error: "forbidden" }, 403);

  await env.DB.prepare("DELETE FROM events WHERE id = ?").bind(body.id).run();
  return json({ ok: true });
}
