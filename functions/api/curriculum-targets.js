import { json, verifyToken, bearer } from "./_helpers.js";

// Everywhere an idea can be filed, in one round trip: each theme, its weeks,
// and each week's days. Small enough to send whole (22 themes, 16 weeks, 13
// days today) and it keeps the "send to curriculum" picker from needing three
// separate calls before it can open.
import {schoolYear} from './_school-year.js';

export async function onRequestGet({ request, env }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);

  const [themesRes, weeksRes, daysRes] = await env.DB.batch([
    env.DB.prepare(
      "SELECT id, title, program, month FROM lessons WHERE kind = 'theme' AND school_year = ? ORDER BY program, CAST(month AS INTEGER)"
    ).bind(schoolYear()),
    env.DB.prepare(
      "SELECT id, lesson_id, week_no, focus FROM curriculum_weeks ORDER BY lesson_id, week_no"
    ),
    env.DB.prepare(
      "SELECT id, week_id, date, subtheme FROM week_days ORDER BY week_id, date"
    ),
  ]);

  const daysByWeek = {};
  (daysRes.results || []).forEach((day) => {
    (daysByWeek[day.week_id] = daysByWeek[day.week_id] || []).push(day);
  });

  const weeksByTheme = {};
  (weeksRes.results || []).forEach((week) => {
    week.days = daysByWeek[week.id] || [];
    (weeksByTheme[week.lesson_id] = weeksByTheme[week.lesson_id] || []).push(week);
  });

  const themes = (themesRes.results || []).map((theme) => ({
    ...theme,
    weeks: weeksByTheme[theme.id] || [],
  }));

  return json({ themes });
}
