import { json, verifyToken, bearer } from "./_helpers.js";

// List every website-inbox submission with its attached files.
export async function onRequestGet({ request, env }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);

  // One round trip; subselect instead of an IN (?,?,...) id list, which would
  // exceed D1's 100-bound-parameter cap.
  const recent = "SELECT id FROM submissions ORDER BY created_at DESC LIMIT 1000";
  const [subsRes, filesRes] = await env.DB.batch([
    env.DB.prepare("SELECT * FROM submissions ORDER BY created_at DESC LIMIT 1000"),
    env.DB.prepare(`SELECT * FROM submission_files WHERE submission_id IN (${recent}) ORDER BY created_at ASC`),
  ]);
  const submissions = subsRes.results || [];
  if (submissions.length === 0) return json({ submissions: [] });

  const bySub = {};
  (filesRes.results || []).forEach((f) => {
    (bySub[f.submission_id] = bySub[f.submission_id] || []).push({
      id: f.id, filename: f.filename, size: f.size, type: f.type,
    });
  });

  submissions.forEach((s) => { s.files = bySub[s.id] || []; });
  return json({ submissions });
}
