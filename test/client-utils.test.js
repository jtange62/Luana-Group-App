import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

await import("../public/shared-utils.js");
const utils = globalThis.LuanaUtils;

test("shared HTML escaping covers text and attribute-sensitive characters", () => {
  assert.equal(utils.esc(`<a title="x">Tom & 'Luana'</a>`), "&lt;a title=&quot;x&quot;&gt;Tom &amp; &#39;Luana&#39;&lt;/a&gt;");
});

test("shared display helpers preserve existing formatting", () => {
  assert.equal(utils.fileSize(0), "");
  assert.equal(utils.fileSize(512), "512 B");
  assert.equal(utils.fileSize(1536), "2 KB");
  assert.equal(utils.fileSize(2.5 * 1024 * 1024), "2.5 MB");
  assert.equal(utils.isImage({ type: "image/png" }), true);
  assert.equal(utils.isImage({ type: "application/pdf" }), false);
});

test("shared URL helpers strip trailing prose punctuation and emit safe links", () => {
  assert.equal(utils.firstUrl("See https://example.com/path)."), "https://example.com/path");
  assert.equal(
    utils.linkify("See https://example.com/path."),
    'See <a href="https://example.com/path" target="_blank" rel="noopener noreferrer">https://example.com/path</a>'
  );
});

test("every tool loads shared utilities before its page script", async () => {
  for (const tool of ["ideas", "library", "website", "calendar", "students", "curriculum"]) {
    const html = await readFile(new URL(`../public/tools/${tool}/index.html`, import.meta.url), "utf8");
    assert.ok(html.indexOf('/shared-utils.js') > -1, `${tool} is missing shared-utils.js`);
    assert.ok(html.indexOf('/shared-utils.js') < html.indexOf(`./${tool}.js`), `${tool} loads utilities too late`);
  }
});

test("calendar event loading remains date-scoped", async () => {
  const source = await readFile(new URL("../public/tools/calendar/calendar.js", import.meta.url), "utf8");
  assert.match(source, /events\?from=" \+ range\.from \+ "&to=" \+ range\.to/);
  assert.doesNotMatch(source, /LuanaAuth\.api\("events"\)/);
  assert.match(source, /state\.view === "week"/);
  assert.match(source, /state\.view === "agenda"/);
});
