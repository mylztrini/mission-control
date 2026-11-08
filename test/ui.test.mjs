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

async function metrics(page) {
  return page.evaluate(() => {
    const task = document.getElementById("wlist").closest("section").getBoundingClientRect();
    const shell = document.querySelector(".shell").getBoundingClientRect();
    const toggle = document.getElementById("vitalsToggle").getBoundingClientRect();
    const cards = [...document.querySelectorAll("#vitals .vital")].map((el) => el.getBoundingClientRect());
    const tabs = document.querySelector(".tabs");
    return {
      taskTop: task.top,
      shellW: shell.width,
      toggleW: toggle.width,
      panelHidden: document.getElementById("vitals").hidden,
      expanded: document.getElementById("vitalsToggle").getAttribute("aria-expanded"),
      cards: cards.map((c) => ({ top: Math.round(c.top), left: Math.round(c.left), h: Math.round(c.height) })),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      tabsClient: tabs.clientWidth,
      tabsScroll: tabs.scrollWidth,
      vh: window.innerHeight
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
      assert.ok(desktopClosed.toggleW > desktopClosed.shellW * 0.9, `toggle width ${desktopClosed.toggleW} shell ${desktopClosed.shellW}`);
      assert.ok(desktopClosed.overflow <= 1, `desktop overflow ${desktopClosed.overflow}`);
      assert.ok(desktopClosed.taskTop < desktopClosed.vh, `desktop tasks start at ${desktopClosed.taskTop}`);

      await page.click("#vitalsToggle");
      const desktopOpen = await metrics(page);
      assert.equal(desktopOpen.panelHidden, false);
      assert.equal(desktopOpen.cards.length, 4);
      const tops = desktopOpen.cards.map((c) => c.top);
      assert.ok(Math.max(...tops) - Math.min(...tops) < 8, `desktop cards should share a row: ${JSON.stringify(tops)}`);
      assert.ok(desktopOpen.taskTop > desktopClosed.taskTop + 80, `tasks moved ${desktopOpen.taskTop - desktopClosed.taskTop}px`);

      await page.click("#vitalsToggle");
      await page.setViewport({ width: 390, height: 844 });
      const mobileClosed = await metrics(page);
      assert.equal(mobileClosed.panelHidden, true);
      assert.ok(mobileClosed.overflow <= 1, `mobile overflow ${mobileClosed.overflow}`);
      assert.ok(mobileClosed.tabsScroll > mobileClosed.tabsClient + 20, `tabs should scroll inside the row (${mobileClosed.tabsScroll} vs ${mobileClosed.tabsClient})`);
      assert.ok(mobileClosed.taskTop < mobileClosed.vh, `mobile tasks start at ${mobileClosed.taskTop} in ${mobileClosed.vh}`);
      const prop = await page.evaluate(() => {
        const r = document.getElementById("propertySite").getBoundingClientRect();
        return { right: r.right, vw: window.innerWidth };
      });
      assert.ok(prop.right <= prop.vw - 4, `property link clipped at ${prop.right} of ${prop.vw}`);

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
      await page.screenshot({ path: path.join(ARTIFACTS, "mobile_expanded_stats.png") });
      await page.click("#vitalsToggle");
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: path.join(ARTIFACTS, "mobile_collapsed_stats.png") });
      await page.setViewport({ width: 1440, height: 900 });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: path.join(ARTIFACTS, "desktop_collapsed_stats.png") });
      await page.click("#vitalsToggle");
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: path.join(ARTIFACTS, "desktop_expanded_stats.png") });
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
});
