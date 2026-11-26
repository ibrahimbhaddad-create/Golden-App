// End-to-end test of background alerts: the PWA (emulated iPhone) + the alerts
// worker running locally (wrangler dev) + a fake push service that decrypts
// what the worker sends.
// Usage: (cd worker && npm ci) && node tests/push-e2e.cjs
const { chromium, devices } = require("playwright");
const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { createECDH, randomBytes } = require("crypto");
const ece = require(path.join(__dirname, "../worker/node_modules/http_ece"));

const ROOT = path.resolve(__dirname, "..");
const SUB = "/" + path.basename(ROOT) + "/";
const WPORT = 8797;
const WORKER = `http://127.0.0.1:${WPORT}`;
const OUT = process.env.E2E_OUT || path.join(ROOT, ".e2e-out");
fs.mkdirSync(OUT, { recursive: true });
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png" };

let failures = 0;
const check = (ok, msg) => {
  console.log(`${ok ? "✓" : "✗"} ${msg}`);
  if (!ok) failures++;
};
const listen = (srv) => new Promise((r) => srv.listen(0, "127.0.0.1", () => r(srv.address().port)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // fake push service (decrypts with http_ece)
  const ua = createECDH("prime256v1");
  ua.generateKeys();
  const auth = randomBytes(16);
  const inbox = [];
  const pushSrv = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        inbox.push(JSON.parse(ece.decrypt(Buffer.concat(chunks), { version: "aes128gcm", privateKey: ua, authSecret: auth }).toString()));
      } catch (e) {
        inbox.push({ error: String(e) });
      }
      res.writeHead(201).end();
    });
  });
  const pushPort = await listen(pushSrv);

  // relay to the real xaus.com (workerd in this sandbox has no proxy support)
  const relay = http.createServer(async (req, res) => {
    try {
      const r = await fetch("https://xaus.com/api/v1" + req.url);
      res.writeHead(r.status, { "content-type": "application/json" }).end(await r.text());
    } catch (e) {
      res.writeHead(502).end(String(e));
    }
  });
  const relayPort = await listen(relay);

  // static site, with config.json pointing at the local worker
  const site = http.createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (!u.startsWith(SUB)) return res.writeHead(404).end();
    if (u === SUB + "config.json") return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ pushServer: WORKER }));
    let f = path.join(ROOT, u.slice(SUB.length));
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, "index.html");
    if (!f.startsWith(ROOT) || !fs.existsSync(f)) return res.writeHead(404).end();
    res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" });
    fs.createReadStream(f).pipe(res);
  });
  const sitePort = await listen(site);
  const ORIGIN = `http://127.0.0.1:${sitePort}`;
  const BASE = ORIGIN + SUB;

  const dev = spawn(
    "npx",
    ["wrangler", "dev", "--port", String(WPORT), "--test-scheduled", "--persist-to", ".wrangler/push-e2e",
      "--var", "ALLOW_HTTP_ENDPOINTS:1", "--var", `ALLOWED_ORIGINS:${ORIGIN}`, "--var", `XAUS_BASE:http://127.0.0.1:${relayPort}`],
    { cwd: path.join(ROOT, "worker"), stdio: ["ignore", "pipe", "pipe"], detached: true, env: { ...process.env, WRANGLER_SEND_METRICS: "false" } },
  );
  let log = "";
  dev.stdout.on("data", (d) => (log += d));
  dev.stderr.on("data", (d) => (log += d));
  const health = async () => (await fetch(`${WORKER}/health`)).json();
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${WORKER}/health`)).ok) break;
    } catch {}
    await sleep(1000);
  }

  const browser = await chromium.launch({ channel: "chromium" }); // full Chromium: headless shell denies notifications
  try {
    const ctx = await browser.newContext({ ...devices["iPhone 14"], serviceWorkers: "allow" });
    await ctx.grantPermissions(["notifications"]);
    // Headless Chromium has no real push service: hand the page a subscription
    // that points at our fake push service, with real keys.
    const fakeSub = { endpoint: `http://127.0.0.1:${pushPort}/push/iphone`, keys: { p256dh: ua.getPublicKey("base64url"), auth: auth.toString("base64url") } };
    await ctx.addInitScript((sub) => {
      let current = null;
      const make = (key) => ({
        endpoint: sub.endpoint,
        options: { applicationServerKey: key },
        toJSON: () => ({ endpoint: sub.endpoint, expirationTime: null, keys: sub.keys }),
        unsubscribe: async () => ((current = null), true),
      });
      PushManager.prototype.subscribe = async function (opts) {
        current = make(opts.applicationServerKey.buffer || opts.applicationServerKey);
        return current;
      };
      PushManager.prototype.getSubscription = async () => current;
    }, fakeSub);
    // client sees a LOW gold price so its own check doesn't fire; the worker sees the real one
    await ctx.route("https://xaus.com/**", async (route) => {
      const url = route.request().url();
      const body = await (await fetch(url)).json();
      if (url.includes("/spot")) {
        body.spot_usd_oz = 1000;
        body.xau.price = 1000;
      }
      route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("dialog", (d) => d.accept());

    await page.goto(BASE);
    await page.click(".tabbar [data-tab=settings]");
    await page.waitForSelector("#bg-enable:not([hidden])", { timeout: 8000 }).catch(async () => {
      console.log("bg-status:", await page.locator("#bg-status").innerText(), "| errors:", errors, "| perm:", await page.evaluate(() => Notification.permission));
    });
    check(await page.isVisible("#bg-enable"), "settings offers «تفعيل التنبيهات بالخلفية» when a server is configured");
    await page.click("#bg-enable");
    await page.waitForSelector("text=تم تفعيل التنبيهات بالخلفية");
    check(await page.isVisible("#bg-actions"), "background alerts enabled");
    check((await health()).devices === 1, "device registered on the worker");

    // alert that only the worker's (real) price satisfies
    await page.click(".tabbar [data-tab=alerts]");
    check((await page.locator("#alerts-mode").innerText()).includes("مفعّلة"), "alerts tab says background mode is on");
    await page.selectOption("#alert-form select[name=item]", "g21");
    await page.check("#alert-form input[name=dir][value=above]", { force: true });
    await page.fill("#alert-form input[name=value]", "200");
    await page.click("#alert-form button[type=submit]");
    await sleep(1200); // debounced sync
    check((await page.locator(".toast.alert").count()) === 0, "app (price $1000) does not fire the alert itself");

    await fetch(`${WORKER}/__scheduled?cron=*+*+*+*+*`);
    await sleep(2500);
    const got = inbox.filter((m) => !m.error);
    check(got.length === 1 && got[0].title.includes("عيار 21 أعلى من 200.00 ريال"), `worker pushed the alert (${got.map((m) => m.title).join(" | ") || inbox.map((m) => m.error)})`);

    // app opens later and picks up the firing from the server
    await page.reload();
    await page.click(".tabbar [data-tab=alerts]");
    await page.waitForSelector("text=تحقق ✓", { timeout: 8000 }).catch(() => null);
    check(await page.isVisible("text=تحقق ✓"), "app shows the alert as triggered after reopening");

    // re-arm → server forgets the old trigger, fires again on next run
    inbox.length = 0;
    await page.click("text=إعادة تفعيل");
    await sleep(1200);
    await fetch(`${WORKER}/__scheduled?cron=*+*+*+*+*`);
    await sleep(2500);
    check(inbox.length === 1, "re-armed alert fires again from the worker");

    // service worker shows a system notification for an incoming push
    const cdp = await ctx.newCDPSession(page);
    const regs = [];
    cdp.on("ServiceWorker.workerRegistrationUpdated", (e) => regs.push(...e.registrations));
    await cdp.send("ServiceWorker.enable");
    await sleep(500);
    const reg = regs.find((r) => r.scopeURL.startsWith(BASE));
    if (reg) {
      await cdp.send("ServiceWorker.deliverPushMessage", { origin: ORIGIN, registrationId: reg.registrationId, data: JSON.stringify({ title: "🔔 اختبار الخلفية", body: "نص", tag: "t1" }) });
      await sleep(800);
      const titles = await page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map((n) => n.title));
      check(titles.includes("🔔 اختبار الخلفية"), `service worker displays the push as a notification (${titles.join(", ")})`);
    } else check(false, "service worker registration found");

    // test button + disable
    await page.click(".tabbar [data-tab=settings]");
    inbox.length = 0;
    await page.click("#bg-test");
    await page.waitForSelector("text=أُرسل إشعار تجريبي");
    check(inbox.some((m) => m.title?.includes("تنبيهات الخلفية تعمل")), "test button delivers a push");
    await page.screenshot({ path: path.join(OUT, "push-settings.png"), fullPage: true });
    await page.click("#bg-disable");
    await page.waitForSelector("#bg-enable:not([hidden])");
    check((await health()).devices === 0, "disabling unregisters the device on the worker");
    check(errors.length === 0, `no page errors ${errors.join(" | ")}`);
  } catch (e) {
    console.error(e);
    failures++;
  } finally {
    await browser.close();
    try {
      process.kill(-dev.pid, "SIGTERM");
    } catch {}
    pushSrv.close();
    relay.close();
    site.close();
  }
  if (failures) console.error(log.slice(-2500));
  console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll background-alert checks passed");
  process.exit(failures ? 1 : 0);
})();
