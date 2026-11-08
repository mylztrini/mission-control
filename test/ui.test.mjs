// UI tests for Mission Control. The page is served locally and every API call is mocked.
// SYNTHETIC FIXTURE only — these tests must not call the live Supabase function or send commands.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { describe, it, before, after } from "node:test";
import { fixture, orgFixture, SYNTH_KEY } from "./synthetic-fixture.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const ARTIFACTS = "/opt/cursor/artifacts";
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
      taskTop: task.top,
      shellW: shell.width,
      leftRight: left.right,
      leftLeft: left.left,
      toggleRight: toggle.right,
      toggleTop: toggle.top,
      moveBottom: move.bottom,
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
    assert.equal(html.includes("mcVitalsOpen"), true);
    assert.equal(html.includes("mcNetworthOpen"), true);
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
      assert.equal(fresh.count, "4");
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
      assert.deepEqual(nav.tabs.map((t) => t.tab), ["today", "villas", "money", "growth", "helpdesk", "org", "activity", "routines"]);
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
      assert.equal(desktopOpen.cards.length, 4);
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
      assert.equal(mobileOpen.cards.length, 4);
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

      assert.equal(await page.$eval("#statN", (el) => el.textContent), "2");
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

      for (const tab of ["villas", "money", "growth", "helpdesk", "org", "activity", "routines", "today"]) {
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
});
