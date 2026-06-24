import { json, verifyToken, bearer } from "./_helpers.js";

// List every website-inbox submission with its attached files.
export async function onRequestGet({ request, env }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);

  const subsRes = await env.DB.prepare(
    "SELECT * FROM submissions ORDER BY created_at DESC LIMIT 1000"
  ).all();
  const submissions = subsRes.results || [];
  if (submissions.length === 0) return json({ submissions: [] });

  const ids = submissions.map((s) => s.id);
  const placeholders = ids.map(() => "?").join(",");
  const filesRes = await env.DB.prepare(
    `SELECT * FROM submission_files WHERE submission_id IN (${placeholders}) ORDER BY created_at ASC`
  ).bind(...ids).all();

  const bySub = {};
  (filesRes.results || []).forEach((f) => {
    (bySub[f.submission_id] = bySub[f.submission_id] || []).push({
      id: f.id, filename: f.filename, size: f.size, type: f.type,
    });
  });

  submissions.forEach((s) => { s.files = bySub[s.id] || []; });
  return json({ submissions });
}
