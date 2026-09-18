// Keep enrollment labels and daily attendance on the same dated schedule.
// Add the next year's actual dates before enrolling its Summer School students.
export const SUMMER_WEEKS = [
  { id: "1", start: "2026-07-27", end: "2026-07-31", label: "Week 1 · Jul 27–31, 2026" },
  { id: "2", start: "2026-08-03", end: "2026-08-07", label: "Week 2 · Aug 3–7, 2026" },
  { id: "3", start: "2026-08-17", end: "2026-08-21", label: "Week 3 · Aug 17–21, 2026" }
];

export function summerWeekOn(date) {
  return SUMMER_WEEKS.find((week) => date >= week.start && date <= week.end);
}
