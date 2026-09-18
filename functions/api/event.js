import { json, verifyToken, bearer, clean } from "./_helpers.js";

import {validDate} from './visits.js';

const PROGRAMS = ["Preschool", "Kinder", "After School", "Summer School", "General"];
const RECUR = ["none", "daily", "weekly", "monthly"];
const CALENDARS = ["general", "students", "staff"];

function cleanProgram(raw) {
  const v = clean(raw, 40);
  return PROGRAMS.includes(v) ? v : "General";
}
function cleanCalendar(raw) {
  const v = clean(raw, 20);
  return CALENDARS.includes(v) ? v : "general";
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
  const event_type=body.event_type==='closure'?'closure':'event';
  const end_date=cleanDate(body.end_date)||startDate;
  if(!validDate(startDate)||!validDate(end_date)||end_date<startDate)return {error:'Choose a valid start and end date.'};
  if(event_type==='closure' && cleanRecur(body.recur)!=='none')return {error:'School closures use a date range, not a repeating rule.'};
  return {
    event_type, end_date,
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
    `INSERT INTO events (id, title, author, calendar, program, staff_name, lesson_id, start_date, start_time, end_time, notes, recur, recur_until, created_at, event_type, end_date)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    id, f.title, author, f.calendar, f.program, f.staff_name, f.lesson_id,
    f.start_date, f.start_time, f.end_time, f.notes, f.recur, f.recur_until, Date.now(), f.event_type, f.end_date
  ).run();

  return json({ ok: true, id });
}

export async function onRequestPatch({ request, env }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }
  if (!body.id) return json({ error: "missing id" }, 400);

  // Any signed-in teacher may edit any event; the author byline is preserved.
  const existing = await env.DB.prepare("SELECT author FROM events WHERE id = ?").bind(body.id).first();
  if (!existing) return json({ error: "not found" }, 404);

  const f = fields(body);
  if (f.error) return json({ error: f.error }, 400);

  await env.DB.prepare(
    `UPDATE events SET title=?, calendar=?, program=?, staff_name=?, lesson_id=?, start_date=?, start_time=?, end_time=?, notes=?, recur=?, recur_until=?, event_type=?, end_date=? WHERE id=?`
  ).bind(
    f.title, f.calendar, f.program, f.staff_name, f.lesson_id,
    f.start_date, f.start_time, f.end_time, f.notes, f.recur, f.recur_until, f.event_type, f.end_date, body.id
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
  // The shared staff calendar allows signed-in staff to manage any event,
  // matching the edit permission above.

  await env.DB.prepare("DELETE FROM events WHERE id = ?").bind(body.id).run();
  return json({ ok: true });
}
