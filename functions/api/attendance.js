import { json, verifyToken, bearer, clean } from "./_helpers.js";

const STATUSES = ["present", "absent", "late", "trial", "makeup", "other"];

// GET /api/attendance?date=YYYY-MM-DD  -> { marks: { student_id: status } } for that day
// POST /api/attendance {student_id,date,status}  -> upsert one mark (status "" clears it)
export async function onRequestGet({ request, env }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);
  const url = new URL(request.url);
  const re = /^\d{4}-\d{2}-\d{2}$/;

  // Range mode: ?from=&to= -> { byDate: { date: { student_id: status } } }
  const from = clean(url.searchParams.get("from"), 10);
  const to = clean(url.searchParams.get("to"), 10);
  if (re.test(from) && re.test(to)) {
    const res = await env.DB.prepare(
      "SELECT student_id, date, status FROM attendance WHERE date BETWEEN ? AND ?"
    ).bind(from, to).all();
    const byDate = {};
    (res.results || []).forEach((r) => {
      (byDate[r.date] = byDate[r.date] || {})[r.student_id] = r.status;
    });
    return json({ byDate });
  }

  // Single-day mode: ?date= -> { marks: { student_id: status } }
  const date = clean(url.searchParams.get("date"), 10);
  if (!re.test(date)) return json({ error: "valid date required" }, 400);
  const res = await env.DB.prepare(
    "SELECT student_id, status FROM attendance WHERE date = ?"
  ).bind(date).all();
  const marks = {};
  (res.results || []).forEach((r) => { marks[r.student_id] = r.status; });
  return json({ marks });
}

export async function onRequestPost({ request, env }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);
  let body; try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }

  const studentId = clean(body.student_id, 64);
  const date = clean(body.date, 10);
  const status = clean(body.status, 10);
  if (!studentId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: "bad request" }, 400);

  // Empty status clears the mark for that student/day.
  if (!status) {
    await env.DB.prepare("DELETE FROM attendance WHERE student_id = ? AND date = ?").bind(studentId, date).run();
    return json({ ok: true });
  }
  if (!STATUSES.includes(status)) return json({ error: "bad status" }, 400);

  const markedBy = clean(body.marked_by, 60) || null;
  await env.DB.prepare(
    `INSERT INTO attendance (id, student_id, date, status, marked_by, created_at)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(student_id, date) DO UPDATE SET status = excluded.status, marked_by = excluded.marked_by`
  ).bind(crypto.randomUUID(), studentId, date, status, markedBy, Date.now()).run();

  return json({ ok: true });
}
