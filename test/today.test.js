import test from "node:test";
import assert from "node:assert/strict";

import { makeToken } from "../functions/api/_helpers.js";
import { buildToday, summaryText } from "../functions/api/_today.js";
import { onRequestGet as getToday } from "../functions/api/today.js";
import { onRequestGet as getLessons } from "../functions/api/lessons.js";
import { onRequestPost as postUsage } from "../functions/api/usage.js";

const SESSION_SECRET = "test-only-session-secret-that-is-long-enough";

// 2026-09-03 is a Thursday, so weekday 4 is "expected today" below.
const DATE = "2026-09-03";

// buildToday issues one batch of five statements: students, marks, trials,
// events, themes. The spy answers them in that order and records the bindings.
function batchSpy(resultSets) {
  const statements = [];
  const DB = {
    statements,
    prepare(sql) {
      const entry = { sql, bindings: [] };
      statements.push(entry);
      const stub = {
        bind(...bindings) { entry.bindings = bindings; return stub; },
        async all() { return { results: resultSets[statements.indexOf(entry)] || [] }; },
        async run() { entry.ran = true; return { success: true }; },
      };
      return stub;
    },
    async batch() { return resultSets.map((results) => ({ results })); },
  };
  return DB;
}

const STUDENTS = [
  { id: "s1", name: "Aiko", program: "Preschool", days: "2,4", allergies: "peanuts" },
  { id: "s2", name: "Ben", program: "Preschool", days: "2,4", allergies: "" },
  { id: "s3", name: "Cara", program: "Preschool", days: "1", allergies: "dairy" },
  { id: "s4", name: "Dai", program: "Kinder", days: "x", allergies: "" },
  { id: "s5", name: "Emi", program: "Kinder", days: "4", allergies: "sesame" },
];
const MARKS = [
  { student_id: "s1", status: "present" },
  { student_id: "s2", status: "absent" },
  { student_id: "s4", status: "makeup" },
];
const EVENTS = [
  { id: "e1", title: "Fire drill", calendar: "general", start_date: "2026-09-03", start_time: "10:00", recur: "none" },
  { id: "e2", title: "Weekly staff meeting", calendar: "staff", staff_name: "Jane", start_date: "2026-08-06", start_time: "08:30", recur: "weekly" },
  { id: "e3", title: "Monday assembly", calendar: "general", start_date: "2026-08-31", start_time: "09:00", recur: "weekly" },
  { id: "e4", title: "Preschool attendance note", calendar: "students", start_date: "2026-09-03", recur: "none" },
];
const THEMES = [
  { id: "t1", title: "Under the Sea", program: "Preschool", song: "Baby Shark", vocab: "fish, crab" },
];

function sample() {
  return buildToday(batchSpy([STUDENTS, MARKS, [], EVENTS, THEMES]), DATE);
}

test("today groups only the students the weekday actually expects", async () => {
  const data = await sample();

  assert.deepEqual(data.programs.map((group) => group.program), ["Preschool", "Kinder"]);

  const preschool = data.programs[0];
  assert.deepEqual(preschool.expected.map((row) => row.name), ["Aiko", "Ben"]);
  assert.deepEqual(preschool.counts, { present: 1, absent: 1, late: 0, unmarked: 0 });
  assert.equal(preschool.done, true);

  // Cara attends Mondays, so she is neither expected nor a guest today.
  const names = data.programs.flatMap((g) => g.expected.concat(g.guests)).map((row) => row.name);
  assert.equal(names.includes("Cara"), false);
});

test('a "x" placeholder student is never scheduled but can still turn up', async () => {
  const kinder = (await sample()).programs[1];

  assert.deepEqual(kinder.expected.map((row) => row.name), ["Emi"]);
  assert.deepEqual(kinder.guests.map((row) => [row.name, row.status]), [["Dai", "makeup"]]);
  assert.equal(kinder.counts.unmarked, 1);
  assert.equal(kinder.done, false);
});

test("allergy alerts cover children in the building, not children marked absent", async () => {
  const data = await sample();

  // Aiko (present) and Emi (unmarked, still expected) carry allergies. Ben has
  // none, and Cara is not in today at all.
  assert.deepEqual(data.allergies.map((row) => row.name), ["Aiko", "Emi"]);

  const absentWithAllergies = await buildToday(
    batchSpy([STUDENTS, [{ student_id: "s1", status: "absent" }], [], [], []]),
    DATE
  );
  assert.equal(absentWithAllergies.allergies.some((row) => row.name === "Aiko"), false);
});

test("today keeps school-wide and staff events, and drops the attendance calendar", async () => {
  const data = await sample();

  // Fire drill lands on the date, the weekly staff meeting recurs onto a
  // Thursday, the Monday assembly does not, and the students calendar is the
  // register itself rather than an event.
  assert.deepEqual(data.events.map((event) => event.title), ["Weekly staff meeting", "Fire drill"]);
});

test("totals add up across classes", async () => {
  const data = await sample();
  assert.deepEqual(data.totals, {
    expected: 3, present: 1, absent: 1, late: 0, unmarked: 1, guests: 1, trials: 0,
  });
});

test("themes are looked up by the date's own month", async () => {
  const DB = batchSpy([STUDENTS, MARKS, [], EVENTS, THEMES]);
  await buildToday(DB, DATE);

  const themeQuery = DB.statements.find((entry) => entry.sql.includes("FROM lessons"));
  assert.match(themeQuery.sql, /kind = 'theme'/);
  assert.deepEqual(themeQuery.bindings, ["9", 2026]);
});

test("the summary reads as a message, and names what is still unmarked", async () => {
  const text = summaryText(await sample());

  assert.match(text, /^Luana — Thursday, 3 September · 2026–2027 school year$/m);
  assert.match(text, /^Preschool \(2\) — 1 in, 1 out$/m);
  assert.match(text, /^ {2}Absent: Ben$/m);
  assert.match(text, /^ {2}Theme: Under the Sea · Song: Baby Shark$/m);
  assert.match(text, /^ {2}Also in: Dai \(makeup\)$/m);
  assert.match(text, /^ {2}⚠ Aiko — peanuts$/m);
  assert.match(text, /^Still to mark: Kinder \(1\)$/m);
});

test("today rejects a request without a valid date", async () => {
  const token = await makeToken({ SESSION_SECRET });
  const headers = { Authorization: `Bearer ${token}` };

  const bad = await getToday({
    request: new Request("https://example.test/api/today?date=tomorrow", { headers }),
    env: { DB: batchSpy([]), SESSION_SECRET },
  });
  assert.equal(bad.status, 400);

  const unauthorized = await getToday({
    request: new Request("https://example.test/api/today?date=" + DATE),
    env: { DB: batchSpy([]), SESSION_SECRET },
  });
  assert.equal(unauthorized.status, 401);
});

test("library and curriculum queries stay on their own side of the lessons table", async () => {
  for (const kind of ["lesson", "theme"]) {
    const DB = batchSpy([[]]);
    const token = await makeToken({ SESSION_SECRET });
    await getLessons({
      request: new Request(`https://example.test/api/lessons?kind=${kind}&files=0`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      env: { DB, SESSION_SECRET },
    });
    assert.match(DB.statements[0].sql, /l\.kind = \?/);
    assert.ok(DB.statements[0].bindings.includes(kind));
  }

  // An unrecognised kind is ignored rather than injected into the query.
  const DB = batchSpy([[]]);
  const token = await makeToken({ SESSION_SECRET });
  await getLessons({
    request: new Request("https://example.test/api/lessons?kind=everything&files=0", {
      headers: { Authorization: `Bearer ${token}` },
    }),
    env: { DB, SESSION_SECRET },
  });
  assert.equal(/l\.kind = \?/.test(DB.statements[0].sql), false);
});

test("usage counts only known tools", async () => {
  const token = await makeToken({ SESSION_SECRET });
  const send = (tool) => postUsage({
    request: new Request("https://example.test/api/usage", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ tool }),
    }),
    env: { DB: batchSpy([[]]), SESSION_SECRET },
  });

  assert.equal((await send("today")).status, 200);
  assert.equal((await send("../../etc")).status, 400);
});
