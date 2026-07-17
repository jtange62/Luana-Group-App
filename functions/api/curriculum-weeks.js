import { json, verifyToken, bearer, clean } from "./_helpers.js";

// List curriculum weeks with their retro comments attached. Optionally scoped
// to one theme via ?lesson=<id>; the Curriculum tool just loads them all and
// groups client-side. Comments use a subselect (not an id list) because D1
// caps bound params — same pattern as posts.js.
export async function onRequestGet({ request, env }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);

  const url = new URL(request.url);
  const lessonId = clean(url.searchParams.get("lesson"), 60);

  const [weeksRes, commentsRes, daysRes] = await env.DB.batch(lessonId
    ? [
        env.DB.prepare("SELECT * FROM curriculum_weeks WHERE lesson_id = ? ORDER BY week_no ASC").bind(lessonId),
        env.DB.prepare("SELECT * FROM week_comments WHERE week_id IN (SELECT id FROM curriculum_weeks WHERE lesson_id = ?) ORDER BY created_at ASC").bind(lessonId),
        env.DB.prepare("SELECT * FROM week_days WHERE week_id IN (SELECT id FROM curriculum_weeks WHERE lesson_id = ?) ORDER BY date ASC").bind(lessonId),
      ]
    : [
        env.DB.prepare("SELECT * FROM curriculum_weeks ORDER BY lesson_id, week_no ASC"),
        env.DB.prepare("SELECT * FROM week_comments WHERE week_id IN (SELECT id FROM curriculum_weeks) ORDER BY created_at ASC"),
        env.DB.prepare("SELECT * FROM week_days WHERE week_id IN (SELECT id FROM curriculum_weeks) ORDER BY date ASC"),
      ]);

  const commentsByWeek = {};
  for (const c of commentsRes.results || []) {
    // id stays in — the client needs it to delete a comment.
    (commentsByWeek[c.week_id] = commentsByWeek[c.week_id] || []).push({
      id: c.id, author: c.author, text: c.text, created_at: c.created_at,
    });
  }
  const daysByWeek = {};
  for (const d of daysRes.results || []) {
    (daysByWeek[d.week_id] = daysByWeek[d.week_id] || []).push({
      id: d.id, date: d.date, subtheme: d.subtheme, vocab: d.vocab,
    });
  }
  const weeks = (weeksRes.results || []).map((w) => ({
    ...w,
    comments: commentsByWeek[w.id] || [],
    days: daysByWeek[w.id] || [],
  }));

  return json({ weeks });
}
