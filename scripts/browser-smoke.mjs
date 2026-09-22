import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
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

const externalServer = process.env.LUANA_TEST_EXISTING_SERVER === "1";
if (!externalServer) await run("wrangler d1 execute luana-board --local --file schema.sql");
const server = externalServer ? null : spawn(
  "wrangler pages dev public --port 8791 --binding STAFF_PASSWORD=test --binding SESSION_SECRET=browser-smoke-test-secret",
  { shell: true, windowsHide: true, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] }
);
server?.stdout.on("data", () => {});
server?.stderr.on("data", () => {});

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
  await loginPage.waitForSelector("#board", { state: "visible" });
  if (!(await loginPage.evaluate(() => !!localStorage.getItem("luana_token")))) throw new Error("UI login stored no token");
  console.log("✓ login");
  await loginContext.close();

  const context = await browser.newContext({ viewport: { width: 480, height: 900 } });
  await context.addInitScript(({ authToken }) => {
    localStorage.setItem("luana_token", authToken);
    localStorage.setItem("luana_name", "browser-smoke");
  }, { authToken: token });

  const tools = [
    ["", "#feed"], ["tools", "#grid"], ["today", "#register"],
    ["calendar", "#view"], ["curriculum", "#months"],
    ["students", "#list"], ["website", "#list"],
  ];
  for (const [tool, selector] of tools) {
    const page = await context.newPage();
    const failures = [];
    page.on("pageerror", (error) => failures.push(error.message));
    page.on("response", (response) => {
      if (response.url().includes("/api/") && response.status() >= 500) failures.push(`${response.status()} ${response.url()}`);
    });
    const path = tool === "" ? "/" : tool === "tools" ? "/tools/" : `/tools/${tool}/`;
    const response = await page.goto(origin + path, { waitUntil: "domcontentloaded" });
    if (!response || !response.ok()) failures.push(`page status ${response?.status()}`);
    await page.waitForSelector(selector, { state: "attached" });
    await page.waitForTimeout(300);
    failures.push(...await accessibilityFailures(page));
    if (tool !== "" && page.url() === origin + "/") failures.push("redirected to login");
    if (failures.length) throw new Error(`${tool || "board"}: ${failures.join("; ")}`);
    console.log(`✓ ${tool || "board"}`);
    await page.close();
  }
  const keyboardPage = await context.newPage();
  await keyboardPage.goto(`${origin}/tools/students/`, { waitUntil: "domcontentloaded" });
  await keyboardPage.waitForSelector("#addBtn");
  await keyboardPage.focus("#addBtn");
  await keyboardPage.keyboard.press("Enter");
  await keyboardPage.waitForSelector("#modal:not([hidden])");
  if (await keyboardPage.getAttribute("#modal", "role") !== "dialog") throw new Error("modal has no dialog role");
  await keyboardPage.keyboard.press("Escape");
  await keyboardPage.waitForSelector("#modal", { state: "hidden" });
  if (await keyboardPage.evaluate(() => document.activeElement?.id) !== "addBtn") throw new Error("modal did not restore focus");
  console.log("✓ keyboard modal navigation");
  await keyboardPage.close();
  const navigationPage = await context.newPage();
  await navigationPage.goto(origin + "/", { waitUntil: "domcontentloaded" });
  await navigationPage.click('a[href="/tools/"]');
  await navigationPage.waitForURL("**/tools/");
  await navigationPage.click('a[href="/tools/today/"]');
  await navigationPage.waitForURL("**/tools/today/");
  await navigationPage.click("a.back-btn");
  await navigationPage.waitForURL("**/tools/");
  await navigationPage.click("a.back-btn");
  await navigationPage.waitForURL(origin + "/");
  console.log("✓ back navigation");
  await navigationPage.close();
  // Exercise real staff journeys with temporary local-only records.
  const workflow = await context.newPage();
  const api = async (route, method, body) => {
    const response = await fetch(origin + "/api/" + route, { method, headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok) throw new Error(route + ": " + await response.text());
    return response.json();
  };
  const marker = "workflow-" + Date.now();
  let postId, eventId, resourceId;
  try {
    await workflow.goto(origin + "/");

    await workflow.locator("#ideaInput").fill(marker);
    await workflow.route("**/api/post", route => route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({error:"Please try again"})}));
    await workflow.locator("#postBtn").click();
    await workflow.getByRole("alert").filter({hasText:"Please try again"}).waitFor();
    if (await workflow.locator("#ideaInput").inputValue() !== marker) throw new Error("Failed submission lost draft");
    await workflow.unroute("**/api/post");
    await workflow.locator("#postBtn").click();
    await workflow.getByText(marker, { exact: true }).waitFor();
    const records = await api("posts?category=general", "GET");
    const post = records.posts.find(row => row.text === marker);
    if (!post) throw new Error("Shared message did not appear");
    postId = post.id;
    const card = workflow.locator('[data-post-id="' + postId + '"]');
    await card.getByRole("button", {name:"Mark as completed",exact:true}).click();
    await card.waitFor({state:"detached"});
    await workflow.getByLabel("Show completed",{exact:true}).check();
    await card.getByText("✓ Completed",{exact:true}).waitFor();
    await workflow.reload();
    await workflow.locator("#loading").waitFor({state:"hidden"});
    if (await workflow.getByLabel("Show completed",{exact:true}).isChecked() || await card.count()) throw new Error("Completed posts must be hidden on opening the staff room");
    await workflow.getByLabel("Show completed",{exact:true}).check();
    await card.locator("summary").click();
    await card.getByRole("button",{name:"Reopen",exact:true}).click();
    await card.locator(".complete-btn").waitFor();
    await workflow.getByLabel("Show completed",{exact:true}).uncheck();
    await card.locator(".reply-toggle").click();
    await card.locator(".reply-box input").fill("Keep my reply");
    await workflow.locator("#ideaInput").fill("Keep my idea");
    await workflow.reload();
    await workflow.locator(".reply-box input").filter({visible:true}).first().waitFor();
    if (await workflow.locator("#ideaInput").inputValue() !== "Keep my idea") throw new Error("Composer draft lost");
    if (await card.locator(".reply-box input").inputValue() !== "Keep my reply") throw new Error("Reply draft lost");
    await workflow.locator("#ideaInput").fill("");
    await card.locator("summary").click();
    await card.getByRole("button",{name:"Make this a task",exact:true}).click();
    await card.locator(".item-add input").fill("Bring scissors");
    await card.locator(".item-add button").click();
    await card.locator(".complete-btn").waitFor();
    await card.locator(".complete-btn").click();
    await card.waitFor({state:"detached"});
    await workflow.getByLabel("Show completed",{exact:true}).check();
    await card.getByText("✓ Completed",{exact:true}).waitFor();
    await card.locator("summary").click();
    await card.getByRole("button",{name:"Reopen",exact:true}).click();
    await card.locator(".complete-btn").waitFor();
    console.log("✓ sharing, task conversion, completion and draft recovery");

    const uploadedResponse = workflow.waitForResponse(response => response.url().endsWith("/api/post") && response.request().method() === "POST");
    await workflow.locator("#ideaFiles").setInputFiles({name:marker+".txt",mimeType:"text/plain",buffer:Buffer.from("Shared worksheet resource")});
    await workflow.locator("#ideaPhotos").setInputFiles({name:marker+".png",mimeType:"image/png",buffer:Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=","base64")});
    await workflow.locator("#postBtn").click();
    const uploaded = await (await uploadedResponse).json();
    if (!uploaded.id) throw new Error("Caption-free file sharing failed");
    resourceId = uploaded.id;
    await workflow.getByRole("link",{name:"Resources",exact:true}).click();
    await workflow.locator('[data-post-id="'+resourceId+'"] .photo.loaded').waitFor();
    await workflow.getByRole("button",{name:"Files",exact:true}).click();
    await workflow.locator("#boardSearch").fill(marker);
    await workflow.locator('[data-post-id="'+resourceId+'"]').waitFor();
    console.log("✓ caption-free upload and filename search in Resources");

    const today = await workflow.evaluate(() => { const d=new Date(); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); });
    eventId = (await api("event", "POST", {title:marker,calendar:"general",start_date:today,author:"browser-smoke"})).id;
    await workflow.goto(origin + "/tools/calendar/");
    await workflow.locator("#dayEvents").getByText(marker,{exact:true}).waitFor();
    await workflow.locator('[data-view="week"]').click();
    await workflow.locator("#view").getByText(marker,{exact:true}).waitFor();
    await workflow.locator('[data-view="agenda"]').click();
    await workflow.locator("#view").getByText(marker,{exact:true}).waitFor();
    console.log("✓ saved calendar event appears in month, week and agenda");
    const eventRow = workflow.locator("#view .ev-row").filter({hasText:marker});
    workflow.once("dialog", dialog => dialog.dismiss());
    await eventRow.getByRole("button",{name:"Delete",exact:true}).click();
    await eventRow.waitFor();
    workflow.once("dialog", dialog => dialog.accept());
    await eventRow.getByRole("button",{name:"Delete",exact:true}).click();
    await eventRow.waitFor({state:"detached"});
    eventId = null;
    console.log("✓ calendar deletion is directly available and respects cancellation");

    mkdirSync(".wrangler/review", {recursive:true});
    for (const viewport of [{width:390,height:844},{width:1280,height:900}]) {
      await workflow.setViewportSize(viewport);
      for (const route of ["/", "/tools/curriculum/", "/tools/students/", "/tools/calendar/"]) {
        await workflow.goto(origin+route);
        await workflow.locator(".app-nav").waitFor();
        await workflow.screenshot({path:".wrangler/review/"+(route.split("/").filter(Boolean).pop() || "ideas")+"-"+viewport.width+".png",fullPage:true});
        if (await workflow.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error("Horizontal overflow: " + route);
      }
    }
    console.log("✓ phone and desktop navigation/layout");
  } finally {
    if (resourceId) await api("post", "DELETE", {id:resourceId,author:"browser-smoke"});
    if (postId) await api("post", "DELETE", {id:postId,author:"browser-smoke"});
    if (eventId) await api("event", "DELETE", {id:eventId,author:"browser-smoke"});
    await workflow.close();
  }

  const attendancePage = await context.newPage();
  let planningStudent, makeupId, trialId, planningClosure;
  try {
    planningStudent=(await api("students","POST",{name:"Planning student "+marker,program:"Preschool",days:"1"})).id;
    await attendancePage.goto(origin+"/tools/today/");
    await attendancePage.locator('[data-view="week"][aria-pressed="true"]').waitFor();
    await attendancePage.locator("#planner .week-grid").first().waitFor();
    await attendancePage.getByRole("button",{name:"Day",exact:true}).click();
    await attendancePage.locator("#selectedDate").fill("2026-09-22");
    await attendancePage.locator("#selectedDate").dispatchEvent("change");
    await attendancePage.locator("#addVisit").click();
    await attendancePage.locator("#visitClass").selectOption("Kinder");
    await attendancePage.locator('#visitStudent option[value="'+planningStudent+'"]').waitFor({state:"attached"});
    await attendancePage.locator("#visitStudent").selectOption(planningStudent);
    const makeupResponse=attendancePage.waitForResponse(r=>r.url().endsWith("/api/visits")&&r.request().method()==="POST");
    await attendancePage.locator("#visitSave").click();
    makeupId=(await(await makeupResponse).json()).id;
    await attendancePage.locator("#visitModal").waitFor({state:"hidden"});
    await attendancePage.locator("#classFilter").selectOption("Kinder");
    await attendancePage.getByRole("button",{name:"Present — Planning student "+marker,exact:true}).click();
    await attendancePage.locator('.mark.on-present').waitFor();
    await attendancePage.getByRole("button",{name:"Week",exact:true}).click();
    await attendancePage.locator('.plan-name').filter({hasText:"Planning student "+marker+" · Makeup"}).waitFor();
    await attendancePage.getByRole("button",{name:"Month",exact:true}).click();
    await attendancePage.getByRole("button",{name:/Kinder, Tuesday, 22 September/}).click();
    await attendancePage.locator('.mark.on-present').waitFor();
    await attendancePage.locator("#addVisit").click();
    await attendancePage.locator("#visitKind").selectOption("trial");
    await attendancePage.locator("#visitName").fill("Trial child "+marker);
    const trialResponse=attendancePage.waitForResponse(r=>r.url().endsWith("/api/visits")&&r.request().method()==="POST");
    await attendancePage.locator("#visitSave").click();
    trialId=(await(await trialResponse).json()).id;
    await attendancePage.getByRole("button",{name:"Absent — Trial child "+marker,exact:true}).click();
    await attendancePage.locator('.mark.on-absent').waitFor();
    planningClosure=(await api("event","POST",{title:"Planning closure "+marker,calendar:"general",event_type:"closure",program:"Kinder",start_date:"2026-09-22",end_date:"2026-09-24",author:"browser-smoke"})).id;
    await attendancePage.locator("#classFilter").selectOption("");
    await attendancePage.getByRole("button",{name:"Month",exact:true}).click();
    await attendancePage.locator("#loading").waitFor({state:"hidden"});
    await attendancePage.locator(".plan-closure").first().waitFor();
    await attendancePage.locator(".plan-event").filter({hasText:"Holiday"}).first().waitFor();
    const preschoolCalendar=attendancePage.locator(".planner-class").filter({has:attendancePage.getByRole("heading",{name:"Preschool",exact:true})});
    if(await preschoolCalendar.locator(".plan-closure").count())throw new Error("Kinder closure leaked into Preschool");
    await attendancePage.getByRole("button",{name:/Kinder, Tuesday, 22 September/}).click();
    await attendancePage.locator("#overviewBack").waitFor();
    await attendancePage.reload();
    await attendancePage.locator("#overviewBack").click();
    await attendancePage.locator('[data-view="month"][aria-pressed="true"]').waitFor();
    if(await attendancePage.locator("#classFilter").inputValue()!=="")throw new Error("Overview did not restore all classes");
    if(await attendancePage.locator("#selectedDate").inputValue()!=="2026-09-22")throw new Error("Overview lost selected date");
    await attendancePage.locator("#eventsLink").click();
    await attendancePage.waitForURL("**/tools/calendar/?date=2026-09-22");
    await attendancePage.locator('.ev-title').filter({hasText:"Planning closure "+marker}).first().waitFor();
    await attendancePage.getByRole("link",{name:"Student Calendar — attendance & visits"}).click();
    await attendancePage.locator('[data-view="month"][aria-pressed="true"]').waitFor();
    await attendancePage.locator("#planner .month-grid").first().waitFor();
    if(await attendancePage.locator("#selectedDate").inputValue()!=="2026-09-22")throw new Error("Calendar position was not remembered");
    console.log("✓ calendar overview return, reload, remembered position, scoped closures, holidays and Events link");
    for(const width of [390,1280]){
      await attendancePage.setViewportSize({width,height:900});
      for(const view of ["day","week","month"]){
        await attendancePage.locator('[data-view="'+view+'"]').click();
        await attendancePage.locator("#loading").waitFor({state:"hidden"});
        if(await attendancePage.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error("Planner overflow at "+width);
        await attendancePage.screenshot({path:".wrangler/review/today-"+view+"-"+width+".png",fullPage:true});
      }
    }
    console.log("✓ date selection, class planning, makeup and trial bookings, arrival marks and all views");
  } finally {
    if(makeupId)await api("visits","DELETE",{id:makeupId});
    if(trialId)await api("visits","DELETE",{id:trialId});
    if(planningClosure)await api("event","DELETE",{id:planningClosure,author:"browser-smoke"});
    if(planningStudent)await api("students","DELETE",{id:planningStudent});
    await attendancePage.close();
  }
  const yearPage=await browser.newPage({viewport:{width:390,height:844}});
  await yearPage.addInitScript(token=>{localStorage.setItem("luana_token",token);localStorage.setItem("luana_name","browser-smoke");},token);
  await yearPage.goto(origin+"/tools/curriculum/");
  await yearPage.getByRole("combobox",{name:"School year",exact:true}).selectOption("2027");
  await yearPage.getByRole("heading",{name:"April 2027",exact:true}).waitFor();
  await yearPage.getByRole("heading",{name:"March 2028",exact:true}).waitFor();
  await yearPage.goto(origin+"/tools/today/");
  await yearPage.getByRole("combobox",{name:"School year",exact:true}).selectOption("2027");
  await yearPage.waitForFunction(()=>document.querySelector("#selectedDate").value==="2027-04-01");
  await yearPage.locator("#selectedDate").fill("2027-03-31");
  await yearPage.locator("#selectedDate").dispatchEvent("change");
  await yearPage.waitForFunction(()=>document.querySelector('[aria-label="School year"]').value==="2026");
  await yearPage.goto(origin+"/tools/calendar/");
  await yearPage.locator("#addBtn").click();
  await yearPage.locator("#fType").selectOption("closure");
  await yearPage.locator("#fEndDate").waitFor();
  if(await yearPage.locator("#repeatFields").isVisible())throw Error("Closures should use a date range");
  await yearPage.close();
  console.log("✓ April–March school-year controls and school-closure form");
  console.log("Browser smoke checks passed.");
} finally {
  if (browser) await browser.close();
  if (!server) { /* existing local preview remains running */ } else if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  } else {
    try { process.kill(-server.pid, "SIGTERM"); } catch { server.kill("SIGTERM"); }
  }
}
