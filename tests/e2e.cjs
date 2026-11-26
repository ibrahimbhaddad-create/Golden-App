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

let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? "✓" : "✗"} ${msg}`); if (!ok) failures++; };

const server = http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (!u.startsWith(SUB)) { res.writeHead(404).end(); return; }
  let f = path.join(ROOT, u.slice(SUB.length));
  if (!f.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, "index.html");
  if (!fs.existsSync(f)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const BASE = `http://127.0.0.1:${server.address().port}${SUB}`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices["iPhone 14"], serviceWorkers: "allow" });

  // xaus.com: by default forward to the real API from Node; tests can force a price.
  let forced = null;
  let realSpot = null;
  let offline = false;
  await ctx.route("https://xaus.com/**", async (route) => {
    if (offline) return route.abort("internetdisconnected");
    const url = route.request().url();
    const r = await fetch(url);
    const body = await r.json();
    if (url.includes("/spot")) {
      realSpot = body.spot_usd_oz;
      if (forced != null) { body.spot_usd_oz = forced; body.xau.price = forced; }
    }
    route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
  });

  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("dialog", (d) => d.accept());
  const num = async (sel) => Number((await page.locator(sel).innerText()).replace(/[^0-9.\-−]/g, "").replace("−", "-"));
  const refreshFromHome = async () => {
    await page.click(".tabbar [data-tab=home]");
    const b = await page.evaluate(() => JSON.parse(localStorage.getItem("gold.last")).fetchedAt);
    await page.click("#refresh");
    await page.waitForFunction((x) => JSON.parse(localStorage.getItem("gold.last")).fetchedAt !== x, b);
    await page.click(".tabbar [data-tab=alerts]");
  };
  const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });

  // ---------------------------------------------------------- home --
  await page.goto(BASE);
  await page.waitForFunction(() => document.querySelector("#price-usd").textContent.includes("$"));
  await page.waitForSelector("#chart svg path");
  const usd = await num("#price-usd");
  check(Math.abs(usd - realSpot) < 0.01, `ounce USD shows the live API price (${usd})`);
  check(Math.abs((await num("#price-sar")) - usd * 3.75) < 0.01, "ounce SAR = USD × 3.75");
  const k = await page.locator(".karat .v").allInnerTexts();
  const expect = [24, 22, 21, 18].map((c) => (usd / 31.1035) * (c / 24) * 3.75);
  check(k.length === 4 && k.every((t, i) => Math.abs(Number(t.replace(/,/g, "")) - expect[i]) < 0.006), `gram prices for 24/22/21/18 (${k.join(" | ")})`);
  check(/اليوم|24 ساعة/.test(await page.locator("#change").innerText()) && (await page.locator("#change.up, #change.down").count()) === 1, `day change shown & coloured (${await page.locator("#change").innerText()})`);
  check(await page.isVisible("text=السعر العالمي، لا يشمل المصنعية وضريبة القيمة المضافة"), "VAT/making disclaimer under the prices");
  check((await page.locator("#status").getAttribute("data-state")) === "live", "status pill says live");
  check(/\d/.test(await page.locator("#updated").innerText()), `last-update time shown (${await page.locator("#updated").innerText()})`);
  await shot("01-home");

  // chart scrub
  await page.locator("#chart svg").scrollIntoViewIfNeeded();
  const box = await page.locator("#chart svg").boundingBox();
  await page.touchscreen.tap(box.x + box.width * 0.4, box.y + box.height / 2);
  check(/\$/.test(await page.locator("#chart-tip").innerText()), "chart scrub shows a price");

  // manual refresh
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem("gold.last")).fetchedAt);
  await page.waitForTimeout(1100);
  await page.click("#refresh");
  await page.waitForFunction((b) => JSON.parse(localStorage.getItem("gold.last")).fetchedAt !== b, before);
  check(true, "manual refresh fetches again");

  // -------------------------------------------------------- alerts --
  forced = 3000; // 21k gram = 3000/31.1035*0.875*3.75 ≈ 316.49
  await page.click("#refresh");
  await page.waitForFunction(() => document.querySelector("#price-usd").textContent.includes("3,000.00"));
  await page.click(".tabbar [data-tab=alerts]");
  check((await page.locator("#alert-hint").innerText()).includes("316.48"), "alert form shows current 21k gram price");
  await page.selectOption("#alert-form select[name=karat]", "21");
  await page.fill("#alert-form input[name=price]", "abc");
  await page.click("#alert-form button[type=submit]");
  check(await page.isVisible("text=أدخل سعراً صحيحاً"), "invalid alert price is rejected");
  await page.fill("#alert-form input[name=price]", "٣٢٠"); // Arabic digits, 320 → below
  await page.check("#alert-form input[value=below]", { force: true });
  await page.click("#alert-form button[type=submit]");
  await page.waitForSelector(".toast.alert");
  check((await page.locator(".toast.alert").first().innerText()).includes("عيار 21 أقل من 320.00"), "alert fires immediately with an on-screen notification");
  check(await page.isVisible("text=تحقق ✓"), "alert marked as triggered");
  await page.locator(".toast button").first().click();
  await page.locator(".toast button").first().click().catch(() => {});

  await page.fill("#alert-form input[name=price]", "330");
  await page.check("#alert-form input[value=above]", { force: true });
  await page.click("#alert-form button[type=submit]");
  await page.waitForTimeout(400);
  check((await page.locator(".toast.alert").count()) === 0, "alert whose condition is false does not fire");
  forced = 3200; // 21k ≈ 337.59 > 330
  await refreshFromHome();
  await page.waitForSelector(".toast.alert");
  check((await page.locator(".toast.alert").first().innerText()).includes("أعلى من 330.00"), "alert fires when the price crosses on refresh");
  await refreshFromHome();
  await page.waitForTimeout(700);
  check((await page.locator(".toast.alert").count()) === 1, "a triggered alert does not fire again");
  await shot("02-alerts");
  check((await page.evaluate(() => JSON.parse(localStorage.getItem("gold.alerts")).length)) === 2, "alerts saved in localStorage");
  await page.locator("#alert-list .item").first().locator("text=حذف").click();
  check((await page.locator("#alert-list .item").count()) === 1, "alert deleted");

  // ----------------------------------------------------- purchases --
  forced = 3110.35; // 24k gram = 375 SAR exactly, 21k = 328.125
  await page.click(".tabbar [data-tab=home]");
  await page.click("#refresh");
  await page.waitForFunction(() => document.querySelector("#price-usd").textContent.includes("3,110.35"));
  await page.click(".tabbar [data-tab=buys]");
  await page.fill("#buy-form input[name=date]", "2026-01-15");
  await page.selectOption("#buy-form select[name=karat]", "21");
  await page.fill("#buy-form input[name=weight]", "10");
  await page.fill("#buy-form input[name=paid]", "3000");
  await page.click("#buy-submit");
  await page.waitForSelector("#buy-list .item");
  const item = page.locator("#buy-list .item").first();
  check((await item.innerText()).includes("3,281.25"), "current value = 10 g × 21k gram (3,281.25)");
  check((await item.innerText()).includes("+281.25") && (await item.innerText()).includes("+9.38%"), "profit in SAR and %");
  check((await item.locator(".up").count()) > 0, "profit is green");

  await page.fill("#buy-form input[name=date]", "2026-03-01");
  await page.selectOption("#buy-form select[name=karat]", "24");
  await page.fill("#buy-form input[name=weight]", "5");
  await page.fill("#buy-form input[name=paid]", "2000"); // value 1875 → −125
  await page.click("#buy-submit");
  await page.waitForFunction(() => document.querySelectorAll("#buy-list .item").length === 2);
  check((await page.locator("#sum-paid").innerText()) === "5,000.00", "total paid");
  check((await page.locator("#sum-value").innerText()) === "5,156.25", "total current value");
  check((await page.locator("#sum-pl").innerText()).includes("+156.25") && (await page.locator("#sum-pl").innerText()).includes("+3.13%"), `total P/L (${await page.locator("#sum-pl").innerText()})`);
  check((await page.locator("#buy-list .item").first().locator(".down").count()) > 0, "loss is red");

  // edit the 24k one (newest first) → 6 g
  await page.locator("#buy-list .item").first().locator("text=تعديل").click();
  check((await page.locator("#buy-title").innerText()) === "تعديل عملية الشراء", "edit mode");
  await page.fill("#buy-form input[name=weight]", "6");
  await page.click("#buy-submit");
  await page.waitForTimeout(300);
  check((await page.locator("#buy-list .item").count()) === 2 && (await page.locator("#buy-list .item").first().innerText()).includes("2,250.00"), "edit updated the purchase (6 g × 375 = 2,250)");
  await shot("03-purchases");
  await page.locator("#buy-list .item").first().locator("text=حذف").click();
  check((await page.locator("#buy-list .item").count()) === 1, "purchase deleted");

  // ------------------------------------------------------- offline --
  await page.click(".tabbar [data-tab=home]");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); // ensure the page is controlled by the SW
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.waitForFunction(() => document.querySelector("#price-usd").textContent.includes("$"));
  await page.waitForTimeout(500);
  offline = true;
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForSelector("#price-usd");
  await page.waitForFunction(() => document.querySelector("#status").dataset.state === "offline", null, { timeout: 15000 });
  check((await page.locator("#price-usd").innerText()).includes("3,110.35"), "offline: app loads from cache and shows the last saved price");
  check(await page.isVisible("#offline-banner"), "offline banner visible");
  check(/\d/.test(await page.locator("#updated").innerText()), "offline: shows last update time");
  check((await page.locator("#chart svg path").count()) > 0, "offline: chart drawn from saved data");
  await shot("04-offline");
  offline = false;
  await ctx.setOffline(false);

  // ---------------------------------------------------------- PWA --
  const man = await (await fetch(BASE + "manifest.json")).json();
  check(man.start_url === "./" && man.scope === "./" && man.display === "standalone" && man.dir === "rtl", "manifest uses relative start_url/scope");
  for (const i of man.icons) check((await fetch(new URL(i.src, BASE))).ok, `icon ${i.src} exists`);
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  check(!/(href|src)="\/(?!\/)/.test(html), "no absolute paths in index.html");
  const real = errors.filter((e) => !/ERR_INTERNET_DISCONNECTED/.test(e)); // expected while offline
  check(real.length === 0, `no console errors ${real.join(" | ")}`);

  await browser.close();
  server.close();
  console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll checks passed");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
