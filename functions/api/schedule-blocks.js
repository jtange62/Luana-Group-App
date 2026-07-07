import { json, verifyToken, bearer, clean } from "./_helpers.js";

const PROGRAMS = ["Preschool", "Kinder", "After School", "Summer School"];

function cleanProgram(raw) {
  const v = clean(raw, 40);
  return PROGRAMS.includes(v) ? v : null;
}
function cleanDate(raw) {
  const v = clean(raw, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

// A program's daily-rhythm template, plus (when ?date= is given) the one-off
// notes pinned to its blocks on that date — one round trip for the Day view.
export async function onRequestGet({ request, env }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);

  const url = new URL(request.url);
  const program = cleanProgram(url.searchParams.get("program"));
  if (!program) return json({ error: "valid program required" }, 400);

  const { results: blocks } = await env.DB.prepare(
    "SELECT * FROM schedule_blocks WHERE program = ? ORDER BY start_time ASC, created_at ASC"
  ).bind(program).all();

  let notes = [];
  const date = cleanDate(url.searchParams.get("date"));
  if (date) {
    const res = await env.DB.prepare(
      "SELECT n.* FROM day_block_notes n JOIN schedule_blocks b ON b.id = n.block_id WHERE b.program = ? AND n.date = ?"
    ).bind(program, date).all();
    notes = res.results;
  }

  return json({ blocks, notes });
}
