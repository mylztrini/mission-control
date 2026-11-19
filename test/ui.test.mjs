// UI tests for Mission Control. The page is served locally and every API call is mocked.
// SYNTHETIC FIXTURE only — these tests must not call the live Supabase function or send commands.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { describe, it, before, after } from "node:test";
import { fixture, orgFixture, SYNTH_KEY } from "./synthetic-fixture.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const ARTIFACTS = fs.existsSync("/opt/cursor") ? "/opt/cursor/artifacts" : path.join(ROOT, "test/artifacts");
const CHROME = process.env.CHROME_PATH || "/usr/bin/google-chrome-stable";

function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith("/")) pathname += "index.html";
    const file = path.normalize(path.join(ROOT, pathname));
    if (!file.startsWith(ROOT)) {
      res.writeHead(403).end("forbidden");
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404).end("missing");
        return;
      }
      const types = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".mjs": "text/javascript; charset=utf-8",
        ".json": "application/json",
        ".png": "image/png",
        ".webmanifest": "application/manifest+json",
        ".txt": "text/plain"
      };
      res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream", "cache-control": "no-store" });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

function installMock(page, commands, leaked) {
  return page.setRequestInterception(true).then(() => {
    page.on("request", (req) => {
      const url = req.url();
      let host = "";
      try { host = new URL(url).host; } catch { /* data: and similar */ }
      const local = host.startsWith("127.0.0.1") || host.startsWith("localhost") || url.startsWith("data:");
      if (local) {
        req.continue().catch(() => {});
        return;
      }
      if (!host.endsWith("supabase.co")) {
        leaked.push(url);
        req.abort().catch(() => {});
        return;
      }
      const headers = {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "X-MC-Key, Content-Type, X-Mission-Control",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "cache-control": "no-store"
      };
      if (req.method() === "OPTIONS") {
        req.respond({ status: 204, headers }).catch(() => {});
        return;
      }
      const key = req.headers()["x-mc-key"] || "";
      if (key !== SYNTH_KEY) {
        req.respond({ status: 401, contentType: "application/json", headers, body: JSON.stringify({ error: "rejected synthetic test key" }) }).catch(() => {});
        return;
      }
      if (url.endsWith("/remove")) {
        commands.push({ url, method: req.method(), key, body: JSON.parse(req.postData() || "{}") });
        req.respond({ status: 200, contentType: "application/json", headers, body: JSON.stringify({ ok: true, added: true }) }).catch(() => {});
        return;
      }
      if (url.endsWith("/command")) {
        commands.push({ url, method: req.method(), key, body: JSON.parse(req.postData() || "{}") });
        req.respond({ status: 200, contentType: "application/json", headers, body: JSON.stringify({ ok: true }) }).catch(() => {});
        return;
      }
      const body = url.endsWith("/data") ? fixture
        : url.endsWith("/version") ? { version: fixture.version }
        : url.endsWith("/org") ? orgFixture
        : url.endsWith("/audio/meta") ? { label: "Synthetic audio label" }
        : null;
      if (!body) {
        req.respond({ status: 404, contentType: "application/json", headers, body: JSON.stringify({ error: "unmocked" }) }).catch(() => {});
        return;
      }
      req.respond({ status: 200, contentType: "application/json", headers, body: JSON.stringify(body) }).catch(() => {});
    });
  });
}

async function openPage(browser, commands, leaked) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument((key) => {
    localStorage.setItem("mcKey", key);
  }, SYNTH_KEY);
  await installMock(page, commands, leaked);
  return { context, page, errors };
}

async function ready(page) {
  await page.waitForFunction(() => {
    const node = document.querySelector("#wlist .txt");
    return node && node.textContent.includes("Synthetic task");
  }, { timeout: 15000 });
}

// Task-start positions measured on PR 2 head 204ab3d (stats collapsed, synthetic fixture).
const PR2_TASK_TOP = { desktop: 660, mobile: 601 };

async function metrics(page) {
  return page.evaluate(() => {
    const task = document.getElementById("wlist").closest("section").getBoundingClientRect();
    const shell = document.querySelector(".shell").getBoundingClientRect();
    const left = document.querySelector(".sh-left").getBoundingClientRect();
    const toggle = document.getElementById("vitalsToggle").getBoundingClientRect();
    const move = document.getElementById("oneMove").getBoundingClientRect();
    const board = document.getElementById("boardSec").getBoundingClientRect();
    const cards = [...document.querySelectorAll("#vitals .vital")].map((el) => el.getBoundingClientRect());
    const tabs = document.querySelector(".tabs");
    return {
      // v2: the money strip sits above the task list by design; layout checks measure the task top without it
      taskTop: task.top - ((document.getElementById("mstrip") || { offsetHeight: 0 }).offsetHeight + (document.getElementById("mstrip") ? 14 : 0)),
      taskTopRaw: task.top,
      shellW: shell.width,
      leftRight: left.right,
      leftLeft: left.left,
      toggleRight: toggle.right,
      toggleTop: toggle.top,
      // v2 follow-up: the one-move hero only shows for a live Asana ask; the synthetic base fixture has none, so measure from the greeting
      moveBottom: move.height ? move.bottom : document.getElementById("greet").getBoundingClientRect().bottom,
      boardTop: board.top,
      boardBottom: board.bottom,
      toggleW: toggle.width,
      toggleH: toggle.height,
      panelHidden: document.getElementById("vitals").hidden,
      expanded: document.getElementById("vitalsToggle").getAttribute("aria-expanded"),
      cards: cards.map((c) => ({ top: Math.round(c.top), left: Math.round(c.left), right: Math.round(c.right), h: Math.round(c.height) })),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      tabsClient: tabs.clientWidth,
      tabsScroll: tabs.scrollWidth,
      vh: window.innerHeight,
      vw: window.innerWidth
    };
  });
}

describe("Mission Control UI", { timeout: 120000 }, () => {
  let browser;
  let server;
  let base;

  before(async () => {
    const puppeteer = await import("puppeteer-core");
    server = await startServer();
    base = `http://127.0.0.1:${server.address().port}/`;
    browser = await puppeteer.default.launch({
      executablePath: CHROME,
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars"]
    });
  });

  after(async () => {
    if (browser) await browser.close();
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  it("ships exact site links, icons, and the privacy gates in source", () => {
    const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
    assert.match(html, /href="https:\/\/villas\.tobago\.ai"/);
    assert.match(html, /href="https:\/\/property\.tobago\.ai"/);
    assert.equal(html.includes("tobago.villas"), false);
    assert.match(html, /name="robots" content="noindex, nofollow, noarchive"/);
    assert.match(html, /name="referrer" content="no-referrer"/);
    assert.match(html, /api\("command"/);
    assert.match(html, /"X-MC-Key"/);
    assert.match(html, /post\(\{ key, action, note, keep_open \}\)/);
    assert.match(html, /post\(\{ key, action, note, keep_open: false \}\)/);
    assert.equal(html.includes(SYNTH_KEY), false);
    assert.match(html, /data-tab="cash"/);
    assert.match(html, /id="tabCash"/);
    assert.match(html, /D && D\.cash_forecast/);
    assert.equal(html.includes("520000"), false);
    assert.equal(html.includes("11111.11"), false);
    assert.equal(/023-\d{5}/.test(html), false);
    assert.equal(html.includes("docs.google.com/spreadsheets"), false);
    assert.match(html, /id="sheetsNav"/);
    assert.equal(html.includes("mcVitalsOpen"), true);
    assert.equal(html.includes("mcNetworthOpen"), true);
    assert.match(html, /id="blurMode"/);
    assert.match(html, /Blur mode/);
    assert.match(html, /aria-keyshortcuts="Shift\+B"/);
    assert.match(html, /mcBlurMode/);
    assert.match(html, /class="mc-sensitive"/);
    assert.match(html, /data-mc-sensitive/);
    assert.equal(html.includes('class="xbar"'), false);
    assert.equal(html.includes('id="toolsMenu"'), true);
  });

  it("collapses villa stats on a fresh visit, toggles from the keyboard, and remembers the choice", async () => {
    const commands = [];
    const leaked = [];
    const { context, page, errors } = await openPage(browser, commands, leaked);
    try {
      await page.goto(base, { waitUntil: "domcontentloaded", timeout: 20000 });
      await ready(page);
      assert.deepEqual(errors, []);
      assert.deepEqual(leaked, []);

      const fresh = await page.evaluate(() => ({
        expanded: document.getElementById("vitalsToggle").getAttribute("aria-expanded"),
        controls: document.getElementById("vitalsToggle").getAttribute("aria-controls"),
        hidden: document.getElementById("vitals").hidden,
        labelled: document.getElementById("vitals").getAttribute("aria-labelledby"),
        hint: document.getElementById("vitalsHint").textContent,
        count: document.getElementById("vitalsCount").textContent,
        stored: localStorage.getItem("mcVitalsOpen"),
        tag: document.getElementById("vitalsToggle").tagName
      }));
      assert.equal(fresh.tag, "BUTTON");
      assert.equal(fresh.expanded, "false");
      assert.equal(fresh.controls, "vitals");
      assert.equal(fresh.hidden, true);
      assert.equal(fresh.labelled, "vitalsToggleLabel");
      assert.equal(fresh.hint, "Show");
      assert.equal(fresh.count, "5");
      assert.equal(fresh.stored, null);

      const focusedWhileHidden = await page.evaluate(() => {
        const card = document.querySelector("#vitals .vital");
        card.focus();
        return document.getElementById("vitals").contains(document.activeElement);
      });
      assert.equal(focusedWhileHidden, false);

      await page.$eval("#vitalsToggle", (el) => el.focus());
      await page.keyboard.press("Enter");
      const opened = await page.evaluate(() => ({
        expanded: document.getElementById("vitalsToggle").getAttribute("aria-expanded"),
        hidden: document.getElementById("vitals").hidden,
        hint: document.getElementById("vitalsHint").textContent,
        stored: localStorage.getItem("mcVitalsOpen"),
        active: document.activeElement && document.activeElement.id,
        profit: !!document.querySelector('#vitals [role="button"] .vpill')
      }));
      assert.equal(opened.expanded, "true");
      assert.equal(opened.hidden, false);
      assert.equal(opened.hint, "Hide");
      assert.equal(opened.stored, "1");
      assert.equal(opened.active, "vitalsToggle");
      assert.equal(opened.profit, true);

      await page.reload({ waitUntil: "domcontentloaded" });
      await ready(page);
      assert.equal(await page.$eval("#vitalsToggle", (el) => el.getAttribute("aria-expanded")), "true");
      assert.equal(await page.evaluate(() => localStorage.getItem("mcVitalsOpen")), "1");

      await page.$eval("#vitalsToggle", (el) => el.focus());
      await page.keyboard.press("Space");
      const closed = await page.evaluate(() => ({
        expanded: document.getElementById("vitalsToggle").getAttribute("aria-expanded"),
        hidden: document.getElementById("vitals").hidden,
        hint: document.getElementById("vitalsHint").textContent,
        stored: localStorage.getItem("mcVitalsOpen")
      }));
      assert.equal(closed.expanded, "false");
      assert.equal(closed.hidden, true);
      assert.equal(closed.hint, "Show");
      assert.equal(closed.stored, "0");

      await page.reload({ waitUntil: "domcontentloaded" });
      await ready(page);
      assert.equal(await page.$eval("#vitalsToggle", (el) => el.getAttribute("aria-expanded")), "false");
      assert.equal(await page.evaluate(() => localStorage.getItem("mcVitalsOpen")), "0");

      await page.evaluate(() => localStorage.removeItem("mcVitalsOpen"));
      await page.reload({ waitUntil: "domcontentloaded" });
      await ready(page);
      assert.equal(await page.evaluate(() => localStorage.getItem("mcVitalsOpen")), null);
      assert.equal(await page.$eval("#vitals", (el) => el.hidden), true);
      assert.equal(commands.length, 0);
    } finally {
      await context.close();
    }
  });

  it("uses the exact navigation URLs and a cohesive icon on every nav item", async () => {
    const commands = [];
    const leaked = [];
    const { context, page } = await openPage(browser, commands, leaked);
    try {
      await page.goto(base, { waitUntil: "domcontentloaded", timeout: 20000 });
      await ready(page);
      const nav = await page.evaluate(() => {
        const link = (id) => {
          const el = document.getElementById(id);
          return {
            href: el.getAttribute("href"),
            rel: el.getAttribute("rel") || "",
            target: el.getAttribute("target") || "",
            icon: !!el.querySelector("svg.nav-ico"),
            label: el.querySelector(".pill-label").textContent
          };
        };
        const tabs = [...document.querySelectorAll(".tabs button[data-tab]")].map((el) => ({
          tab: el.dataset.tab,
          icon: !!el.querySelector("svg.nav-ico"),
          label: el.querySelector(".tab-label").textContent
        }));
        return {
          villas: link("villasSite"),
          property: link("propertySite"),
          daily: link("duLink"),
          brief: document.getElementById("aBtn").querySelector("svg.nav-ico") != null,
          phone: document.getElementById("phoneSetup").querySelector("svg.nav-ico") != null,
          tabs,
          robots: document.querySelector('meta[name="robots"]').content,
          referrer: document.querySelector('meta[name="referrer"]').content
        };
      });
      assert.equal(nav.villas.href, "https://villas.tobago.ai");
      assert.equal(nav.property.href, "https://property.tobago.ai");
      assert.match(nav.villas.rel, /noreferrer/);
      assert.match(nav.property.rel, /noreferrer/);
      assert.match(nav.villas.rel, /noopener/);
      assert.equal(nav.villas.target, "_blank");
      assert.equal(nav.property.target, "_blank");
      assert.equal(nav.villas.icon, true);
      assert.equal(nav.property.icon, true);
      assert.equal(nav.villas.label, "Villas site");
      assert.equal(nav.property.label, "Property site");
      assert.equal(nav.daily.href, "https://dailyupdate.simplyintense.com/");
      assert.equal(nav.daily.icon, true);
      assert.equal(nav.brief, true);
      assert.equal(nav.phone, true);
      assert.deepEqual(nav.tabs.map((t) => t.tab), ["today", "villas", "money", "cash", "ads", "growth", "helpdesk", "org", "activity", "routines"]);
      assert.equal(nav.tabs.every((t) => t.icon && t.label), true);
      assert.equal(nav.robots, "noindex, nofollow, noarchive");
      assert.equal(nav.referrer, "no-referrer");
      assert.equal(leaked.length, 0);
    } finally {
      await context.close();
    }
  });

  it("lays the collapsed stats above the tasks on desktop and mobile", async () => {
    const commands = [];
    const leaked = [];
    const { context, page, errors } = await openPage(browser, commands, leaked);
    try {
      await page.setViewport({ width: 1440, height: 900 });
      await page.goto(base, { waitUntil: "domcontentloaded", timeout: 20000 });
      await ready(page);
      const desktopClosed = await metrics(page);
      assert.equal(desktopClosed.panelHidden, true);
      assert.ok(desktopClosed.toggleW < desktopClosed.shellW * 0.75, `collapsed stats should stay in the left column (${desktopClosed.toggleW} vs shell ${desktopClosed.shellW})`);
      assert.ok(desktopClosed.toggleRight <= desktopClosed.leftRight + 2, `collapsed stats reach ${desktopClosed.toggleRight}, column ends ${desktopClosed.leftRight}`);
      assert.ok(desktopClosed.toggleTop >= desktopClosed.moveBottom - 2 && desktopClosed.toggleTop < desktopClosed.moveBottom + 40, `stats top ${desktopClosed.toggleTop} vs one move bottom ${desktopClosed.moveBottom}`);
      assert.ok(desktopClosed.toggleH <= 52, `collapsed disclosure is ${desktopClosed.toggleH}px tall`);
      assert.ok(desktopClosed.taskTop < desktopClosed.boardBottom - 20, `board still pushes tasks (${desktopClosed.taskTop} vs board bottom ${desktopClosed.boardBottom})`);
      assert.ok(desktopClosed.taskTop <= PR2_TASK_TOP.desktop - 80, `desktop tasks start at ${desktopClosed.taskTop}, previous PR2 was ${PR2_TASK_TOP.desktop}`);
      assert.ok(desktopClosed.overflow <= 1, `desktop overflow ${desktopClosed.overflow}`);

      await page.click("#vitalsToggle");
      const desktopOpen = await metrics(page);
      assert.equal(desktopOpen.panelHidden, false);
      assert.equal(desktopOpen.cards.length, 5);
      assert.ok(desktopOpen.cards.every((c) => c.right <= desktopOpen.leftRight + 2 && c.left >= desktopOpen.leftLeft - 2), `expanded stats leave the left column ${JSON.stringify(desktopOpen.cards)}`);
      assert.ok(desktopOpen.taskTop > desktopClosed.taskTop + 40, `tasks moved ${desktopOpen.taskTop - desktopClosed.taskTop}px`);

      await page.click("#vitalsToggle");
      await page.setViewport({ width: 390, height: 844 });
      const mobileClosed = await metrics(page);
      assert.equal(mobileClosed.panelHidden, true);
      assert.ok(mobileClosed.overflow <= 1, `mobile overflow ${mobileClosed.overflow}`);
      assert.ok(mobileClosed.tabsScroll > mobileClosed.tabsClient + 20, `tabs should scroll inside the row (${mobileClosed.tabsScroll} vs ${mobileClosed.tabsClient})`);
      assert.ok(mobileClosed.taskTop < mobileClosed.vh, `mobile tasks start at ${mobileClosed.taskTop} in ${mobileClosed.vh}`);
      assert.ok(mobileClosed.taskTop <= PR2_TASK_TOP.mobile + 8, `mobile tasks start at ${mobileClosed.taskTop}, previous PR2 was ${PR2_TASK_TOP.mobile}`);
      const mobileOrder = await page.evaluate(() => ({
        nav: document.querySelector(".mcnav").getBoundingClientRect().top,
        task: document.getElementById("wlist").closest("section").getBoundingClientRect().top,
        board: document.getElementById("boardSec").getBoundingClientRect().top
      }));
      assert.ok(mobileOrder.nav < 80, `nav should sit at the top, got ${mobileOrder.nav}`);
      assert.ok(mobileOrder.task < mobileOrder.board, `tasks ${mobileOrder.task} should come before the board ${mobileOrder.board}`);

      await page.click("#vitalsToggle");
      const mobileOpen = await metrics(page);
      assert.equal(mobileOpen.cards.length, 5);
      assert.ok(mobileOpen.cards[1].top > mobileOpen.cards[0].top + 40, `mobile cards should stack: ${JSON.stringify(mobileOpen.cards)}`);
      assert.ok(mobileOpen.taskTop > mobileClosed.taskTop + 80, `mobile tasks moved ${mobileOpen.taskTop - mobileClosed.taskTop}px`);
      assert.equal(errors.length, 0);
      assert.equal(leaked.length, 0);

      fs.mkdirSync(ARTIFACTS, { recursive: true });
      await page.evaluate(() => {
        const bar = document.createElement("div");
        bar.id = "syntheticBanner";
        bar.setAttribute("role", "note");
        bar.textContent = "SYNTHETIC FIXTURE — not live Mission Control data";
        bar.style.cssText = "position:sticky;top:0;z-index:80;background:#3a2a00;color:#ffe7a3;font:700 13px/1.3 Arial,sans-serif;text-align:center;padding:6px 10px";
        document.body.prepend(bar);
      });
      await page.screenshot({ path: path.join(ARTIFACTS, "layout_mobile_expanded.png") });
      await page.click("#vitalsToggle");
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: path.join(ARTIFACTS, "layout_mobile_collapsed.png") });
      await page.setViewport({ width: 1440, height: 900 });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: path.join(ARTIFACTS, "layout_desktop_collapsed.png") });
      await page.click("#vitalsToggle");
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: path.join(ARTIFACTS, "layout_desktop_expanded.png") });
    } finally {
      await context.close();
    }
  });

  it("keeps waiting and staff actions bound without sending a live command", async () => {
    const commands = [];
    const leaked = [];
    const { context, page, errors } = await openPage(browser, commands, leaked);
    try {
      await page.goto(base, { waitUntil: "domcontentloaded", timeout: 20000 });
      await ready(page);

      // headline = real asks (open Asana cards); the two synthetic Slack/email asks count as "other"
      assert.equal(await page.$eval("#statN", (el) => el.textContent), "0");
      assert.match(await page.$eval("#statS", (el) => el.textContent), /^real asks · 0 ready \(Top 10\) · 0 need a proper ask · 2 other/);
      assert.equal(await page.$eval("#oneMove", (el) => el.hidden), true, "no live Asana ask -> no hero (the brain's one move never drives it)");
      assert.equal(await page.$eval("#warn", (el) => el.hidden), true);
      const openHref = await page.$eval("#wlist a.btn.p", (el) => el.getAttribute("href"));
      assert.match(openHref, /^grokbot:\/\/app\/v1\/agent\?id=bot-sample/);
      const staffHref = await page.$eval("#slist a.btn.p", (el) => el.getAttribute("href"));
      assert.equal(staffHref, "https://example.invalid/task/202");
      assert.match(await page.$eval("#slist input.reply", (el) => el.placeholder), /Sample Staff/);
      assert.equal(await page.$eval("#slist button.chip", (el) => el.dataset.a), "Noted");

      const beforeBlur = commands.length;
      await page.evaluate(() => {
        const item = document.querySelector("#slist .item");
        item.querySelector("button[data-eye]").click();
      });
      assert.match(await page.$eval("#slist .item", (el) => el.className), /blur/);
      assert.equal(commands.length, beforeBlur);
      await page.evaluate(() => document.querySelector("#slist .item button[data-eye]").click());
      assert.doesNotMatch(await page.$eval("#slist .item", (el) => el.className), /blur/);

      await page.evaluate(() => {
        const item = [...document.querySelectorAll("#wlist .item")].find((el) => el.textContent.includes("Synthetic follow-up"));
        item.querySelector("button[data-ign]").click();
      });
      assert.equal(commands.length, beforeBlur);
      assert.equal(await page.evaluate(() => [...document.querySelectorAll("#wlist .item")].some((el) => el.textContent.includes("Synthetic follow-up"))), false);
      await page.click("#showIgn");
      assert.equal(await page.evaluate(() => [...document.querySelectorAll("#wlist .item")].some((el) => el.textContent.includes("Synthetic follow-up"))), true);
      assert.equal(commands.length, beforeBlur);

      await page.evaluate(() => {
        const item = [...document.querySelectorAll("#wlist .item")].find((el) => el.textContent.includes("Synthetic task"));
        item.querySelector('button.chip[data-a="Done"]').click();
      });
      await page.waitForFunction(() => [...document.querySelectorAll("#wlist .st")].some((el) => el.textContent.includes('Sent "Done" to JARVIS')));
      assert.equal(commands.length, 1);
      assert.equal(commands[0].method, "POST");
      assert.equal(commands[0].key, SYNTH_KEY);
      assert.match(commands[0].url, /\/functions\/v1\/mission-control\/command$/);
      assert.deepEqual(commands[0].body, { key: "synthetic-wait-1", action: "Done", note: "", keep_open: false });

      await page.evaluate(() => document.querySelector('#slist button.chip[data-a="Noted"]').click());
      await page.waitForFunction(() => [...document.querySelectorAll("#slist .st")].some((el) => el.textContent.includes("Noted")));
      assert.equal(commands.length, 2);
      assert.deepEqual(commands[1].body, { key: "synthetic-staff-1", action: "Noted", note: "", keep_open: false });

      await page.click("#vitalsToggle");
      await page.evaluate(() => document.querySelector('#vitals .vital[data-go="villas"]').click());
      assert.equal(await page.$eval("#tabVillas", (el) => el.hidden), false);
      assert.match(await page.$eval("#tabVillas", (el) => el.textContent), /Sample Nest/);
      assert.equal(await page.$eval("#tabToday", (el) => el.hidden), true);
      await page.click('.tabs button[data-tab="today"]');
      assert.equal(await page.$eval("#tabToday", (el) => el.hidden), false);
      assert.match(await page.$eval("#wlist", (el) => el.textContent), /Synthetic follow-up/);
      assert.equal(commands.length, 2);
      assert.equal(leaked.length, 0);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  it("uses one top navigation and keeps every destination working", async () => {
    const commands = [];
    const leaked = [];
    const { context, page, errors } = await openPage(browser, commands, leaked);
    try {
      await page.setViewport({ width: 1440, height: 900 });
      await page.goto(base, { waitUntil: "domcontentloaded", timeout: 20000 });
      await ready(page);
      const desk = await page.evaluate(() => {
        const bar = document.querySelector(".mcnav").getBoundingClientRect();
        const greet = document.querySelector(".greet").getBoundingClientRect();
        const menu = document.getElementById("toolsMenu").getBoundingClientRect();
        const site = document.getElementById("villasSite").getBoundingClientRect();
        const selected = [...document.querySelectorAll(".tabs button[data-tab]")].filter((b) => b.getAttribute("aria-selected") === "true").map((b) => b.dataset.tab);
        return {
          barTop: bar.top, barW: bar.width, greetTop: greet.top, shellW: document.querySelector(".shell").getBoundingClientRect().width,
          menuH: menu.height, siteW: site.width, toolsDisplay: getComputedStyle(document.getElementById("toolsBtn")).display,
          selected, xbar: document.querySelector(".xbar"),
          inNav: !!(document.querySelector(".mcnav #duLink") && document.querySelector(".mcnav .tabs"))
        };
      });
      assert.equal(desk.xbar, null);
      assert.equal(desk.inNav, true);
      assert.ok(desk.barTop < desk.greetTop, "navigation sits above the greeting");
      assert.ok(desk.barW > desk.shellW * 0.9);
      assert.ok(desk.menuH > 20 && desk.siteW > 20, "desktop tools are in the bar");
      assert.equal(desk.toolsDisplay, "none");
      assert.deepEqual(desk.selected, ["today"]);
      assert.ok((await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 1);

      for (const tab of ["villas", "money", "ads", "growth", "helpdesk", "org", "activity", "routines", "today"]) {
        await page.click(`.tabs button[data-tab="${tab}"]`);
        const on = await page.evaluate((name) => [...document.querySelectorAll(".tabs button[data-tab]")].filter((b) => b.getAttribute("aria-selected") === "true").map((b) => b.dataset.tab), tab);
        assert.deepEqual(on, [tab]);
      }
      assert.equal(await page.evaluate(() => localStorage.getItem("mcVitalsOpen")), null);

      await page.setViewport({ width: 390, height: 844 });
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const closed = await page.evaluate(() => ({
        open: document.querySelector(".mcnav").classList.contains("tools-open"),
        expanded: document.getElementById("toolsBtn").getAttribute("aria-expanded"),
        menu: getComputedStyle(document.getElementById("toolsMenu")).display
      }));
      assert.equal(closed.open, false);
      assert.equal(closed.expanded, "false");
      assert.equal(closed.menu, "none");
      await page.focus("#toolsBtn");
      await page.keyboard.press("Enter");
      const opened = await page.evaluate((key) => {
        const prop = document.getElementById("propertySite").getBoundingClientRect();
        const text = document.getElementById("toolsMenu").innerText;
        return {
          expanded: document.getElementById("toolsBtn").getAttribute("aria-expanded"),
          menu: getComputedStyle(document.getElementById("toolsMenu")).display,
          focusInMenu: document.getElementById("toolsMenu").contains(document.activeElement),
          propRight: prop.right,
          vw: window.innerWidth,
          leakedKey: text.includes(key),
          labels: ["duLink", "villasSite", "propertySite", "aBtn", "phoneSetup"].map((id) => document.getElementById(id).querySelector(".pill-label").textContent)
        };
      }, SYNTH_KEY);
      assert.equal(opened.expanded, "true");
      assert.equal(opened.menu, "flex");
      assert.equal(opened.focusInMenu, true);
      assert.ok(opened.propRight <= opened.vw - 4, `property link clipped at ${opened.propRight}`);
      assert.equal(opened.leakedKey, false);
      assert.deepEqual(opened.labels, ["Daily Update", "Villas site", "Property site", "Play the latest JARVIS brief", "Copy key for phone app"]);
      fs.mkdirSync(ARTIFACTS, { recursive: true });
      await page.evaluate(() => {
        if (document.getElementById("syntheticBanner")) return;
        const bar = document.createElement("div");
        bar.id = "syntheticBanner";
        bar.textContent = "SYNTHETIC FIXTURE — not live Mission Control data";
        bar.style.cssText = "position:sticky;top:0;z-index:80;background:#3a2a00;color:#ffe7a3;font:700 13px/1.3 Arial,sans-serif;text-align:center;padding:6px 10px";
        document.body.prepend(bar);
      });
      await page.screenshot({ path: path.join(ARTIFACTS, "followup_mobile_tools.png") });
      await page.click("#aBtn");
      await page.waitForFunction(() => document.getElementById("aLab").textContent.includes("Couldn't load"));
      await page.click("#phoneSetup");
      const phoneText = await page.$eval("#phoneSetup", (el) => el.innerText);
      assert.equal(phoneText.includes(SYNTH_KEY), false);
      await page.keyboard.press("Escape");
      assert.equal(await page.$eval("#toolsBtn", (el) => el.getAttribute("aria-expanded")), "false");
      assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), "toolsBtn");
      assert.equal(commands.length, 0);
      assert.equal(leaked.length, 0);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  it("fits every desktop tab, Blur mode, and Tools on screen at 1280px", async () => {
    const commands = [];
    const leaked = [];
    const { context, page, errors } = await openPage(browser, commands, leaked);
    try {
      await page.goto(base, { waitUntil: "domcontentloaded", timeout: 20000 });
      await ready(page);
      for (const width of [1280, 1366, 1440, 1920]) {
        await page.setViewport({ width, height: 900 });
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const fit = await page.evaluate(() => {
          const nav = document.querySelector(".mcnav");
          const row = document.querySelector(".mcnav-row");
          const box = nav.getBoundingClientRect();
          const fully = (el) => {
            const b = el.getBoundingClientRect();
            return b.width > 8 && b.left >= box.left - 1 && b.right <= box.right + 1 && b.top >= box.top - 1 && b.bottom <= box.bottom + 1;
          };
          const tabs = [...document.querySelectorAll(".tabs button[data-tab]")];
          const tools = ["duLink", "villasSite", "propertySite", "aBtn", "phoneSetup"].map((id) => document.getElementById(id));
          return {
            rowOver: row.scrollWidth - row.clientWidth,
            navOver: nav.scrollWidth - nav.clientWidth,
            pageOver: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            tabs: tabs.map((el) => el.querySelector(".tab-label").textContent),
            tabsIn: tabs.every(fully),
            blurIn: fully(document.getElementById("blurMode")),
            blurLabel: document.getElementById("blurMode").innerText,
            toolsIn: tools.every(fully),
            selected: tabs.filter((el) => el.getAttribute("aria-selected") === "true").map((el) => el.dataset.tab)
          };
        });
        assert.ok(fit.rowOver <= 1, `${width}px nav row scrolls by ${fit.rowOver}px`);
        assert.ok(fit.navOver <= 1, `${width}px nav scrolls by ${fit.navOver}px`);
        assert.ok(fit.pageOver <= 1, `${width}px page overflows by ${fit.pageOver}px`);
        assert.deepEqual(fit.tabs, ["Today", "Villas", "Money", "Cash", "Ads", "Growth", "Si Helpdesk", "Org & Systems", "Activity", "Routines"]);
        assert.equal(fit.tabsIn, true, `${width}px hides a tab`);
        assert.equal(fit.blurIn, true, `${width}px hides Blur mode`);
        assert.match(fit.blurLabel, /Blur mode/);
        assert.match(fit.blurLabel, /Shift\+B/);
        assert.equal(fit.toolsIn, true, `${width}px hides a Tools link`);
        assert.deepEqual(fit.selected, ["today"]);
      }
      fs.mkdirSync(ARTIFACTS, { recursive: true });
      const banner = () => page.evaluate(() => {
        if (document.getElementById("syntheticBanner")) return;
        const bar = document.createElement("div");
        bar.id = "syntheticBanner";
        bar.textContent = "SYNTHETIC FIXTURE — not live Mission Control data";
        bar.style.cssText = "position:sticky;top:0;z-index:80;background:#3a2a00;color:#ffe7a3;font:700 13px/1.3 Arial,sans-serif;text-align:center;padding:6px 10px";
        document.body.prepend(bar);
      });
      await page.setViewport({ width: 1280, height: 800 });
      await banner();
      await page.screenshot({ path: path.join(ARTIFACTS, "nav_1280_after.png") });
      await page.setViewport({ width: 1440, height: 800 });
      await page.screenshot({ path: path.join(ARTIFACTS, "nav_1440_after.png") });
      await page.setViewport({ width: 390, height: 844 });
      await page.screenshot({ path: path.join(ARTIFACTS, "nav_mobile_after.png") });
      assert.equal(commands.length, 0);
      assert.equal(leaked.length, 0);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  it("collapses net worth on a fresh visit without changing villa stats", async () => {
    const commands = [];
    const leaked = [];
    const { context, page, errors } = await openPage(browser, commands, leaked);
    try {
      await page.setViewport({ width: 1440, height: 900 });
      await page.goto(base, { waitUntil: "domcontentloaded", timeout: 20000 });
      await ready(page);
      await page.click('.tabs button[data-tab="money"]');
      await page.waitForSelector("#nwDisclosure");
      const fresh = await page.evaluate(() => ({
        expanded: document.getElementById("nwDisclosure").getAttribute("aria-expanded"),
        controls: document.getElementById("nwDisclosure").getAttribute("aria-controls"),
        hidden: document.getElementById("nwPanel").hidden,
        hint: document.getElementById("nwHint").textContent,
        stored: localStorage.getItem("mcNetworthOpen"),
        vitals: localStorage.getItem("mcVitalsOpen"),
        vitalsExpanded: document.getElementById("vitalsToggle").getAttribute("aria-expanded")
      }));
      assert.equal(fresh.expanded, "false");
      assert.equal(fresh.controls, "nwPanel");
      assert.equal(fresh.hidden, true);
      assert.equal(fresh.hint, "Show");
      assert.equal(fresh.stored, null);
      assert.equal(fresh.vitals, null);
      assert.equal(fresh.vitalsExpanded, "false");
      const focusedInside = await page.evaluate(() => {
        document.getElementById("nwTog").focus();
        return document.getElementById("nwPanel").contains(document.activeElement);
      });
      assert.equal(focusedInside, false);

      await page.focus("#nwDisclosure");
      await page.keyboard.press("Enter");
      const opened = await page.evaluate(() => ({
        expanded: document.getElementById("nwDisclosure").getAttribute("aria-expanded"),
        hidden: document.getElementById("nwPanel").hidden,
        hint: document.getElementById("nwHint").textContent,
        stored: localStorage.getItem("mcNetworthOpen"),
        note: document.getElementById("nwPanel").innerText.includes("Synthetic snapshot"),
        vitals: localStorage.getItem("mcVitalsOpen")
      }));
      assert.equal(opened.expanded, "true");
      assert.equal(opened.hidden, false);
      assert.equal(opened.hint, "Hide");
      assert.equal(opened.stored, "1");
      assert.equal(opened.note, true);
      assert.equal(opened.vitals, null);

      await page.reload({ waitUntil: "domcontentloaded" });
      await ready(page);
      await page.click('.tabs button[data-tab="money"]');
      await page.waitForSelector("#nwDisclosure");
      assert.equal(await page.$eval("#nwDisclosure", (el) => el.getAttribute("aria-expanded")), "true");
      assert.equal(await page.$eval("#vitalsToggle", (el) => el.getAttribute("aria-expanded")), "false");

      await page.click("#nwTog");
      await page.waitForFunction(() => document.getElementById("nwBox") && !document.getElementById("nwBox").classList.contains("blurred"));
      assert.equal(await page.$eval("#nwPanel", (el) => el.hidden), false);
      assert.equal(commands.length, 0);

      await page.focus("#nwDisclosure");
      await page.keyboard.press("Space");
      assert.equal(await page.evaluate(() => localStorage.getItem("mcNetworthOpen")), "0");
      assert.equal(await page.$eval("#nwPanel", (el) => el.hidden), true);
      await page.reload({ waitUntil: "domcontentloaded" });
      await ready(page);
      await page.click('.tabs button[data-tab="money"]');
      await page.waitForSelector("#nwPanel");
      assert.equal(await page.$eval("#nwPanel", (el) => el.hidden), true);

      fs.mkdirSync(ARTIFACTS, { recursive: true });
      await page.evaluate(() => {
        if (document.getElementById("syntheticBanner")) return;
        const bar = document.createElement("div");
        bar.id = "syntheticBanner";
        bar.textContent = "SYNTHETIC FIXTURE — not live Mission Control data";
        bar.style.cssText = "position:sticky;top:0;z-index:80;background:#3a2a00;color:#ffe7a3;font:700 13px/1.3 Arial,sans-serif;text-align:center;padding:6px 10px";
        document.body.prepend(bar);
      });
      await page.screenshot({ path: path.join(ARTIFACTS, "followup_networth_collapsed.png") });
      await page.click("#nwDisclosure");
      await page.screenshot({ path: path.join(ARTIFACTS, "followup_networth_expanded.png") });
      assert.equal(leaked.length, 0);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  it("toggles blur mode, remembers it, and masks sensitive values including net worth", async () => {
    const commands = [];
    const leaked = [];
    const { context, page, errors } = await openPage(browser, commands, leaked);
    const shot = async (name) => {
      fs.mkdirSync(ARTIFACTS, { recursive: true });
      await page.evaluate(() => {
        if (document.getElementById("syntheticBanner")) return;
        const bar = document.createElement("div");
        bar.id = "syntheticBanner";
        bar.setAttribute("role", "note");
        bar.textContent = "SYNTHETIC FIXTURE — not live Mission Control data";
        bar.style.cssText = "position:sticky;top:0;z-index:80;background:#3a2a00;color:#ffe7a3;font:700 13px/1.3 Arial,sans-serif;text-align:center;padding:6px 10px";
        document.body.prepend(bar);
      });
      await page.screenshot({ path: path.join(ARTIFACTS, name), fullPage: true });
    };
    const maskOf = (selector) => page.$eval(selector, (el) => {
      const after = getComputedStyle(el, "::after");
      return {
        cls: el.classList.contains("mc-sensitive"),
        kind: el.getAttribute("data-mc-sensitive"),
        color: getComputedStyle(el).color,
        after: after.content,
        filter: after.filter
      };
    });
    try {
      await page.setViewport({ width: 1440, height: 900 });
      await page.goto(base, { waitUntil: "domcontentloaded", timeout: 20000 });
      await ready(page);

      const fresh = await page.evaluate(() => ({
        pressed: document.getElementById("blurMode").getAttribute("aria-pressed"),
        state: document.getElementById("blurModeState").textContent,
        shortcut: document.getElementById("blurMode").getAttribute("aria-keyshortcuts"),
        label: document.getElementById("blurMode").innerText,
        body: document.body.classList.contains("mc-blur"),
        stored: localStorage.getItem("mcBlurMode"),
        vitals: localStorage.getItem("mcVitalsOpen"),
        net: localStorage.getItem("mcNetworthOpen")
      }));
      assert.equal(fresh.pressed, "false");
      assert.equal(fresh.state, "Off");
      assert.equal(fresh.shortcut, "Shift+B");
      assert.match(fresh.label, /Blur mode/);
      assert.match(fresh.label, /Shift\+B/);
      assert.equal(fresh.body, false);
      assert.equal(fresh.stored, null);
      assert.equal(fresh.vitals, null);
      assert.equal(fresh.net, null);

      assert.equal((await maskOf("#vitals .b")).cls, true);
      assert.equal((await maskOf("#vitals .b")).kind, "money");
      assert.equal((await maskOf("#wlist .txt")).cls, true);
      assert.equal((await maskOf("#wlist .txt")).kind, "text");
      assert.notEqual((await maskOf("#vitals .b")).color, "rgba(0, 0, 0, 0)");
      assert.equal((await maskOf("#vitals .b")).after, "none");
      const vitalLabel = await page.$eval("#vitals .s", (el) => getComputedStyle(el).color);
      assert.notEqual(vitalLabel, "rgba(0, 0, 0, 0)");

      await page.focus("#wlist input.reply");
      await page.keyboard.down("Shift");
      await page.keyboard.press("KeyB");
      await page.keyboard.up("Shift");
      assert.equal(await page.$eval("#blurMode", (el) => el.getAttribute("aria-pressed")), "false");
      await page.$eval("#wlist input.reply", (el) => el.blur());

      await page.click('.tabs button[data-tab="money"]');
      await page.waitForSelector("#nwDisclosure");
      const collapsed = await page.evaluate(() => ({
        expanded: document.getElementById("nwDisclosure").getAttribute("aria-expanded"),
        hidden: document.getElementById("nwPanel").hidden,
        hint: document.getElementById("nwHint").textContent,
        cls: document.getElementById("nwBox").querySelector(".val").classList.contains("mc-sensitive")
      }));
      assert.equal(collapsed.expanded, "false");
      assert.equal(collapsed.hidden, true);
      assert.equal(collapsed.hint, "Show");
      assert.equal(collapsed.cls, true);
      await shot("blur_desktop_networth_collapsed.png");

      await page.click("#blurMode");
      assert.equal(await page.$eval("#nwPanel", (el) => el.hidden), true, "blur mode must not expand net worth");
      await page.click("#blurMode");
      assert.equal(await page.$eval("#blurMode", (el) => el.getAttribute("aria-pressed")), "false");
      assert.equal(await page.$eval("#nwPanel", (el) => el.hidden), true);

      await page.click("#nwDisclosure");
      assert.equal(await page.$eval("#nwPanel", (el) => el.hidden), false);
      assert.equal(await page.evaluate(() => localStorage.getItem("mcNetworthOpen")), "1");
      await page.click("#nwTog");
      await page.waitForFunction(() => document.getElementById("nwBox") && !document.getElementById("nwBox").classList.contains("blurred"));
      const readable = await maskOf("#nwBox .val");
      assert.equal(readable.cls, true);
      assert.equal(readable.kind, "money");
      assert.notEqual(readable.color, "rgba(0, 0, 0, 0)");
      assert.match(await page.$eval("#nwPanel", (el) => el.innerText), /Synthetic snapshot/);
      assert.match(await page.$eval("#nwPanel", (el) => el.innerText), /123,456/);
      const owedLabel = await page.evaluate(() => getComputedStyle([...document.querySelectorAll("#tabMoney .kpi .s")].find((el) => el.textContent === "Owed")).color);
      assert.notEqual(owedLabel, "rgba(0, 0, 0, 0)");

      const detected = await page.evaluate(() => {
        const cap = [...document.querySelectorAll("#tabVillas p.cap")].find((el) => el.textContent.includes("TT$9,999"));
        const money = cap && [...cap.querySelectorAll("[data-mc-sensitive='money']")].find((el) => el.textContent === "TT$9,999");
        const email = [...document.querySelectorAll("#tabVillas [data-mc-sensitive='email']")].map((el) => el.textContent);
        const phone = [...document.querySelectorAll("#tabVillas [data-mc-sensitive='phone']")].map((el) => el.textContent);
        const guest = [...document.querySelectorAll("#tabVillas [data-mc-sensitive='name']")].some((el) => el.textContent.includes("Jamie Example"));
        const bar = document.querySelector("#tabVillas .ob .bar i").style.width;
        const client = [...document.querySelectorAll("#tabHelpdesk [data-mc-sensitive='name']")].some((el) => el.textContent.includes("Example Client"));
        const invoice = [...document.querySelectorAll("#tabMoney [data-mc-sensitive='id']")].some((el) => el.textContent.includes("INV-1001"));
        return { money: money && money.classList.contains("mc-sensitive"), email, phone, guest, bar, client, invoice };
      });
      assert.equal(detected.money, true);
      assert.ok(detected.email.includes("sample.guest@example.com"));
      assert.ok(detected.phone.some((p) => p.includes("555-0199")));
      assert.equal(detected.guest, true);
      assert.equal(detected.bar, "40%");
      assert.equal(detected.client, true);
      assert.equal(detected.invoice, true);

      await page.click('.tabs button[data-tab="today"]');
      await page.click("#vitalsToggle");
      await shot("blur_desktop_today_off.png");
      await page.click('.tabs button[data-tab="money"]');
      await page.evaluate(() => document.getElementById("nwSec").scrollIntoView());
      await shot("blur_desktop_money_off.png");

      await page.click("#blurMode");
      const on = await page.evaluate(() => ({
        pressed: document.getElementById("blurMode").getAttribute("aria-pressed"),
        state: document.getElementById("blurModeState").textContent,
        body: document.body.classList.contains("mc-blur"),
        stored: localStorage.getItem("mcBlurMode"),
        placeholder: document.querySelector("#slist input.reply").placeholder,
        title: document.querySelector("#tabVillas .ob .bar").getAttribute("aria-label"),
        vital: getComputedStyle(document.querySelector("#vitals .s")).color
      }));
      assert.equal(on.pressed, "true");
      assert.equal(on.state, "On");
      assert.equal(on.body, true);
      assert.equal(on.stored, "1");
      assert.equal(on.placeholder, "");
      assert.equal(on.title, "Hidden while blur mode is on");
      assert.notEqual(on.vital, "rgba(0, 0, 0, 0)");
      const hiddenWorth = await maskOf("#nwBox .val");
      assert.equal(hiddenWorth.color, "rgba(0, 0, 0, 0)");
      assert.notEqual(hiddenWorth.after, "none");
      assert.match(hiddenWorth.filter, /blur/);
      const hiddenVital = await maskOf("#vitals .b");
      assert.equal(hiddenVital.color, "rgba(0, 0, 0, 0)");
      assert.match(hiddenVital.filter, /blur/);
      const hiddenTask = await maskOf("#wlist .txt");
      assert.equal(hiddenTask.color, "rgba(0, 0, 0, 0)");
      assert.equal(await page.$eval("#nwDisclosureLabel", (el) => getComputedStyle(el).color) === "rgba(0, 0, 0, 0)", false);
      await shot("blur_desktop_money_on.png");
      await page.click('.tabs button[data-tab="today"]');
      await shot("blur_desktop_today_on.png");

      await page.reload({ waitUntil: "domcontentloaded" });
      await ready(page);
      assert.equal(await page.evaluate(() => localStorage.getItem("mcBlurMode")), "1");
      assert.equal(await page.$eval("#blurMode", (el) => el.getAttribute("aria-pressed")), "true");
      assert.equal(await page.evaluate(() => document.body.classList.contains("mc-blur")), true);
      assert.equal((await maskOf("#vitals .b")).color, "rgba(0, 0, 0, 0)");
      assert.equal(await page.$eval("#nwPanel", (el) => el.hidden), false);
      assert.equal(await page.evaluate(() => localStorage.getItem("mcVitalsOpen")), "1");

      await page.keyboard.down("Shift");
      await page.keyboard.press("KeyB");
      await page.keyboard.up("Shift");
      const off = await page.evaluate(() => ({
        pressed: document.getElementById("blurMode").getAttribute("aria-pressed"),
        state: document.getElementById("blurModeState").textContent,
        body: document.body.classList.contains("mc-blur"),
        stored: localStorage.getItem("mcBlurMode"),
        placeholder: document.querySelector("#slist input.reply").placeholder
      }));
      assert.equal(off.pressed, "false");
      assert.equal(off.state, "Off");
      assert.equal(off.body, false);
      assert.equal(off.stored, "0");
      assert.match(off.placeholder, /Sample Staff/);
      assert.notEqual((await maskOf("#nwBox .val")).color, "rgba(0, 0, 0, 0)");
      assert.equal((await maskOf("#vitals .b")).after, "none");

      await page.reload({ waitUntil: "domcontentloaded" });
      await ready(page);
      assert.equal(await page.evaluate(() => localStorage.getItem("mcBlurMode")), "0");
      assert.equal(await page.$eval("#blurMode", (el) => el.getAttribute("aria-pressed")), "false");
      assert.equal(await page.evaluate(() => document.body.classList.contains("mc-blur")), false);

      await page.setViewport({ width: 390, height: 844 });
      await page.click('.tabs button[data-tab="today"]');
      await shot("blur_mobile_today_off.png");
      await page.click('.tabs button[data-tab="money"]');
      if (await page.$eval("#nwBox", (el) => el.classList.contains("blurred"))) {
        await page.click("#nwTog");
        await page.waitForFunction(() => !document.getElementById("nwBox").classList.contains("blurred"));
      }
      await page.evaluate(() => document.getElementById("nwSec").scrollIntoView());
      await shot("blur_mobile_money_off.png");
      await page.click("#blurMode");
      assert.equal(await page.$eval("#blurModeState", (el) => el.textContent), "On");
      assert.equal((await maskOf("#nwBox .val")).color, "rgba(0, 0, 0, 0)");
      await shot("blur_mobile_money_on.png");
      await page.click('.tabs button[data-tab="today"]');
      await shot("blur_mobile_today_on.png");

      assert.equal(commands.length, 0);
      assert.equal(leaked.length, 0);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  it("shows a compact Agency overdue table instead of a huge repeated headline", async () => {
    const commands = [];
    const leaked = [];
    const { context, page, errors } = await openPage(browser, commands, leaked);
    try {
      await page.setViewport({ width: 390, height: 844 });
      await page.goto(base, { waitUntil: "domcontentloaded", timeout: 20000 });
      await ready(page);
      await page.click("#vitalsToggle");
      const info = await page.evaluate(() => {
        const card = document.querySelector("#vitals .ag-od-card");
        if (!card) return { missing: true };
        const rows = [...card.querySelectorAll("tbody tr")].map((tr) => [...tr.children].map((td) => td.textContent.trim()));
        const headline = card.querySelector(".b");
        const src = (card.querySelector(".ag-od-src") || {}).textContent || "";
        const od = card.querySelector("td.od");
        const color = od ? getComputedStyle(od).color : "";
        return {
          rows,
          hasBigHeadline: !!(headline && headline.textContent.includes("SIMCL TT$1,234.00 · SiBB")),
          src,
          odColor: color,
          odSize: od ? parseFloat(getComputedStyle(od).fontSize) : 0,
          overflow: card.scrollWidth - card.clientWidth,
          wrap: od ? getComputedStyle(od).whiteSpace : ""
        };
      });
      assert.equal(info.missing, undefined);
      assert.deepEqual(info.rows, [
        ["SIMCL", "TT$1,234.00", "TT$9,000.00"],
        ["SiBB", "BDS$2,345.00", "BDS$8,000.00"],
        ["SI CY", "US$3,456.00", "US$3,456.00"]
      ]);
      assert.equal(info.hasBigHeadline, false);
      assert.match(info.src, /Cashbot/);
      assert.match(info.src, /5:46 PM AST/);
      assert.equal(info.wrap, "nowrap");
      assert.ok(info.odSize > 12 && info.odSize < 26, `overdue font ${info.odSize}px should be normal-ish, not 30px`);
      assert.ok(info.overflow <= 1, `agency overdue card overflows by ${info.overflow}px`);
      assert.equal(commands.length, 0);
      assert.equal(leaked.length, 0);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  it("renders the Ads tab from ads_weekly without inventing $0 weeks", async () => {
    const commands = [];
    const leaked = [];
    const { context, page, errors } = await openPage(browser, commands, leaked);
    try {
      await page.goto(base, { waitUntil: "domcontentloaded", timeout: 20000 });
      await ready(page);
      await page.click('.tabs button[data-tab="ads"]');
      const info = await page.evaluate(() => {
        const pane = document.getElementById("tabAds");
        const selected = [...document.querySelectorAll(".tabs button[data-tab]")].filter((b) => b.getAttribute("aria-selected") === "true").map((b) => b.dataset.tab);
        const combined = (pane.querySelector(".kpi .b") || {}).textContent || "";
        const headers = [...pane.querySelectorAll("thead th")].map((th) => th.textContent.trim());
        const rows = [...pane.querySelectorAll("tbody tr")].map((tr) => [...tr.children].map((td) => td.textContent.trim()));
        const notes = [...pane.querySelectorAll(".ads-notes li")].map((li) => li.textContent);
        const bars = pane.querySelectorAll(".ads-bar .col").length;
        const zeros = [...pane.querySelectorAll("td")].filter((td) => td.textContent.trim() === "$0.00").length;
        return { selected, combined, headers, rows, notes, bars, zeros, text: pane.innerText };
      });
      assert.deepEqual(info.selected, ["ads"]);
      assert.equal(info.combined, "$150.00");
      assert.ok(info.headers.includes("Meta · Sample Account"));
      assert.ok(info.headers.includes("Google · Sample Google"));
      // Oct 26 week has Meta only; Google cell must be an en dash, not $0.00
      const week1 = info.rows.find((r) => r[0].includes("Oct 26") || r[0].includes("Oct 26–Nov") || r[0].includes("26–1") || /Oct/.test(r[0]) && /26/.test(r[0]));
      assert.ok(week1, `missing Oct 26 week in ${JSON.stringify(info.rows)}`);
      assert.equal(info.zeros, 0);
      assert.ok(week1.includes("–") || week1.includes("—"));
      assert.equal(info.bars, 2);
      assert.ok(info.notes.some((n) => /miles@simplyintense.com/.test(n)));
      assert.ok(info.notes.some((n) => /Shell 508694935/.test(n)));
      assert.ok(info.notes.some((n) => /Time in UTC/.test(n)));
      assert.ok(info.notes.some((n) => /Not yet pulled/.test(n)));
      assert.equal(commands.length, 0);
      assert.equal(leaked.length, 0);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  it("renders the Cash tab from cash_forecast without shipping figures in public HTML", async () => {
    const commands = [];
    const leaked = [];
    const { context, page, errors } = await openPage(browser, commands, leaked);
    try {
      const source = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
      assert.equal(source.includes("TT$520,000"), false);
      assert.equal(source.includes("11111.11"), false);
      assert.equal(/net-?worth/i.test(source) && source.includes("cash_forecast") ? /#tabCash[\s\S]{0,800}net-?worth/i.test(source) : false, false);

      await page.goto(base, { waitUntil: "domcontentloaded", timeout: 20000 });
      await ready(page);
      await page.click('.tabs button[data-tab="cash"]');
      const info = await page.evaluate(() => {
        const pane = document.getElementById("tabCash");
        const selected = [...document.querySelectorAll(".tabs button[data-tab]")].filter((b) => b.getAttribute("aria-selected") === "true").map((b) => b.dataset.tab);
        const text = pane.innerText;
        const headers = [...pane.querySelectorAll("thead th")].map((th) => th.textContent.trim());
        const rows = [...pane.querySelectorAll(".cash-tbl tbody tr")].map((tr) => [...tr.children].map((td) => td.innerText.replace(/\s+/g, " ").trim()));
        const bands = [...pane.querySelectorAll(".bands li")].map((li) => li.textContent);
        const kpis = [...pane.querySelectorAll(".cash-kpis .kpi")].map((el) => ({ s: el.querySelector(".s")?.textContent, b: el.querySelector(".b")?.innerText.trim() }));
        const svg = pane.querySelector("svg.cash-chart");
        const lines = svg ? svg.querySelectorAll("polyline").length : 0;
        const money = [...pane.querySelectorAll("[data-mc-sensitive='money']")].map((el) => el.textContent);
        const overflow = pane.scrollWidth - pane.clientWidth;
        return { selected, text, headers, rows, bands, kpis, lines, money, overflow, hasNetWorth: /net\s*worth/i.test(text) };
      });
      assert.deepEqual(info.selected, ["cash"]);
      assert.equal(info.hasNetWorth, false);
      assert.ok(info.kpis.some((k) => k.s === "Status" && /GREEN/i.test(k.b)));
      assert.ok(info.kpis.some((k) => k.s === "Usable cash" && k.b.includes("TT$520,000")));
      assert.ok(info.kpis.some((k) => k.s === "Plan (at last balances)" && k.b.includes("TT$410,000")));
      assert.match(info.text, /above the plan/);
      assert.ok(info.bands.some((b) => /Green/i.test(b) && /450,000/.test(b)));
      assert.ok(info.bands.some((b) => /Amber/i.test(b)));
      assert.ok(info.bands.some((b) => /Red/i.test(b)));
      assert.ok(info.bands.some((b) => /Critical/i.test(b)));
      assert.ok(info.headers.some((h) => /Plan closing/i.test(h)));
      assert.ok(info.headers.some((h) => /Actual closing/i.test(h)));
      assert.ok(info.headers.some((h) => /^Variance$/i.test(h)));
      assert.ok(info.headers.some((h) => /MODELLED/i.test(h) && /expected bookings/i.test(h)));
      assert.ok(info.headers.some((h) => /MODELLED/i.test(h) && /current bookings only/i.test(h)));
      assert.equal(info.rows.length, 7);
      assert.ok(info.rows.every((r) => /Oct|Nov|Dec|Jan|Feb|Mar|Apr/.test(r[0])));
      const oct = info.rows.find((r) => /Oct/.test(r[0]));
      assert.ok(oct, `missing October row in ${JSON.stringify(info.rows)}`);
      assert.match(oct[0], /Actual/i);
      assert.match(oct[1], /TT\$410,000/);
      assert.match(oct[2], /TT\$520,000/);
      assert.match(oct[3], /\+TT\$110,000/);
      const apr = info.rows.find((r) => /Apr/.test(r[0]));
      assert.ok(apr, `missing April row in ${JSON.stringify(info.rows)}`);
      assert.match(apr[1], /TT\$240,000/);
      assert.match(apr[1], /RED/i);
      assert.match(apr[2], /–|—|-/);
      assert.equal(/TT\$0\b/.test(apr[2]), false);
      assert.match(apr[3], /–|—|-/);
      assert.match(apr[4], /TT\$410,000/);
      assert.match(apr[4], /MODELLED/);
      assert.match(apr[5], /TT\$200,000/);
      assert.match(apr[5], /MODELLED/);
      assert.ok(info.lines >= 3, `expected plan + two modelled lines, got ${info.lines}`);
      assert.match(info.text, /Fixed deposits never count as usable cash/i);
      assert.match(info.text, /US\$12,000/);
      assert.match(info.text, /TT\$65,000/);
      assert.match(info.text, /NIB Inv 45221/);
      assert.match(info.text, /TT\$11,111\.11/);
      assert.match(info.text, /22 Nov 2026|Nov 22, 2026/);
      assert.match(info.text, /Sample April gap/);
      assert.match(info.text, /2\.1 months/);
      assert.match(info.text, /Monthly Balances Input/);
      assert.match(info.text, /Oct 31, 2026|31 Oct 2026/);
      assert.ok(info.money.includes("TT$520,000"));
      assert.equal(commands.length, 0);
      assert.equal(leaked.length, 0);
      assert.deepEqual(errors, []);

      await page.setViewport({ width: 390, height: 844 });
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const mobile = await page.evaluate(() => {
        const pane = document.getElementById("tabCash");
        const nav = document.querySelector(".mcnav");
        return {
          paneOver: pane.scrollWidth - pane.clientWidth,
          navTop: nav.getBoundingClientRect().top,
          pageOver: document.documentElement.scrollWidth - document.documentElement.clientWidth
        };
      });
      assert.ok(mobile.navTop < 80, `nav should sit at the top, got ${mobile.navTop}`);
      assert.ok(mobile.pageOver <= 1, `390px page overflows by ${mobile.pageOver}px`);
    } finally {
      await context.close();
    }
  });

  it("renders Sheets links from the keyed payload without putting URLs in public HTML", async () => {
    const commands = [];
    const leaked = [];
    const { context, page, errors } = await openPage(browser, commands, leaked);
    try {
      const source = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
      assert.equal(source.includes("docs.google.com/spreadsheets"), false);
      await page.goto(base, { waitUntil: "domcontentloaded", timeout: 20000 });
      await ready(page);
      const nav = await page.evaluate(() => {
        const host = document.getElementById("sheetsNav");
        const summary = host && host.querySelector("summary");
        return { hidden: host ? host.hidden : true, summary: summary ? summary.innerText.trim() : "" };
      });
      assert.equal(nav.hidden, false);
      assert.match(nav.summary, /Sheets/i);
      await page.click("#sheetsNav summary");
      const open = await page.evaluate(() => {
        const host = document.getElementById("sheetsNav");
        const links = [...(host ? host.querySelectorAll("a") : [])].map((a) => ({ href: a.getAttribute("href"), text: a.innerText.replace(/\s+/g, " ").trim() }));
        return { open: !!host.querySelector("details[open]"), links };
      });
      assert.equal(open.open, true);
      assert.deepEqual(open.links.map((l) => l.href), [
        "https://example.invalid/sheets/si-payables",
        "https://example.invalid/sheets/rt-payables",
        "https://example.invalid/sheets/cashplan"
      ]);
      assert.ok(open.links.some((l) => /Si Payables/i.test(l.text)));
      assert.ok(open.links.some((l) => /RT Payables/i.test(l.text)));
      assert.ok(open.links.some((l) => /Cashplan/i.test(l.text) && /updated/i.test(l.text) && /Nov 11, 2026, 12:11 AM AST/.test(l.text)));

      await page.click('.tabs button[data-tab="money"]');
      const money = await page.evaluate(() => [...document.querySelectorAll("#tabMoney .sheets-row a")].map((a) => ({ href: a.getAttribute("href"), text: a.innerText.replace(/\s+/g, " ").trim() })));
      assert.equal(money.length, 3);
      assert.ok(money.some((l) => l.href.includes("cashplan") && /updated Wed, Nov 11, 2026, 12:11 AM AST/.test(l.text)));

      await page.click('.tabs button[data-tab="cash"]');
      const cash = await page.evaluate(() => [...document.querySelectorAll("#tabCash .sheets-row a")].map((a) => ({ href: a.getAttribute("href"), text: a.innerText.replace(/\s+/g, " ").trim() })));
      assert.equal(cash.length, 3);
      assert.ok(cash.some((l) => /Si Payables/.test(l.text)));
      assert.equal(commands.length, 0);
      assert.equal(leaked.length, 0);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  it("renders rebased MODELLED columns from the new cash forecast schema", async () => {
    const commands = [];
    const leaked = [];
    const { context, page, errors } = await openPage(browser, commands, leaked);
    try {
      await page.goto(base, { waitUntil: "domcontentloaded", timeout: 20000 });
      await ready(page);
      await page.evaluate(() => {
        D.cash_forecast = {
          as_of: "2026-11-10",
          latest_balances_date: "2026-11-10",
          fx_basis: "Balances at 6.78. Plan at 7.5.",
          bands_ttd_usable: { GREEN: ">450000", AMBER: "300000-450000", RED: "175000-300000", CRITICAL: "<175000", basis: "usable cash, fixed deposits excluded" },
          current_position: {
            date: "2026-11-10",
            usable_cash: 500000,
            status: "GREEN",
            plan_usable_oct: 450000,
            variance_vs_plan: 150000,
            notes: ["Mid-month. Synthetic only."],
            last_month_end: { date: "2026-10-29", usable_cash: 600000, status: "GREEN", plan_usable: 450000, variance: 150000 }
          },
          months: [
            { month: "2026-10", label: "Oct-26", plan: { closing_usable: 450000, status: "AMBER" }, rebased: { label: "MODELLED", closing_usable: 600000, status: "GREEN" } },
            { month: "2026-11", label: "Nov-26", plan: { closing_usable: 454000, status: "GREEN" }, rebased: { label: "MODELLED", closing_usable: 613000, status: "GREEN" } },
            { month: "2026-12", label: "Dec-26", plan: { closing_usable: 536000, status: "GREEN" }, rebased: { label: "MODELLED", closing_usable: 696000, status: "GREEN" } },
            { month: "2027-01", label: "Jan-27", plan: { closing_usable: 452000, status: "GREEN" }, rebased: { label: "MODELLED", closing_usable: 611000, status: "GREEN" } },
            { month: "2027-02", label: "Feb-27", plan: { closing_usable: 436000, status: "AMBER" }, rebased: { label: "MODELLED", closing_usable: 596000, status: "GREEN" } },
            { month: "2027-03", label: "Mar-27", plan: { closing_usable: 378000, status: "AMBER" }, rebased: { label: "MODELLED", closing_usable: 537000, status: "GREEN" } },
            { month: "2027-04", label: "Apr-27", plan: { closing_usable: 299000, status: "RED" }, rebased: { label: "MODELLED", closing_usable: 458000, status: "GREEN" } }
          ],
          fixed_deposit_line: { label: "Not usable.", total_usd: 12000, total_ttd: 80000, cards_they_secure_ttd: 15000, net_freed_if_those_cards_paid_ttd: 65000 },
          upside_items: [{ item: "NIB Inv 45221", ttd: 11111.11, due: "2026-11-22", status: "Synthetic upside only." }],
          risks: [{ risk: "Receivable timing", detail: "TTPCU invoice just sent.", severity: "LOW" }],
          assumptions: ["Rebased path = plan closing + October gap; MODELLED."],
          protective_lens: { buffer_months: 2.1, buffer_months_all_unpledged: 2.4, household_only_buffer_months: 1.3, rungs_ttd: { "3_months": 445000 }, rung_status: "Below 3-month rung: all surplus to buffer", casa: { usd: 10000, usd_rate: "8%", ttd: 20000, ttd_rate: "7.5%" } },
          refresh_cadence: [{ what: "Agency receivables", source: "Cashbot" }]
        };
        renderCash();
      });
      await page.click('.tabs button[data-tab="cash"]');
      const info = await page.evaluate(() => {
        const pane = document.getElementById("tabCash");
        const headers = [...pane.querySelectorAll(".cash-tbl thead th")].map((th) => th.textContent.trim());
        const rows = [...pane.querySelectorAll(".cash-tbl tbody tr")].map((tr) => [...tr.children].map((td) => td.innerText.replace(/\s+/g, " ").trim()));
        const text = pane.innerText;
        const lines = pane.querySelectorAll("svg.cash-chart polyline").length;
        const nullCells = [...pane.querySelectorAll(".cash-tbl td")].filter((td) => /null/i.test(td.textContent)).length;
        return { headers, rows, text, lines, nullCells };
      });
      assert.deepEqual(info.headers, ["Month", "Plan closing", "Actual closing", "Variance", "Rebased (MODELLED)"]);
      assert.equal(info.rows.length, 7);
      assert.ok(info.rows[0][0].includes("Oct"));
      assert.match(info.rows[0][1], /TT\$450,000/);
      const nov = info.rows.find((r) => /Nov/.test(r[0]));
      assert.match(nov[1], /TT\$454,000/);
      assert.match(nov[1], /GREEN/i);
      assert.match(nov[2], /–|—|-/);
      assert.match(nov[4], /TT\$613,000/);
      assert.match(nov[4], /MODELLED/);
      const apr = info.rows.find((r) => /Apr/.test(r[0]));
      assert.match(apr[1], /TT\$299,000/);
      assert.match(apr[1], /RED/i);
      assert.match(apr[4], /TT\$458,000/);
      assert.match(apr[4], /GREEN/i);
      assert.match(apr[4], /MODELLED/);
      assert.equal(info.nullCells, 0);
      assert.ok(info.lines >= 2, `expected plan + rebased lines, got ${info.lines}`);
      assert.match(info.text, /TT\$500,000/);
      assert.match(info.text, /Last month-end/i);
      assert.match(info.text, /NIB Inv 45221/);
      assert.match(info.text, /Agency receivables/);
      assert.match(info.text, /Cashbot/);
      assert.match(info.text, /TTPCU/);
      assert.equal(/null/i.test(info.text), false);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  it("shows trailing months, current month-to-date, and leaves missing actuals blank", async () => {
    const commands = [];
    const leaked = [];
    const { context, page, errors } = await openPage(browser, commands, leaked);
    try {
      await page.goto(base, { waitUntil: "domcontentloaded", timeout: 20000 });
      await ready(page);
      await page.evaluate(() => {
        D.cash_forecast = {
          as_of: "2026-11-10",
          latest_balances_date: "2026-11-10",
          bands_ttd_usable: { GREEN: ">450000", AMBER: "300000-450000", RED: "175000-300000", CRITICAL: "<175000", basis: "usable cash, fixed deposits excluded" },
          current_position: {
            date: "2026-11-10",
            usable_cash: 646000,
            status: "GREEN",
            last_month_end: { date: "2026-10-29", usable_cash: 770000, status: "GREEN", plan_usable: 610000, variance: 160000 }
          },
          months: [
            { month: "2026-08", label: "Aug-26", plan: { closing_usable: 400000, status: "AMBER" }, latest_actual: null, rebased: { label: "MODELLED", closing_usable: 400000, status: "AMBER" } },
            { month: "2026-09", label: "Sep-26", plan: { closing_usable: 420000, status: "AMBER" }, latest_actual: null, rebased: { label: "MODELLED", closing_usable: 420000, status: "AMBER" } },
            { month: "2026-10", label: "Oct-26", plan: { closing_usable: 610000, status: "GREEN" }, latest_actual: { closing_usable: 770000, status: "GREEN", variance_vs_plan: 160000, balance_date: "2026-10-29", kind: "month_end" }, rebased: { label: "MODELLED", closing_usable: 770000, status: "GREEN" } },
            { month: "2026-11", label: "Nov-26", plan: { closing_usable: 460000, status: "GREEN" }, latest_actual: { closing_usable: 646000, status: "GREEN", variance_vs_plan: 186000, balance_date: "2026-11-10", kind: "mid_month" }, rebased: { label: "MODELLED", closing_usable: 620000, status: "GREEN" } },
            { month: "2026-12", label: "Dec-26", plan: { closing_usable: 500000, status: "GREEN" }, latest_actual: null, rebased: { label: "MODELLED", closing_usable: 660000, status: "GREEN" } }
          ]
        };
        renderCash();
      });
      await page.click('.tabs button[data-tab="cash"]');
      const info = await page.evaluate(() => {
        const pane = document.getElementById("tabCash");
        const headers = [...pane.querySelectorAll(".cash-tbl thead th")].map((th) => th.textContent.trim());
        const rows = [...pane.querySelectorAll(".cash-tbl tbody tr")].map((tr) => [...tr.children].map((td) => td.innerText.replace(/\s+/g, " ").trim()));
        const text = pane.innerText;
        const legend = [...pane.querySelectorAll(".cash-legend li")].map((li) => li.textContent);
        const midDots = pane.querySelectorAll("svg.cash-chart circle[fill='none']").length;
        const zeroActuals = rows.filter((r) => /^TT\$0\b/.test(r[2]) || r[2] === "TT$0").length;
        return { headers, rows, text, legend, midDots, zeroActuals };
      });
      assert.deepEqual(info.headers, ["Month", "Plan closing", "Actual closing", "Variance", "Rebased (MODELLED)"]);
      assert.equal(info.rows.length, 5);
      assert.ok(info.rows[0][0].includes("Aug"));
      assert.ok(info.rows[1][0].includes("Sep"));
      assert.ok(info.rows[2][0].includes("Oct"));
      assert.ok(info.rows[3][0].includes("Nov"));
      assert.ok(info.rows[4][0].includes("Dec"));
      assert.match(info.rows[0][2], /–|—|-/);
      assert.match(info.rows[1][2], /–|—|-/);
      assert.equal(info.zeroActuals, 0);
      assert.match(info.rows[2][0], /Actual/i);
      assert.match(info.rows[2][1], /TT\$610,000/);
      assert.match(info.rows[2][2], /TT\$770,000/);
      assert.match(info.rows[2][3], /\+TT\$160,000/);
      assert.match(info.rows[3][0], /month-to-date/i);
      assert.match(info.rows[3][2], /TT\$646,000/);
      assert.match(info.rows[3][3], /\+TT\$186,000/);
      assert.match(info.rows[3][3], /MTD/i);
      assert.match(info.rows[3][4], /TT\$620,000/);
      assert.match(info.rows[3][4], /MODELLED/);
      assert.match(info.rows[4][2], /–|—|-/);
      assert.match(info.text, /Plan vs actual vs modelled/i);
      assert.ok(info.legend.some((l) => /Actual \(month-end\)/i.test(l)));
      assert.ok(info.legend.some((l) => /month-to-date/i.test(l)));
      assert.ok(info.legend.some((l) => /Plan/i.test(l)));
      assert.ok(info.legend.some((l) => /MODELLED/i.test(l)));
      assert.ok(info.midDots >= 1, "expected an open month-to-date marker on the chart");
      assert.equal(commands.length, 0);
      assert.equal(leaked.length, 0);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
  it("shows hold/parked/assigned badges, keeps them out of the waiting count, and finds archived items by ID", async () => {
    const saved = { waiting: fixture.waiting, decisions: fixture.decisions, archive: fixture.archive, done: fixture.done };
    fixture.waiting = [
      ...saved.waiting.map((w) => ({ ...w })),
      { key: "synthetic-wait-hold", bot: "Sample Bot", botId: "bot-sample", when: "1d", text: "Synthetic held item.", stale: false, number: 166, actions: ["Later"], card: null,
        hold: { decision: "hold", note: "on hold", by: "Sample voice", at: "2026-11-11T13:31:23Z" } },
      { key: "synthetic-wait-park", bot: "Sample Bot", botId: "bot-sample", when: "1d", text: "Synthetic parked item.", stale: false, number: 178, actions: ["Later"], card: null,
        hold: { decision: "parked", note: "later this week", by: "Sample voice", at: "2026-11-11T13:31:41Z" } },
      { key: "synthetic-wait-assigned", bot: "Sample Bot", botId: "bot-sample", when: "1d", text: "Synthetic assigned item.", stale: false, number: 194, actions: ["Later"], card: null,
        hold: { decision: "assigned", assignee: "Sample Person (Full Name)", by: "Sample voice", at: "2026-11-11T13:33:09Z" } },
    ];
    const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString(); // timeline shows the last 7 days only
    fixture.decisions = [
      { n: 176, key: "k176", title: "Synthetic pricing comparison", bot: "Sample Bot", decision: "ignored_forever", by: "Sample voice", at: ago(1.2) },
      { n: 166, key: "synthetic-wait-hold", title: "Synthetic held item.", decision: "hold", by: "Sample voice", at: ago(1.1) },
      { n: 150, key: "k150", title: "Synthetic decision from last month", decision: "ignored", by: "Sample voice", at: ago(24 * 9) },
    ];
    fixture.archive = [
      { n: 176, key: "k176", title: "Synthetic pricing comparison", bot: "Sample Bot", decision: "ignored_forever", by: "Sample voice", at: "2026-11-11T13:31:21Z" },
      { n: 17, key: "k17", title: "Synthetic old removal", decision: "removed", legacy: true, by: "cli", at: "2026-10-31T13:00:00Z" },
    ];
    fixture.done = [{ bot: "Sample Bot", when: "Wed 9:40 AM", at: ago(1), text: "Synthetic Asana done" }, { bot: "Sample Bot", when: "old", at: ago(24 * 8), text: "Synthetic done 8 days ago" }, ...saved.done];
    const commands = [];
    const leaked = [];
    const { context, page, errors } = await openPage(browser, commands, leaked);
    try {
      await page.goto(base, { waitUntil: "domcontentloaded", timeout: 20000 });
      await ready(page);
      const today = await page.evaluate(() => ({
        badges: [...document.querySelectorAll("#wlist .item")].map((el) => [el.querySelector(".num").textContent, el.querySelector(".hbadge").textContent]),
        count: document.getElementById("todayTabCount").textContent,
        statN: document.getElementById("statN").textContent,
        statS: document.getElementById("statS").textContent,
      }));
      assert.deepEqual(today.badges.filter(([, b]) => b), [["#166", "On hold"], ["#178", "Parked"], ["#194", "Assigned to Sample Person"]]);
      assert.equal(today.statN, "0"); // no Asana cards in this fixture: 0 real asks
      assert.match(today.statS, /0 need a proper ask · 3 other · 2 on hold or parked/); // 2 plain + 1 assigned; hold and parked don't count
      assert.equal(today.count, "");
      await page.click('.tabs button[data-tab="activity"]');
      const tl = await page.evaluate(() => [...document.querySelectorAll("#timeline .tl")].map((x) => x.innerText.replace(/\s+/g, " ")));
      assert.match(tl[0], /Synthetic Asana done/);
      assert.match(tl[1], /On hold #166 Synthetic held item\./);
      assert.match(tl[2], /Ignored for good #176 Synthetic pricing comparison/);
      assert.match(tl[2], /AST/);
      assert.equal(tl.length, 3, "only the last 7 days; undated and older entries age out");
      assert.ok(!tl.some((x) => /Finished a synthetic item|8 days ago|last month/.test(x)));
      await page.evaluate(() => { document.getElementById("archWrap").open = true; });
      await page.type("#archQ", "#176");
      const arch = await page.evaluate(() => ({ sum: document.getElementById("archSum").textContent, rows: [...document.querySelectorAll("#archList .arow")].map((x) => x.innerText.replace(/\s+/g, " ")) }));
      assert.equal(arch.sum, "Resolved / Archive (2)");
      assert.equal(arch.rows.length, 1);
      assert.match(arch.rows[0], /#176 Ignored for good/);
      assert.equal(commands.length, 0);
      assert.equal(leaked.length, 0);
      assert.deepEqual(errors, []);
    } finally {
      Object.assign(fixture, saved);
      await context.close();
    }
  });
  it("Asana board freshness, Done button (hide + complete card), sort by last touched, 7-day fade, frozen sections hidden", async () => {
    const saved = { waiting: fixture.waiting, asana_board: fixture.asana_board, brain: fixture.brain, heatmap: fixture.heatmap, routines: fixture.routines };
    const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString();
    fixture.waiting = [
      { key: "synthetic-wait-1", bot: "Sample Bot", botId: "bot-sample", when: "2h", text: "Synthetic task: older touch.", stale: false, number: 101, actions: ["Later"], card: null, touched_at: ago(5) },
      { key: "1234567890123", bot: "Sample Bot", botId: "bot-sample", when: "1h", text: "Synthetic task: Asana ask.", stale: false, number: 103, actions: ["Later"], card: "1234567890123", asana: true, touched_at: ago(1) },
      { key: "synthetic-wait-old", bot: "Sample Bot", botId: "bot-sample", when: "10d", text: "Synthetic untouched ask.", stale: false, number: 104, actions: ["Later"], card: null, touched_at: ago(24 * 10) },
    ];
    fixture.asana_board = { fetched_at: ago(3), open: 2, source: "api", stale_after_min: 120 };
    fixture.heatmap = null; fixture.routines = null;
    const commands = [], leaked = [];
    const { context, page, errors } = await openPage(browser, commands, leaked);
    try {
      await page.goto(base, { waitUntil: "domcontentloaded", timeout: 20000 });
      await ready(page);
      const st = await page.evaluate(() => ({
        asof: document.getElementById("boardAsOf").textContent, stale: document.getElementById("boardAsOf").classList.contains("stale"),
        order: [...document.querySelectorAll("#wlist > .item .num")].map((x) => x.textContent),
        old: [...document.querySelectorAll("#wlist details.oldgrp .item")].map((x) => x.classList.contains("old") && x.querySelector(".num").textContent),
        oldSum: (document.querySelector("#wlist details.oldgrp summary") || {}).textContent,
        doneBtns: [...document.querySelectorAll("#wlist [data-done]")].map((b) => b.closest(".item").dataset.k),
        heatHidden: document.getElementById("heat").closest("section").hidden, rtHidden: document.getElementById("routines").closest("section").hidden,
      }));
      assert.match(st.asof, /Asana board as of .* AST/);
      assert.ok(st.stale, "3-hour-old copy must warn");
      assert.match(st.asof, /over 2 hours old/);
      assert.deepEqual(st.order, ["#103", "#101"], "newest touch first");
      assert.deepEqual(st.old, ["#104"]);
      assert.match(st.oldSum, /Untouched for 7\+ days \(1\)/);
      assert.deepEqual(st.doneBtns, ["1234567890123"], "Done only on Asana-backed items");
      assert.ok(st.heatHidden && st.rtHidden, "frozen heatmap / routines hidden");
      await page.click('#wlist [data-done]');
      await page.waitForFunction(() => ![...document.querySelectorAll("#wlist .item")].some((x) => x.dataset.k === "1234567890123"), { timeout: 5000 });
      assert.equal(commands.length, 1);
      assert.match(commands[0].url, /\/remove$/);
      assert.deepEqual(commands[0].body, { key: "1234567890123", by: "web view: Done", note: "Done: complete the Asana card" });
      await page.evaluate(() => { D.asana_board = { fetched_at: new Date(Date.now() - 20 * 60000).toISOString(), stale_after_min: 120 }; renderBoardAsOf(); });
      const fresh = await page.evaluate(() => ({ t: document.getElementById("boardAsOf").textContent, stale: document.getElementById("boardAsOf").classList.contains("stale") }));
      assert.ok(!fresh.stale); assert.match(fresh.t, /20 min ago/);
      assert.equal(leaked.length, 0);
      assert.deepEqual(errors, []);
    } finally {
      Object.assign(fixture, saved);
      await context.close();
    }
  });
  it("v2: Top 10 + Show all, decide in place, proper-ask flags, re-raise + recommendation, money strip, emails, weekly, 390px", async () => {
    const keys = ["waiting", "top10", "asks_summary", "money_strip", "weekly", "email_top10", "asana_board"];
    const saved = Object.fromEntries(keys.map((k) => [k, fixture[k]]));
    const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString();
    const raise = (d) => ({ count: d >= 14 ? 4 : d >= 7 ? 3 : d >= 3 ? 2 : 1, days: d, first_at: ago(d * 24), last_raised_at: ago(2), next_raise_at: ago(-24) });
    const ask = (o) => ({ proper: true, missing: [], question: "Synthetic question: go or wait?", options: ["go", "wait"], options_kind: "either/or", due: "2026-12-01", overdue: false, money_tt: null, money_label: null, raise: raise(1), created_at: ago(24), ...o });
    fixture.waiting = [
      { key: "1220000000000001", bot: "Sample Bot", botId: "bot-sample", when: "1h", text: "Synthetic task: big money ask.", number: 301, actions: ["Approve", "Decline", "Ignore for good"], card: "1220000000000001", asana: true, touched_at: ago(1),
        ask: ask({ money_tt: 72000, money_label: "TT$72,000", raise: raise(9), created_at: ago(9 * 24), recommendation: { decision: "approve", reason: 'The owning bot\'s card recommends: "go now"' } }) },
      { key: "1220000000000002", bot: "Sample Bot", botId: "bot-sample", when: "2h", text: "Synthetic task: small ask.", number: 302, actions: ["Approve", "Decline", "Ignore for good"], card: "1220000000000002", asana: true, touched_at: ago(2), ask: ask({}) },
      { key: "1220000000000003", bot: "Sample Bot", botId: "bot-sample", when: "3h", text: "Synthetic vague card.", number: 303, actions: ["Approve", "Decline", "Ignore for good"], card: "1220000000000003", asana: true, touched_at: ago(3),
        ask: ask({ proper: false, missing: ["a due date"], due: null, raise: raise(15), created_at: ago(15 * 24), recommendation: { decision: null, reason: "No recommendation; needs your call." } }) },
      { key: "board:2026-11-01:X", bot: "Board Room", botId: "brain:board", src: "board", when: "check-back from Nov 1 · asked 4× / 16 days", text: "Synthetic board check-back.", number: 304, actions: ["Done"], card: null, touched_at: ago(30),
        raise: raise(16), recommendation: { decision: null, reason: "No recommendation; needs your call." } },
    ];
    fixture.top10 = ["1220000000000001", "1220000000000002"];
    fixture.asks_summary = { asana_asks: 3, proper: 2, needs_proper_ask: 1, top10: 2 };
    fixture.asana_board = { fetched_at: ago(0.2), open: 3, stale_after_min: 120 };
    fixture.money_strip = { cells: [
      { k: "cash", label: "Usable cash", value: "TT$1,234", sub: "Status GREEN", as_of_label: "2026-11-10", age_days: 7, source: "Synthetic finance" },
      { k: "receivables", label: "Agency receivables", value: "TT$5,678", source: "Cashbot", as_of_label: "Mon" },
      { k: "ads", label: "Ad spend this week", value: null, missing: "This week isn't pulled yet.", source: "ads-weekly.json" },
      { k: "usage", label: "Grok Bot usage", value: "50% of weekly limit", source: "usage report" } ] };
    fixture.weekly = { since: ago(168), shipped_total: 3, shipped: [{ bot: "Sample Bot", count: 3, items: [{ text: "Shipped synthetic A" }, { text: "B" }, { text: "C" }] }], stalled: [{ bot: "Idle Sample", text: "Stalled synthetic card", card: "1220000000000009", days: 5 }], stalled_bots: [], reraised: [{ number: 303, text: "Synthetic vague card.", count: 4, days: 15 }] };
    fixture.email_top10 = { status: "no data yet", generated_at: null, items: [] };
    const commands = [], leaked = [];
    const { context, page, errors } = await openPage(browser, commands, leaked);
    try {
      await page.evaluateOnNewDocument(() => localStorage.removeItem("mcView"));
      await page.goto(base, { waitUntil: "domcontentloaded", timeout: 20000 });
      await ready(page);
      let v = await page.evaluate(() => ({
        title: document.getElementById("wTitle").textContent, nums: [...document.querySelectorAll("#wlist .item .num")].map((x) => x.textContent),
        more: (document.querySelector("#wlist [data-view=all]") || {}).textContent, strip: [...document.querySelectorAll("#mstrip .mcell")].map((c) => [c.querySelector(".s").textContent, c.querySelector(".b").textContent]),
        email: document.getElementById("emailAsOf").textContent, emailStale: document.getElementById("emailAsOf").classList.contains("stale"),
        first: (() => { const el = document.querySelector("#wlist .item"); return { pills: [...el.querySelectorAll(".pill2")].map((p) => p.textContent), rec: (el.querySelector(".rec") || {}).textContent, chips: [...el.querySelectorAll(".chip")].map((c) => c.textContent) }; })(),
        week: document.getElementById("week").textContent }));
      assert.equal(v.title, "Top 10 asks");
      assert.deepEqual(v.nums, ["#301", "#302"], "only proper asks, in top10 order");
      assert.match(v.more, /Show all/);
      assert.deepEqual(v.strip.map((x) => x[1]), ["TT$1,234", "TT$5,678", "No data", "50% of weekly limit"]);
      assert.match(v.email, /no data yet/); assert.ok(v.emailStale);
      assert.ok(v.first.pills.includes("TT$72,000 at stake")); assert.ok(v.first.pills.some((p) => /asked 3× \/ 9 days/.test(p)));
      assert.match(v.first.rec, /Recommended.*Approve.*go now.*Accept recommendation/s);
      assert.deepEqual(v.first.chips, ["Ignore for good"], "webhook Approve/Decline chips replaced by decide-in-place");
      // counts: headline = real asks; breakdown explains every number; hero = #1 of the Top 10
      const hc = await page.evaluate(() => ({ n: document.getElementById("statN").textContent, s: document.getElementById("statS").textContent, tab: document.getElementById("todayTabCount").textContent, wN: document.getElementById("wN").textContent,
        heroK: document.getElementById("oneMove").dataset.k, heroHidden: document.getElementById("oneMove").hidden, heroLab: document.querySelector("#oneMove .lab").textContent, heroTxt: document.getElementById("oneMove").textContent, more: (document.getElementById("wCounts") || {}).textContent }));
      assert.equal(hc.n, "3"); assert.equal(hc.tab, "3"); assert.equal(hc.wN, "2");
      assert.match(hc.s, /^real asks · 2 ready \(Top 10\) · 1 needs a proper ask · 1 other$/);
      assert.match(hc.more, /2 more open items: 1 real ask flagged "needs a proper ask" and 1 other\. Show all 4/);
      assert.equal(hc.heroHidden, false); assert.equal(hc.heroK, "1220000000000001"); assert.match(hc.heroLab, /#1 in your Top 10/);
      assert.match(hc.heroTxt, /TT\$72,000 at stake/); assert.ok(!/Synthetic one move|from the .* run/i.test(hc.heroTxt), "hero never uses brain text");
      // Board Room take: "Do this" shows while open; hidden with a note once decided or stale (box sets do_state)
      const takeView = () => page.evaluate(() => ({ doBox: !!document.querySelector("#boardSec .do"), life: !!document.querySelector("#boardSec .life"), note: (document.getElementById("takeNote") || {}).textContent || "" }));
      assert.equal((await takeView()).doBox, true, "open take shows Do this");
      await page.evaluate(() => { D.brain = JSON.parse(JSON.stringify(D.brain)); D.brain.board.take.do_state = { hidden: true, why: "decided", reason: "card completed", card: "1220000000000009" }; renderBrain(true); });
      let tv = await takeView(); assert.equal(tv.doBox, false); assert.equal(tv.life, false); assert.match(tv.note, /hidden: decision made \(card completed\)/);
      await page.evaluate(() => { D.brain.board.take.do_state = { hidden: true, why: "stale", reason: "x", card: null }; renderBrain(true); });
      tv = await takeView(); assert.equal(tv.doBox, false); assert.match(tv.note, /hidden: stale \(no linked Asana card and the take is over 24 hours old\)/);
      await page.evaluate(() => { D.brain.board.take.do_state = { hidden: false }; renderBrain(true); });
      assert.equal((await takeView()).doBox, true);
      assert.match(v.week, /Sample Bot 3/); assert.match(v.week, /5 days without an update/); assert.match(v.week, /asked 4× \/ 15 days/);
      // decide in place
      await page.type('#wlist .item[data-k="1220000000000002"] .dreply', "Go ahead, keep it small");
      await page.click('#wlist .item[data-k="1220000000000002"] [data-dec=approve]');
      await page.waitForFunction(() => !document.querySelector('#wlist .item[data-k="1220000000000002"]'), { timeout: 5000 });
      await page.click('#wlist .item[data-k="1220000000000001"] [data-dec=accept]');
      await page.waitForFunction(() => !document.querySelector('#wlist .item[data-k="1220000000000001"]'), { timeout: 5000 });
      assert.deepEqual(commands.map((c) => c.body), [
        { key: "1220000000000002", by: "web view: Approve", note: "Go ahead, keep it small" },
        { key: "1220000000000001", by: "web view: Accept rec (approve)", note: "Accepted recommendation" }]);
      // both Top 10 asks decided -> the hero falls back to the top flagged ask, labelled as such; counts follow
      const h2 = await page.evaluate(() => ({ k: document.getElementById("oneMove").dataset.k, lab: document.querySelector("#oneMove .lab").textContent, n: document.getElementById("statN").textContent, s: document.getElementById("statS").textContent, empty: document.getElementById("wCounts").textContent }));
      assert.equal(h2.k, "1220000000000003"); assert.match(h2.lab, /top flagged ask \(no proper asks right now\)/); assert.equal(h2.n, "1");
      assert.match(h2.s, /^real ask · 0 ready \(Top 10\) · 1 needs a proper ask · 1 other$/);
      assert.match(h2.empty, /Top 10 is empty \(0 ready\)\. 1 real ask needs a proper ask.*1 other open item.*Show all 2/);
      // Show all: flagged card + board re-raise
      await page.click("#vAll");
      assert.match(await page.$eval("#wCounts", (el) => el.textContent), /^All 2 open items: 1 real ask · 0 ready \(Top 10\) · 1 needs a proper ask · 1 other\./);
      v = await page.evaluate(() => ({ title: document.getElementById("wTitle").textContent, nums: [...document.querySelectorAll("#wlist .item .num")].map((x) => x.textContent),
        flag: [...document.querySelectorAll('#wlist .item[data-k="1220000000000003"] .pill2')].map((p) => p.textContent), noRec: (document.querySelector('#wlist .item[data-k="1220000000000003"] .rec') || {}).textContent,
        boardPill: [...document.querySelectorAll('#wlist .item[data-k="board:2026-11-01:X"] .pill2')].map((p) => p.textContent), saved: localStorage.getItem("mcView") }));
      assert.equal(v.title, "Waiting on me (all)"); assert.deepEqual(v.nums.sort(), ["#303", "#304"]);
      assert.ok(v.flag.includes("needs a proper ask")); assert.match(v.noRec, /needs your call/); assert.ok(!/Accept/.test(v.noRec));
      assert.ok(v.boardPill.some((p) => /asked 4× \/ 16 days/.test(p))); assert.equal(v.saved, "all");
      await page.click('#wlist .item[data-k="1220000000000003"] [data-dec=snooze]');
      await page.waitForFunction(() => !document.querySelector('#wlist .item[data-k="1220000000000003"]'), { timeout: 5000 });
      assert.deepEqual(commands[2].body, { key: "1220000000000003", by: "web view: Snooze 1d" });
      assert.equal(await page.$eval("#oneMove", (el) => el.hidden), true, "no open real ask left -> hero hidden");
      // stale board data (> 24 h) hides the hero even when an ask exists
      await page.evaluate((t) => { D.waiting.push({ key: "1220000000000007", bot: "Sample Bot", text: "Synthetic late ask", card: "1220000000000007", actions: [], ask: { proper: false, missing: ["a due date"], raise: { count: 1, days: 0 } } }); D.asana_board.fetched_at = t; renderRest(); }, ago(25));
      assert.equal(await page.$eval("#oneMove", (el) => el.hidden), true, "hero hidden when the board data is over 24 hours old");
      await page.evaluate((t) => { D.asana_board.fetched_at = t; renderRest(); }, ago(1));
      assert.equal(await page.$eval("#oneMove", (el) => el.dataset.k), "1220000000000007");
      await page.evaluate(() => { D.waiting = D.waiting.filter((i) => i.key !== "1220000000000007"); renderRest(); });
      // emails present + stale, and 390px layout with no sideways scroll
      await page.evaluate((g) => { D.email_top10 = { status: "ok", generated_at: g, items: [{ id: "m1", inbox: "team", from_name: "Sample Sender", subject: "Synthetic subject", received_at: g, ask: "Decide on the sample", link: "https://mail.google.com/mail/#all/m1", raise: { count: 2, days: 3 } }] }; renderEmails(); }, ago(13));
      v = await page.evaluate(() => ({ hd: document.getElementById("emailAsOf").textContent, items: [...document.querySelectorAll("#elist .em")].map((e) => e.textContent.replace(/\s+/g, " ")) }));
      assert.match(v.hd, /over 12 hours old/); assert.match(v.items[0], /Synthetic subject.*Decide on the sample.*Open in Gmail/); assert.match(v.items[0], /asked 2× \/ 3 days/);
      await page.setViewport({ width: 390, height: 844 });
      await new Promise((r) => setTimeout(r, 300));
      const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cols: getComputedStyle(document.getElementById("mstrip")).gridTemplateColumns.split(" ").length }));
      assert.ok(m.sw <= 392, `no sideways scroll at 390px (scrollWidth ${m.sw})`); assert.equal(m.cols, 2);
      await page.screenshot({ path: path.join(ARTIFACTS, "v2-mobile-synthetic.png"), fullPage: false }).catch(() => {});
      assert.equal(leaked.length, 0);
      assert.deepEqual(errors, []);
    } finally {
      Object.assign(fixture, saved);
      await context.close();
    }
  });

  it("v2 emails: Approve/Decline/Done/Remove buttons, dismissed filter, triage rewrite stays hidden", async () => {
    const commands = [], leaked = [];
    const { context, page, errors } = await openPage(browser, commands, leaked);
    try {
      await page.goto(base, { waitUntil: "domcontentloaded" });
      await ready(page);
      const now = new Date().toISOString();
      const keep = { id: "mail-keep", inbox: "miles", from_name: "Sample Keep", subject: "Please keep this one", received_at: now, ask: "Stay on the board", link: "https://mail.google.com/mail/#all/mail-keep" };
      const drop = { id: "1a1edcc05b2f0a35", inbox: "miles", from_name: "Sample Drop", subject: "You need a different passport photo", received_at: now, ask: "Already taken off by hand", link: "https://mail.google.com/mail/#all/1a1edcc05b2f0a35" };
      const act = { id: "mail-act", inbox: "team", from_name: "Sample Sender", subject: "Synthetic action subject", received_at: now, ask: "Needs a decision", money_at_stake: 50, link: "https://mail.google.com/mail/#all/mail-act" };
      // dismissed list (string or object) and a removal key both hide an email even if items still list it
      let v = await page.evaluate((g, keep, drop, act) => {
        D.removed = ["email:already-gone"];
        D.email_top10 = { status: "ok", generated_at: g, items: [keep, drop, act, { id: "already-gone", inbox: "miles", from_name: "Old", subject: "Already removed via /remove", received_at: g, ask: "Should stay off" }],
          dismissed: [{ id: "1a1edcc05b2f0a35", subject: "You need a different passport photo", by: "Miles (voice call)", at: "2026-11-19T01:07:00Z", reason: "Miles: remove from board" }, "also-string-id"] };
        renderEmails();
        return {
          ids: [...document.querySelectorAll("#elist .em")].map((e) => e.dataset.k),
          btns: [...document.querySelectorAll('#elist .em[data-k="mail-act"] [data-dec]')].map((b) => [b.dataset.dec, b.textContent.trim()]),
          gmail: !!document.querySelector('#elist .em[data-k="mail-act"] a[href^="https://mail.google.com/"]'),
          src: /gmail\.googleapis|users\/messages|messages\/modify/.test(document.documentElement.innerHTML)
        };
      }, now, keep, drop, act);
      assert.deepEqual(v.ids, ["mail-keep", "mail-act"], "dismissed and already-removed ids are filtered out");
      assert.deepEqual(v.btns, [["approve", "Approve"], ["decline", "Decline"], ["done", "✓ Done"], ["remove", "Remove"]]);
      assert.equal(v.gmail, true);
      assert.equal(v.src, false, "page source has no Gmail write calls");
      // Remove persists through the same /remove path, never /command, and the card leaves the board
      const before = commands.length;
      await page.click('#elist .em[data-k="mail-act"] [data-dec=remove]');
      await page.waitForFunction(() => !document.querySelector('#elist .em[data-k="mail-act"]'), { timeout: 5000 });
      const posted = commands.slice(before);
      assert.equal(posted.length, 1);
      assert.match(posted[0].url, /\/remove$/);
      assert.equal(posted[0].url.endsWith("/command"), false);
      assert.deepEqual(posted[0].body, { key: "email:mail-act", by: "web view: Remove", note: "Remove: take this email off the board" });
      v = await page.evaluate(() => [...document.querySelectorAll("#elist .em")].map((e) => e.dataset.k));
      assert.deepEqual(v, ["mail-keep"]);
      // Approve / Decline record the same `by` as the other cards
      await page.evaluate((g, keep, act2) => {
        D.email_top10.items = [keep, act2];
        renderEmails();
      }, now, keep, { ...act, id: "mail-approve", subject: "Approve me", link: "https://mail.google.com/mail/#all/mail-approve" });
      const mid = commands.length;
      await page.click('#elist .em[data-k="mail-approve"] [data-dec=approve]');
      await page.waitForFunction(() => !document.querySelector('#elist .em[data-k="mail-approve"]'), { timeout: 5000 });
      assert.deepEqual(commands[mid].body, { key: "email:mail-approve", by: "web view: Approve" });
      // Simulated triage rewrite puts the removed email back in items; dismissed / emailGone / removed keys keep it off
      v = await page.evaluate((g, keep, act) => {
        D.email_top10 = { status: "ok", generated_at: g, source: "simulated triage rewrite", items: [act, keep], dismissed: [{ id: "mail-act", reason: "removed on the board" }] };
        renderEmails();
        const withFile = [...document.querySelectorAll("#elist .em")].map((e) => e.dataset.k);
        D.email_top10.dismissed = [];
        renderEmails();
        const withoutFile = [...document.querySelectorAll("#elist .em")].map((e) => e.dataset.k);
        return { withFile, withoutFile };
      }, now, keep, act);
      assert.deepEqual(v.withFile, ["mail-keep"], "dismissed in the rewritten file keeps the email off");
      assert.deepEqual(v.withoutFile, ["mail-keep"], "session emailGone plus removed keys still hide it if triage omitted dismissed");
      assert.equal(leaked.length, 0);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
});
