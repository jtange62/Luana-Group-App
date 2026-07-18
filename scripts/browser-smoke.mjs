import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import AxeBuilder from "@axe-core/playwright";

const origin = "http://127.0.0.1:8791";
const chromePath = [
  process.env.LUANA_CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium",
].find((path) => path && existsSync(path));
if (!chromePath) throw new Error("No supported system Chrome/Edge executable was found");

async function accessibilityFailures(page) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return result.violations
    .filter((violation) => violation.impact === "critical" || violation.impact === "serious")
    .map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`);
}

function run(command) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { shell: true, windowsHide: true, stdio: "inherit" });
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
  });
}

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try { if ((await fetch(origin + "/")).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Local Wrangler server did not start");
}

await run("wrangler d1 execute luana-board --local --file schema.sql");
const server = spawn(
  "wrangler pages dev public --port 8791 --binding STAFF_PASSWORD=test --binding SESSION_SECRET=browser-smoke-test-secret",
  { shell: true, windowsHide: true, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] }
);
server.stdout.on("data", () => {});
server.stderr.on("data", () => {});

let browser;
try {
  await waitForServer();
  const login = await fetch(origin + "/api/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "test" }),
  });
  if (!login.ok) throw new Error(`Local login failed (${login.status})`);
  const { token } = await login.json();
  if (!token) throw new Error("Local login returned no token");

  browser = await chromium.launch({ executablePath: chromePath, headless: true });
  const loginContext = await browser.newContext({ viewport: { width: 480, height: 900 } });
  const loginPage = await loginContext.newPage();
  await loginPage.goto(origin + "/", { waitUntil: "domcontentloaded" });
  const loginAccessibility = await accessibilityFailures(loginPage);
  if (loginAccessibility.length) throw new Error(`login accessibility: ${loginAccessibility.join("; ")}`);
  await loginPage.fill("#pwInput", "test");
  await loginPage.fill("#gateName", "browser-login");
  await loginPage.click("#enterBtn");
  await loginPage.waitForSelector("#hub", { state: "visible" });
  if (!(await loginPage.evaluate(() => !!localStorage.getItem("luana_token")))) throw new Error("UI login stored no token");
  console.log("✓ login");
  await loginContext.close();

  const context = await browser.newContext({ viewport: { width: 480, height: 900 } });
  await context.addInitScript(({ authToken }) => {
    localStorage.setItem("luana_token", authToken);
    localStorage.setItem("luana_name", "browser-smoke");
  }, { authToken: token });

  const tools = [
    ["calendar", "#view"], ["curriculum", "#months"], ["ideas", "#feed"],
    ["library", "#list"], ["students", "#list"], ["website", "#list"],
  ];
  for (const [tool, selector] of tools) {
    const page = await context.newPage();
    const failures = [];
    page.on("pageerror", (error) => failures.push(error.message));
    page.on("response", (response) => {
      if (response.url().includes("/api/") && response.status() >= 500) failures.push(`${response.status()} ${response.url()}`);
    });
    const response = await page.goto(`${origin}/tools/${tool}/`, { waitUntil: "domcontentloaded" });
    if (!response || !response.ok()) failures.push(`page status ${response?.status()}`);
    await page.waitForSelector(selector, { state: "attached" });
    await page.waitForTimeout(300);
    failures.push(...await accessibilityFailures(page));
    if (page.url() === origin + "/") failures.push("redirected to login");
    if (failures.length) throw new Error(`${tool}: ${failures.join("; ")}`);
    console.log(`✓ ${tool}`);
    await page.close();
  }
  const navigationPage = await context.newPage();
  await navigationPage.goto(origin + "/", { waitUntil: "domcontentloaded" });
  await navigationPage.click('a[href="/tools/ideas/"]');
  await navigationPage.waitForURL("**/tools/ideas/");
  await navigationPage.click("a.back-btn");
  await navigationPage.waitForURL(origin + "/");
  console.log("✓ back navigation");
  await navigationPage.close();
  console.log("Browser smoke checks passed.");
} finally {
  if (browser) await browser.close();
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  } else {
    try { process.kill(-server.pid, "SIGTERM"); } catch { server.kill("SIGTERM"); }
  }
}
