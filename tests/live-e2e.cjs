// Live price stream test: Binance WebSocket + klines are simulated so ticks are
// deterministic; xaus.com is real. Runs a market-open weekday and a weekend.
// Usage: node tests/live-e2e.cjs
const { chromium, devices } = require("playwright");
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SUB = "/" + path.basename(ROOT) + "/";
const OUT = process.env.E2E_OUT || path.join(ROOT, ".e2e-out");
fs.mkdirSync(OUT, { recursive: true });
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png" };
const OZ = 31.1035;

let failures = 0;
const check = (ok, msg) => {
  console.log(`${ok ? "✓" : "✗"} ${msg}`);
  if (!ok) failures++;
};
const near = (a, b, eps) => Math.abs(a - b) < eps;
const toNum = (t) => Number(String(t).replace(/[^0-9.\-]/g, ""));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const site = http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (!u.startsWith(SUB)) return res.writeHead(404).end();
  if (u === SUB + "config.json") return res.writeHead(200, { "content-type": "application/json" }).end('{"pushServer":""}');
  let f = path.join(ROOT, u.slice(SUB.length));
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, "index.html");
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) return res.writeHead(404).end();
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});

const SEC = { "1s": 1, "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400 };

async function setup(browser, BASE, startTime, { ws = true, rest = true } = {}) {
  const ctx = await browser.newContext({ ...devices["iPhone 14"] });
  const page = await ctx.newPage();
  await page.clock.install({ time: startTime });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  await ctx.route("https://xaus.com/**", async (route) => {
    const r = await fetch(route.request().url());
    route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: await r.text() });
  });
  // synthetic klines ending "now" (page clock), price ≈ 3650
  await ctx.route("https://data-api.binance.vision/**", async (route) => {
    if (!rest) return route.abort("connectionrefused");
    const u = new URL(route.request().url());
    const sec = SEC[u.searchParams.get("interval")];
    const now = await page.evaluate(() => Date.now()).catch(() => startTime.getTime());
    const end = Math.floor(now / 1000 / sec) * sec;
    const rows = [];
    for (let i = 299; i >= 0; i--) {
      const t = end - i * sec;
      const o = 3650 + Math.sin(t / 600) * 5;
      const c = o + Math.cos(t / 300);
      rows.push([t * 1000, o.toFixed(2), (Math.max(o, c) + 0.5).toFixed(2), (Math.min(o, c) - 0.5).toFixed(2), c.toFixed(2), "1", t * 1000 + sec * 1000 - 1]);
    }
    route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(rows) });
  });
  let server = null;
  await ctx.routeWebSocket(/data-stream\.binance\.vision/, (s) => {
    if (!ws) return s.close();
    server = s;
  });
  const trade = async (sym, p) => {
    const T = await page.evaluate(() => Date.now());
    server?.send(JSON.stringify({ stream: sym.toLowerCase() + "@trade", data: { e: "trade", s: sym, p: String(p), q: "0.1", T } }));
  };
  await page.goto(BASE);
  await page.waitForFunction(() => document.querySelector("#price-usd").textContent.includes("$"));
  return { ctx, page, trade, errors, ws: () => server };
}

(async () => {
  await new Promise((r) => site.listen(0, "127.0.0.1", r));
  const BASE = `http://127.0.0.1:${site.address().port}${SUB}`;
  const browser = await chromium.launch();

  // ------------------------------------------------- market open (Wed) --
  {
    const { page, trade, errors, ws } = await setup(browser, BASE, new Date("2026-11-25T15:00:00Z"));
    await page.waitForFunction(() => document.querySelector("#status").dataset.state !== "loading", null, { timeout: 10000 });
    check(!!ws(), "app opened the Binance WebSocket");
    await trade("XAUTUSDT", 3655);
    await trade("PAXGUSDT", 3654);
    await page.waitForFunction(() => document.querySelector("#status").dataset.state === "live", null, { timeout: 5000 }).catch(() => {});
    check((await page.locator("#status").innerText()).includes("مباشر"), "status shows «مباشر» once ticks arrive");
    const f = await page.evaluate(() => JSON.parse(localStorage.getItem("gold.factor")));
    check(f.XAUTUSDT > 0.98 && f.XAUTUSDT < 1.02 && f.PAXGUSDT > 0.98 && f.PAXGUSDT < 1.02, `token→spot factors calibrated (${f.XAUTUSDT.toFixed(5)}, ${f.PAXGUSDT.toFixed(5)})`);
    const expected = (3655 * f.XAUTUSDT + 3654 * f.PAXGUSDT) / 2;
    const shown = toNum(await page.locator("#price-usd").innerText());
    check(near(shown, expected, 0.02), `headline = average of scaled token prices (${shown} vs ${expected.toFixed(2)})`);

    await trade("XAUTUSDT", 3665);
    await page.waitForFunction((p) => Number(document.querySelector("#price-usd").textContent.replace(/[^0-9.]/g, "")) > p + 4, shown, { timeout: 3000 }).catch(() => {});
    const up = toNum(await page.locator("#price-usd").innerText());
    check(up > shown + 4, `price moves with the next trade (${shown} → ${up})`);
    check(await page.evaluate(() => document.querySelector("#price-usd").className.includes("flash-up")), "price flashes green on an uptick");
    const g21 = toNum(await page.locator("#gold-grams .v").nth(2).innerText());
    check(near(g21, (up / OZ) * 0.875 * 3.75, 0.01), "karat prices follow the live price");

    // seconds chart
    await page.click('#ranges [data-tf="1s"]');
    await page.waitForFunction(() => document.querySelectorAll("#chart svg line[stroke='#22c55e'], #chart svg line[stroke='#ef4444']").length > 50, null, { timeout: 8000 });
    const before = await page.locator("#hist-body tr").first().locator("td").first().innerText();
    check(/\d{1,2}:\d{2}:\d{2}/.test(before), `1-second candles with seconds in the table (${before})`);
    await page.clock.runFor(1100);
    await trade("XAUTUSDT", 3670);
    await page.clock.runFor(400);
    await page.waitForTimeout(100);
    const after = await page.locator("#hist-body tr").first().locator("td").first().innerText();
    const lastClose = toNum(await page.locator("#hist-body tr").first().locator("td").nth(4).innerText());
    check(after !== before && near(lastClose, 3670 * f.XAUTUSDT, 0.06), `a new second → a new candle closing at the trade price (${before} → ${after}, ${lastClose})`);
    check((await page.locator("#chart-source").innerText()).includes("XAUT"), "chart notes the live source");
    for (const tf of ["1m", "5m", "15m", "1h", "4h"]) {
      await page.click(`#ranges [data-tf="${tf}"]`);
      await page.waitForFunction(() => document.querySelectorAll("#chart svg line[stroke='#22c55e'], #chart svg line[stroke='#ef4444']").length > 40, null, { timeout: 8000 }).catch(() => {});
      const n = await page.locator("#chart svg line[stroke='#22c55e'], #chart svg line[stroke='#ef4444']").count();
      check(n > 40, `${tf} chart: ${n} candles`);
    }
    await page.click('#ranges [data-tf="1m"]');
    await page.screenshot({ path: path.join(OUT, "live-1m.png"), fullPage: true });

    // alerts react to live ticks within ~a second
    await page.click(".tabbar [data-tab=alerts]");
    await page.selectOption("#alert-form select[name=item]", "g24");
    await page.check("#alert-form input[name=dir][value=above]", { force: true });
    const g24 = (toNum(await page.locator("#alert-hint").innerText().then((t) => t.split(":")[1])) || 0) + 0.5;
    await page.fill("#alert-form input[name=value]", g24.toFixed(2));
    await page.click("#alert-form button[type=submit]");
    await page.waitForTimeout(300);
    check((await page.locator(".toast.alert").count()) === 0, "alert just above the price does not fire yet");
    await trade("XAUTUSDT", 3700);
    await trade("PAXGUSDT", 3699);
    await page.clock.runFor(500);
    const fired = await page.waitForSelector(".toast.alert", { timeout: 3000 }).then(() => true).catch(() => false);
    check(fired, "alert fires on the next live tick");

    // stream drop → falls back to polling, reconnects
    await page.click(".tabbar [data-tab=home]");
    ws().close();
    await page.waitForTimeout(300);
    check((await page.locator("#status").getAttribute("data-state")) !== "live", "status leaves «مباشر» when the stream drops");
    await page.clock.runFor(2500);
    await page.waitForTimeout(300);
    check(!!ws(), "app reconnects to the stream");
    check(errors.length === 0, `no page errors ${errors.join(" | ")}`);
  }

  // --------------------------------------------------- weekend (closed) --
  {
    const { page, trade, errors } = await setup(browser, BASE, new Date("2026-11-28T12:00:00Z"));
    await page.waitForTimeout(800);
    const official = toNum(await page.locator("#price-usd").innerText());
    await trade("XAUTUSDT", 3800);
    await trade("PAXGUSDT", 3800);
    await page.clock.runFor(600);
    await page.waitForTimeout(200);
    check(toNum(await page.locator("#price-usd").innerText()) === official, `weekend: headline stays on the official close (${official})`);
    check((await page.locator("#status").innerText()).includes("السوق مغلق"), "weekend: status «السوق مغلق»");
    await page.click('#ranges [data-tf="1m"]');
    await page.waitForTimeout(500);
    check((await page.locator("#chart-source").innerText()).includes("مغلق"), "weekend: chart explains the market is closed");
    await page.screenshot({ path: path.join(OUT, "live-weekend.png"), fullPage: true });
    check(errors.length === 0, `no page errors ${errors.join(" | ")}`);
  }

  // ------------------------------------------- Binance unreachable --
  {
    const { page, errors } = await setup(browser, BASE, new Date("2026-11-25T15:00:00Z"), { ws: false, rest: false });
    await page.waitForTimeout(1500);
    check(["minute", "loading"].includes(await page.locator("#status").getAttribute("data-state")), "no stream: falls back to xaus.com updates");
    await page.click('#ranges [data-tf="1s"]');
    await page.waitForTimeout(400);
    check((await page.locator("#chart").innerText()).includes("غير متاح"), "no stream: seconds chart says unavailable");
    await page.click('#ranges [data-tf="5m"]');
    await page.waitForTimeout(400);
    const n = await page.locator("#chart svg line[stroke='#22c55e'], #chart svg line[stroke='#ef4444']").count();
    check(n > 20 && (await page.locator("#chart-source").innerText()).includes("5 دقائق"), `no stream: 5-minute chart from xaus.com (${n} candles)`);
    check(errors.length === 0, `no page errors ${errors.join(" | ")}`);
  }

  await browser.close();
  site.close();
  console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll live-stream checks passed");
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
