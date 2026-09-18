// Everything the Today page and the daily summary need about one date, built
// in a single database round trip.
//
// The old app spread this across five calls (students, attendance, trials,
// events, lessons) and left the client to stitch them together. Today is the
// page staff open first, so it gets one query batch and one payload.

import { summerWeekOn } from "../../public/school-settings.js";

const STUDENT_PROGRAMS = ["Preschool", "Kinder", "After School", "Summer School"];
const WEEKDAY_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Parse "YYYY-MM-DD" as a UTC calendar date. Using UTC throughout keeps the
// weekday stable no matter which timezone the worker happens to run in.
function parseYMD(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

// Mirrors the calendar client's occursOn(), so Today and the Calendar agree on
// which recurring events land on a given date.
function occursOn(event, date) {
  const start = parseYMD(event.start_date);
  if (date < start) return false;
  if (event.recur_until && date > parseYMD(event.recur_until)) return false;
  const rule = event.recur || "none";
  if (rule === "none") return date.getTime() === start.getTime();
  if (rule === "daily") return true;
  if (rule === "weekly") return date.getUTCDay() === start.getUTCDay();
  if (rule === "monthly") return date.getUTCDate() === start.getUTCDate();
  return false;
}

// A student attends on this weekday. "x" marks a one-off trial placeholder,
// which never belongs to the regular schedule.
function attendsOn(student, weekday, ymd) {
  if (!student.days || student.days === "x") return false;
  if (student.program === "Summer School") {
    const week = summerWeekOn(ymd);
    if (!week || !String(student.ss_weeks || "").split(",").includes(week.id)) return false;
  }
  return student.days.split(",").map(Number).indexOf(weekday) !== -1;
}

const GUEST_STATUSES = ["trial", "makeup", "other"];

export async function buildToday(DB, ymd) {
  const date = parseYMD(ymd);
  const weekday = date.getUTCDay();
  const month = String(date.getUTCMonth() + 1);

  const [studentsRes, marksRes, trialsRes, eventsRes, themesRes] = await DB.batch([
    DB.prepare(
      "SELECT id, name, program, days, allergies, ss_weeks FROM students WHERE active = 1 ORDER BY program, name COLLATE NOCASE"
    ),
    DB.prepare("SELECT student_id, status FROM attendance WHERE date = ?").bind(ymd),
    DB.prepare("SELECT id, name, program FROM trials WHERE date = ? ORDER BY created_at").bind(ymd),
    DB.prepare(
      "SELECT id, title, calendar, program, staff_name, start_date, start_time, end_time, notes, recur, recur_until" +
      " FROM events" +
      " WHERE ((recur IS NOT NULL AND recur != 'none')" +
      "        AND start_date <= ?" +
      "        AND (recur_until IS NULL OR recur_until = '' OR recur_until >= ?))" +
      "    OR ((recur IS NULL OR recur = 'none') AND start_date = ?)" +
      " LIMIT 500"
    ).bind(ymd, ymd, ymd),
    DB.prepare(
      "SELECT id, title, program, song, vocab, activities, phonics FROM lessons" +
      " WHERE kind = 'theme' AND CAST(month AS TEXT) = ? ORDER BY created_at DESC"
    ).bind(month),
  ]);

  const students = studentsRes.results || [];
  const marks = {};
  (marksRes.results || []).forEach((row) => { marks[row.student_id] = row.status; });

  // Newest theme wins for a program, matching how Curriculum picks one.
  const themeFor = {};
  (themesRes.results || []).forEach((theme) => {
    if (theme.program && !themeFor[theme.program]) themeFor[theme.program] = theme;
  });

  const trialsFor = {};
  (trialsRes.results || []).forEach((trial) => {
    (trialsFor[trial.program] = trialsFor[trial.program] || []).push({ id: trial.id, name: trial.name });
  });

  const totals = { expected: 0, present: 0, absent: 0, late: 0, unmarked: 0, guests: 0, trials: 0 };
  const allergies = [];
  const programs = [];

  STUDENT_PROGRAMS.forEach((program) => {
    const inProgram = students.filter((s) => s.program === program);
    const expected = [];
    const guests = [];

    inProgram.forEach((student) => {
      const status = marks[student.id] || "";
      const row = { id: student.id, name: student.name, status, allergies: student.allergies || "" };
      if (attendsOn(student, weekday, ymd)) expected.push(row);
      else if (GUEST_STATUSES.indexOf(status) !== -1 || status === "present" || status === "late") guests.push(row);
    });

    const trials = trialsFor[program] || [];
    if (!expected.length && !guests.length && !trials.length) return;

    const counts = { present: 0, absent: 0, late: 0, unmarked: 0 };
    expected.forEach((row) => {
      if (counts[row.status] !== undefined) counts[row.status]++;
      else if (!row.status) counts.unmarked++;
    });

    // Allergy notes only for children actually in the building today.
    expected.concat(guests).forEach((row) => {
      if (row.allergies && row.status !== "absent") {
        allergies.push({ name: row.name, program, allergies: row.allergies });
      }
    });

    totals.expected += expected.length;
    totals.present += counts.present;
    totals.absent += counts.absent;
    totals.late += counts.late;
    totals.unmarked += counts.unmarked;
    totals.guests += guests.length;
    totals.trials += trials.length;

    programs.push({
      program,
      theme: themeFor[program] || null,
      expected,
      guests,
      trials,
      counts,
      done: expected.length > 0 && counts.unmarked === 0,
    });
  });

  const events = (eventsRes.results || [])
    .filter((event) => (event.calendar || "students") !== "students" && occursOn(event, date))
    .map((event) => ({
      id: event.id,
      title: event.title,
      calendar: event.calendar || "general",
      program: event.program || "",
      staff_name: event.staff_name || "",
      start_time: event.start_time || "",
      end_time: event.end_time || "",
      notes: event.notes || "",
    }))
    .sort((a, b) => (a.start_time || "99:99").localeCompare(b.start_time || "99:99"));

  return {
    date: ymd,
    weekday: WEEKDAY_FULL[weekday],
    pretty: WEEKDAY_FULL[weekday] + ", " + date.getUTCDate() + " " + MONTHS[date.getUTCMonth()],
    programs,
    events,
    allergies,
    totals,
  };
}

// Plain-text digest — what gets pushed to a chat channel each afternoon.
export function summaryText(data) {
  const lines = ["Luana — " + data.pretty];

  if (!data.programs.length) {
    lines.push("", "No classes scheduled.");
    return lines.join("\n");
  }

  data.programs.forEach((group) => {
    const bits = [];
    if (group.counts.present) bits.push(group.counts.present + " in");
    if (group.counts.late) bits.push(group.counts.late + " late");
    if (group.counts.absent) bits.push(group.counts.absent + " out");
    if (group.counts.unmarked) bits.push(group.counts.unmarked + " not marked");
    lines.push("", group.program + " (" + group.expected.length + ") — " + (bits.join(", ") || "nothing marked yet"));

    const away = group.expected.filter((row) => row.status === "absent").map((row) => row.name);
    if (away.length) lines.push("  Absent: " + away.join(", "));

    const guests = group.guests.map((row) => row.name + " (" + row.status + ")")
      .concat(group.trials.map((trial) => trial.name + " (trial)"));
    if (guests.length) lines.push("  Also in: " + guests.join(", "));

    if (group.theme) {
      const extra = group.theme.song ? " · Song: " + group.theme.song : "";
      lines.push("  Theme: " + group.theme.title + extra);
    }
  });

  if (data.allergies.length) {
    lines.push("", "Allergies in the building today:");
    data.allergies.forEach((row) => lines.push("  ⚠ " + row.name + " — " + row.allergies));
  }

  if (data.events.length) {
    lines.push("", "On today:");
    data.events.forEach((event) => {
      const when = event.start_time ? event.start_time + " " : "";
      const who = event.staff_name ? " (" + event.staff_name + ")" : "";
      lines.push("  " + when + event.title + who);
    });
  }

  const pending = data.programs.filter((group) => group.counts.unmarked > 0);
  if (pending.length) {
    lines.push("", "Still to mark: " + pending.map((g) => g.program + " (" + g.counts.unmarked + ")").join(", "));
  }

  return lines.join("\n");
}
