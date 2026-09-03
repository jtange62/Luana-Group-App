import { json, verifyToken, bearer, clean, safeEqual } from "./_helpers.js";
import { buildToday, summaryText, DATE_RE } from "./_today.js";

// GET /api/summary?date=YYYY-MM-DD[&format=text]
//
// The one thing the app sends out rather than asks for. Staff can preview it
// in the browser with a normal session token; the daily digest workflow reads
// it with SUMMARY_TOKEN, which is set only if someone wants the push.
async function authorized(request, env) {
  const token = bearer(request);
  if (!token) return false;
  if (env.SUMMARY_TOKEN && (await safeEqual(token, env.SUMMARY_TOKEN))) return true;
  return verifyToken(env, token);
}

export async function onRequestGet({ request, env }) {
  if (!(await authorized(request, env))) return json({ error: "unauthorized" }, 401);

  const params = new URL(request.url).searchParams;
  const date = clean(params.get("date"), 10) || new Date().toISOString().slice(0, 10);
  if (!DATE_RE.test(date)) return json({ error: "valid date required" }, 400);

  const data = await buildToday(env.DB, date);
  const text = summaryText(data);

  if (params.get("format") === "text") {
    return new Response(text, {
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
  return json({ date, text, totals: data.totals });
}
