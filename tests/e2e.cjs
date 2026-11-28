// End-to-end test of the static PWA on an emulated iPhone.
// Usage: node tests/e2e.cjs   (needs Playwright + network access to xaus.com)
// Serves the repo under /<folder>/ to mimic https://user.github.io/<repo>/.
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
const near = (a, b, eps = 0.006) => Math.abs(a - b) < eps;
const toNum = (t) => Number(String(t).replace(/[^0-9.\-−]/g, "").replace("−", "-"));

const server = http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (!u.startsWith(SUB)) return res.writeHead(404).end();
  let f = path.join(ROOT, u.slice(SUB.length));
  if (!f.startsWith(ROOT)) return res.writeHead(403).end();
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, "index.html");
  if (!fs.existsSync(f)) return res.writeHead(404).end();
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const BASE = `http://127.0.0.1:${server.address().port}${SUB}`;
  const browser = await chromium.launch();
  const errors = [];

  // xaus.com → forwarded to the real API from Node; tests can force prices.
  let forced = null;
  let forcedSilver = null;
  let offline = false;
  let real = {};
  async function wire(ctx) {
    await ctx.route("https://xaus.com/**", async (route) => {
      if (offline) return route.abort("internetdisconnected");
      const url = route.request().url();
      const body = await (await fetch(url)).json();
      if (url.includes("/spot")) {
        real = { spot: body.spot_usd_oz, silver: body.silver_usd_oz, rates: body.fx_rates };
        if (forced != null) {
          body.spot_usd_oz = forced;
          body.xau.price = forced;
        }
        if (forcedSilver != null) body.silver_usd_oz = forcedSilver;
      }
      route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
    });
    await ctx.route("https://s3.tradingview.com/**", (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: "/* stub */" }));
    // the live stream has its own test (tests/live-e2e.cjs); keep this one on xaus.com only
    await ctx.route("https://data-api.binance.vision/**", (r) => r.abort("connectionrefused"));
    await ctx.routeWebSocket(/binance\.vision/, (ws) => ws.close());
  }
  const watch = (p) => {
    p.on("pageerror", (e) => errors.push(e.message));
    p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    p.on("dialog", (d) => d.accept());
  };

  // ---------------------------------------------------- v1 migration --
  {
    const ctx = await browser.newContext({ ...devices["iPhone 14"] });
    await wire(ctx);
    await ctx.addInitScript(() => {
      if (sessionStorage.getItem("seeded")) return;
      sessionStorage.setItem("seeded", "1");
      localStorage.setItem("gold.buys", JSON.stringify([{ id: "old1", date: "2026-01-02", karat: 21, weight: 5, paid: 1500, createdAt: "2026-01-02T00:00:00Z" }]));
      localStorage.setItem("gold.alerts", JSON.stringify([{ id: "oa", karat: 22, dir: "above", price: 99999, createdAt: "2026-01-02T00:00:00Z", triggeredAt: null }]));
    });
    const p = await ctx.newPage();
    watch(p);
    await p.goto(BASE);
    await p.click(".tabbar [data-tab=buys]");
    check((await p.locator("#buy-list .item").innerText()).includes("عيار 21"), "v1 purchase migrated");
    await p.click(".tabbar [data-tab=alerts]");
    check((await p.locator("#alert-list .item").innerText()).includes("عيار 22 أعلى من 99,999.00 ريال"), "v1 alert migrated");
    await ctx.close();
  }

  const ctx = await browser.newContext({ ...devices["iPhone 14"], serviceWorkers: "allow", acceptDownloads: true });
  await wire(ctx);
  const page = await ctx.newPage();
  watch(page);
  const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  const tab = (t) => page.click(`.tabbar [data-tab=${t}]`);
  const refresh = async () => {
    await tab("home");
    const b = await page.evaluate(() => JSON.parse(localStorage.getItem("gold.last") || "{}").fetchedAt);
    await page.click("#refresh");
    await page.waitForFunction((x) => JSON.parse(localStorage.getItem("gold.last") || "{}").fetchedAt !== x, b);
  };

  // ---------------------------------------------------------- home --
  await page.goto(BASE);
  await page.waitForFunction(() => document.querySelector("#price-usd").textContent.includes("$"));
  const usd = toNum(await page.locator("#price-usd").innerText());
  check(near(usd, real.spot, 0.01), `gold ounce = live API price (${usd})`);
  check(near(toNum(await page.locator("#price-local").innerText()), usd * 3.75, 0.01), "ounce SAR = USD × 3.75");
  const gold = await page.locator("#gold-grams .v").allInnerTexts();
  check(gold.length === 4 && gold.every((t, i) => near(toNum(t), (usd / OZ) * ([24, 22, 21, 18][i] / 24) * 3.75)), `gold gram 24/22/21/18 (${gold.join(" | ")})`);
  const silver = await page.locator("#silver-grams .v").allInnerTexts();
  check(silver.length === 2 && near(toNum(silver[0]), (real.silver / OZ) * 0.999 * 3.75) && near(toNum(silver[1]), (real.silver / OZ) * 0.925 * 3.75), `silver gram 999/925 (${silver.join(" | ")})`);
  const shop21 = toNum(await page.locator("#gold-grams .karat").nth(2).locator(".shop b").innerText());
  check(near(shop21, ((usd / OZ) * 0.875 * 3.75 + 20) * 1.15, 0.011), `21k shop estimate = (gram + 20 making) × 1.15 (${shop21})`);
  check(await page.isVisible("text=السعر العالمي، لا يشمل المصنعية وضريبة القيمة المضافة"), "VAT/making disclaimer");
  check((await page.locator("#change.up, #change.down").count()) === 1, `day change coloured (${await page.locator("#change").innerText()})`);
  check(["minute", "closed"].includes(await page.locator("#status").getAttribute("data-state")), `status without live stream: ${await page.locator("#status").innerText()}`);

  // timeframes
  for (const [tf, min] of [["1h", 24], ["4h", 6], ["1d", 40], ["1w", 40]]) {
    await page.click(`#ranges [data-tf="${tf}"]`);
    await page.waitForFunction(() => document.querySelectorAll("#chart svg line[stroke='#22c55e'], #chart svg line[stroke='#ef4444']").length > 0, null, { timeout: 15000 });
    const candles = await page.locator("#chart svg line[stroke='#22c55e'], #chart svg line[stroke='#ef4444']").count();
    const rows = await page.locator("#hist-body tr").count();
    check(candles >= min && rows >= Math.min(min, 12), `timeframe ${tf}: ${candles} candles, ${rows} table rows`);
  }
  // weekly candle OHLC sanity: high ≥ open/close ≥ low
  const sane = await page.$$eval("#hist-body tr", (trs) =>
    trs.every((tr) => {
      const v = [...tr.children].slice(1, 5).map((td) => Number(td.textContent.replace(/,/g, "")));
      return v[1] >= Math.max(v[0], v[3]) - 1e-9 && v[2] <= Math.min(v[0], v[3]) + 1e-9;
    }),
  );
  check(sane, "every candle has high ≥ open/close ≥ low");
  check((await page.locator("#chart-stats").innerText()).includes("52"), "52-week high/low shown on daily/weekly");
  // table in gram 21 (SAR)
  await page.selectOption("#hist-unit", "g21");
  const firstClose = toNum(await page.locator("#hist-body tr").first().locator("td").nth(4).innerText());
  check(near(firstClose, (usd / OZ) * 0.875 * 3.75, 0.02), `history table in 21k SAR/gram (${firstClose})`);
  await page.selectOption("#hist-unit", "oz");
  await page.click("#hist-more");
  check((await page.locator("#hist-body tr").count()) === 48, "show more loads more rows");
  // tap a candle
  await page.locator("#chart svg").scrollIntoViewIfNeeded();
  const box = await page.locator("#chart svg").boundingBox();
  await page.touchscreen.tap(box.x + box.width * 0.5, box.y + box.height / 2);
  check(/O .*H .*L .*C /.test(await page.locator("#chart-tip").innerText()), "tapping a candle shows O/H/L/C");
  await page.click("#tv-btn");
  check(await page.isVisible("#tv-box script, #tv-box .tradingview-widget-container"), "TradingView chart opens on demand");
  await page.click("#tv-btn");
  await page.click('#ranges [data-tf="1h"]');
  await shot("01-home");

  // ---------------------------------------------------- calculator --
  forced = 3110.35; // 24k = 375 SAR/g, 21k = 328.125
  forcedSilver = 31.1035; // 999 = 3.74625, 925 = 3.46875 SAR/g
  await refresh();
  await tab("calc");
  await page.selectOption("#calc-form select[name=item]", "g21");
  await page.fill("#calc-form input[name=weight]", "10");
  await page.waitForTimeout(150);
  check((await page.locator("#calc-raw").innerText()).startsWith("3,281.25"), "calc: 10 g 21k global value 3,281.25");
  check((await page.locator("#calc-making").innerText()).startsWith("200.00"), "calc: making 10 × 20 = 200");
  check((await page.locator("#calc-vat").innerText()).startsWith("522.19"), "calc: VAT 15% = 522.19");
  check((await page.locator("#calc-total").innerText()).startsWith("4,003.44"), "calc: shop total 4,003.44");
  await page.fill("#calc-form input[name=making]", "0");
  await page.waitForTimeout(100);
  check((await page.locator("#calc-total").innerText()).startsWith("3,773.44"), "calc: custom making overrides");
  await page.selectOption("#calc-form select[name=item]", "s999");
  await page.click("#calc-weights [data-w='100']");
  check((await page.locator("#calc-raw").innerText()).startsWith("374.63"), "calc: 100 g silver 999 = 374.63");
  await shot("02-calc");

  // -------------------------------------------------------- alerts --
  await tab("alerts");
  await page.selectOption("#alert-form select[name=item]", "g21");
  await page.fill("#alert-form input[name=value]", "abc");
  await page.click("#alert-form button[type=submit]");
  check(await page.isVisible("text=أدخل قيمة صحيحة"), "invalid alert value rejected");
  await page.fill("#alert-form input[name=value]", "٣٣٠"); // 330 (Arabic digits) → 21k 328.125 is below
  await page.check("#alert-form input[name=dir][value=below]", { force: true });
  await page.click("#alert-form button[type=submit]");
  await page.waitForSelector(".toast.alert");
  check((await page.locator(".toast.alert").first().innerText()).includes("عيار 21 أقل من 330.00 ريال"), "gram alert fires with on-screen notification");
  await page.$$eval(".toast button", (bs) => bs.forEach((b) => b.click()));

  await page.check("#alert-form input[name=kind][value=ounce]", { force: true });
  await page.selectOption("#alert-form select[name=metal]", "silver");
  await page.check("#alert-form input[name=dir][value=above]", { force: true });
  await page.fill("#alert-form input[name=value]", "40");
  await page.click("#alert-form button[type=submit]");
  await page.waitForTimeout(300);
  check((await page.locator(".toast.alert").count()) === 0, "silver ounce > $40 does not fire at $31.10");
  forcedSilver = 41;
  await refresh();
  await tab("alerts");
  await page.waitForSelector(".toast.alert");
  check((await page.locator(".toast.alert").first().innerText()).includes("أونصة الفضة أعلى من $40.00"), "silver ounce alert fires on crossing");
  await page.$$eval(".toast button", (bs) => bs.forEach((b) => b.click()));

  await page.check("#alert-form input[name=kind][value=pct]", { force: true });
  await page.fill("#alert-form input[name=value]", "150");
  await page.click("#alert-form button[type=submit]");
  check(await page.isVisible("text=النسبة يجب أن تكون أقل من 100%"), "pct alert must be < 100");
  await page.check("#alert-form input[name=dir][value=below]", { force: true });
  await page.fill("#alert-form input[name=value]", "5"); // forced 3110 vs ~3550 open → about −12%
  await page.selectOption("#alert-form select[name=repeat]", "60");
  await page.click("#alert-form button[type=submit]");
  await page.waitForSelector(".toast.alert");
  check((await page.locator(".toast.alert").first().innerText()).includes("نزول الذهب 5.00% اليوم"), "percent-drop alert fires");
  await page.$$eval(".toast button", (bs) => bs.forEach((b) => b.click()));
  await refresh();
  await tab("alerts");
  await page.waitForTimeout(500);
  check((await page.locator(".toast.alert").count()) === 0, "repeating alert respects its cooldown");
  check((await page.locator("#alert-list").innerText()).includes("متكرر"), "repeat setting shown");
  check((await page.evaluate(() => JSON.parse(localStorage.getItem("gold.alerts")).length)) === 3, "alerts saved");
  await shot("03-alerts");
  await page.locator("#alert-list .item").first().locator("text=حذف").click();
  check((await page.locator("#alert-list .item").count()) === 2, "alert deleted");

  // ----------------------------------------------------- purchases --
  forcedSilver = 31.1035;
  await refresh();
  await tab("buys");
  await page.fill("#buy-form input[name=date]", "2026-01-15");
  await page.selectOption("#buy-form select[name=item]", "g21");
  await page.fill("#buy-form input[name=weight]", "10");
  await page.fill("#buy-form input[name=paid]", "3000");
  await page.fill("#buy-form input[name=note]", "سوار");
  await page.click("#buy-submit");
  await page.waitForSelector("#buy-list .item");
  let t = await page.locator("#buy-list .item").first().innerText();
  check(t.includes("3,281.25") && t.includes("+281.25") && t.includes("+9.38%"), "purchase value & profit");
  check(t.includes("متوسط الجرام 300.00") && t.includes("سوار"), "average price per gram + note");

  await page.fill("#buy-form input[name=date]", "2026-03-01");
  await page.selectOption("#buy-form select[name=item]", "s999");
  await page.fill("#buy-form input[name=weight]", "100");
  await page.fill("#buy-form input[name=paid]", "400"); // value 374.625 → −25.38
  await page.click("#buy-submit");
  await page.waitForFunction(() => document.querySelectorAll("#buy-list .item").length === 2);
  check((await page.locator("#buy-list .item").first().locator(".down").count()) > 0, "silver purchase at a loss is red");
  check((await page.locator("#sum-paid").innerText()) === "3,400.00", "total paid");
  check((await page.locator("#sum-value").innerText()) === "3,655.88", `total value (${await page.locator("#sum-value").innerText()})`);
  check((await page.locator("#sum-weights").innerText()).includes("8.75 جم خالص") && (await page.locator("#sum-weights").innerText()).includes("فضة: 100"), "weights summary (pure gold + silver)");
  check((await page.locator("#sum-weights").innerText()).includes("342.86"), "average cost per pure gram (3000 / 8.75)");

  // edit
  await page.locator("#buy-list .item").nth(1).locator("text=تعديل").click();
  await page.fill("#buy-form input[name=weight]", "12");
  await page.click("#buy-submit");
  await page.waitForTimeout(200);
  check((await page.locator("#buy-list .item").nth(1).innerText()).includes("3,937.50"), "edit: 12 g × 328.125");
  await page.locator("#buy-list .item").nth(1).locator("text=تعديل").click();
  await page.fill("#buy-form input[name=weight]", "10");
  await page.click("#buy-submit");

  // sell
  await page.locator("#buy-list .item").nth(1).locator("text=بيع").click();
  await page.fill("#sell-form input[name=date]", "2026-01-01");
  await page.fill("#sell-form input[name=price]", "3200");
  await page.click("#sell-form button[type=submit]");
  check(await page.isVisible("text=تاريخ البيع قبل تاريخ الشراء"), "sell date before purchase rejected");
  await page.fill("#sell-form input[name=date]", "2026-06-01");
  await page.click("#sell-form button[type=submit]");
  await page.waitForTimeout(200);
  t = await page.locator("#buy-list .item").nth(1).innerText();
  check(t.includes("مُباع") && t.includes("+200.00"), "sold: realized profit +200");
  check((await page.locator("#sum-realized").innerText()).includes("+200.00"), "realized profit in summary");
  check((await page.locator("#sum-paid").innerText()) === "400.00", "sold items leave the holdings total");
  await shot("04-purchases");
  await page.locator("#buy-list .item").nth(1).locator("text=إلغاء البيع").click();
  await page.waitForTimeout(200);
  check((await page.locator("#sum-paid").innerText()) === "3,400.00", "undo sale");

  // ------------------------------------------------------ settings --
  await tab("settings");
  await page.fill("#settings-form input[name=mk_g21]", "30");
  await page.uncheck("#settings-form input[name=vatOn]");
  await page.click("#settings-form button[type=submit]");
  await tab("home");
  const shopNoVat = toNum(await page.locator("#gold-grams .karat").nth(2).locator(".shop b").innerText());
  check(near(shopNoVat, 328.125 + 30, 0.006), `making 30, VAT off → 21k shop 358.13 (${shopNoVat})`);
  await tab("settings");
  await page.check("#settings-form input[name=vatOn]");
  await page.click("#settings-form button[type=submit]");

  // currency
  await page.selectOption("#currency", "JOD");
  await tab("home");
  const jod = real.rates.JOD;
  const g21jod = toNum(await page.locator("#gold-grams .v").nth(2).innerText());
  check(near(g21jod, (3110.35 / OZ) * 0.875 * jod, 0.006) && (await page.locator(".cur-name").first().innerText()) === "دينار", `JOD: 21k = ${g21jod} دينار`);
  await tab("buys");
  check(near(toNum(await page.locator("#sum-paid").innerText()), (3400 / 3.75) * jod, 0.006), "totals converted to JOD");
  check((await page.locator("#buy-list .item").first().innerText()).includes("ريال"), "each purchase keeps its own currency");
  await tab("settings");
  await page.selectOption("#currency", "SAR");

  // backup: export → wipe → import
  await page.evaluate(() => {
    navigator.canShare = undefined; // force the download path
  });
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#export-btn")]);
  const file = path.join(OUT, "backup.json");
  await dl.saveAs(file);
  const backup = JSON.parse(fs.readFileSync(file, "utf8"));
  check(backup.app === "gold-live" && backup.buys.length === 2 && backup.alerts.length === 2, "export contains purchases, alerts, settings");
  await page.evaluate(() => {
    localStorage.removeItem("gold.buys");
    localStorage.removeItem("gold.alerts");
  });
  await page.reload();
  await tab("buys");
  check((await page.locator("#buy-list .item").count()) === 0, "data wiped");
  await tab("settings");
  await page.setInputFiles("#import-file", file);
  await page.waitForSelector("text=تم الاستيراد");
  await tab("buys");
  check((await page.locator("#buy-list .item").count()) === 2, "import restored purchases");
  const bad = path.join(OUT, "bad.json");
  fs.writeFileSync(bad, '{"hello":1}');
  await tab("settings");
  await page.setInputFiles("#import-file", bad);
  check(!!(await page.waitForSelector("text=ملف غير صالح").catch(() => null)), "invalid backup file rejected");
  await shot("05-settings");

  // ------------------------------------------------------- offline --
  await tab("home");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.waitForFunction(() => document.querySelector("#price-usd").textContent.includes("$"));
  await page.waitForTimeout(500);
  offline = true;
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForSelector("#price-usd");
  await page.waitForFunction(() => document.querySelector("#status").dataset.state === "offline", null, { timeout: 15000 });
  check((await page.locator("#price-usd").innerText()).includes("3,110.35"), "offline: last saved price shown");
  check(await page.isVisible("#offline-banner"), "offline banner");
  check(/\d/.test(await page.locator("#updated").innerText()), "offline: last update time");
  check((await page.locator("#chart svg rect").count()) > 0, "offline: chart from saved data");
  await page.click('#ranges [data-tf="1w"]');
  check((await page.locator("#hist-body tr").count()) > 10, "offline: weekly history from saved data");
  await shot("06-offline");
  offline = false;
  await ctx.setOffline(false);

  // ---------------------------------------------------------- PWA --
  const man = await (await fetch(BASE + "manifest.json")).json();
  check(man.start_url === "./" && man.scope === "./" && man.display === "standalone", "manifest relative + standalone");
  for (const i of man.icons) check((await fetch(new URL(i.src, BASE))).ok, `icon ${i.src}`);
  check(!/(href|src)="\/(?!\/)/.test(fs.readFileSync(path.join(ROOT, "index.html"), "utf8")), "no absolute paths");
  const realErrors = errors.filter((e) => !/ERR_INTERNET_DISCONNECTED|ERR_CONNECTION_REFUSED/.test(e)); // offline test + blocked Binance
  check(realErrors.length === 0, `no console errors ${realErrors.join(" | ")}`);

  await browser.close();
  server.close();
  console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll checks passed");
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
