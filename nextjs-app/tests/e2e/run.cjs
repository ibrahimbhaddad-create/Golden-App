// Playwright end-to-end scenario. Run via scripts/e2e.sh.
const { chromium, devices } = require("playwright");
const { Client } = require("pg");
const path = require("path");

const BASE = "http://127.0.0.1:3100";
const OUT = process.env.E2E_OUT;
const CRON = process.env.CRON_SECRET;
let failures = 0;

function check(cond, msg) {
  console.log(`${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) failures++;
}

async function login(page, email) {
  await page.goto(`${BASE}/login`);
  await page.fill("#email", email);
  await page.click("text=أرسل رمز الدخول");
  await page.waitForSelector("#code");
  await page.fill("#code", "123456");
  await page.click("button:has-text('دخول')");
  await page.waitForURL(`${BASE}/`);
}

const cron = (auth = `Bearer ${CRON}`) =>
  fetch(`${BASE}/api/cron/tick`, { headers: { authorization: auth } }).then(async (r) => ({ status: r.status, body: await r.json() }));

(async () => {
  const db = new Client({ connectionString: process.env.PGURL });
  await db.connect();
  const browser = await chromium.launch();
  const phone = devices["iPhone 14"];
  const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });

  // ---------------------------------------------------------- cron auth --
  check((await cron("Bearer nope")).status === 401, "cron rejects a wrong secret");
  check((await cron("")).status === 401, "cron rejects a missing secret");

  // -------------------------------------------------- unauthenticated --
  const anon = await browser.newContext(phone);
  const ap = await anon.newPage();
  await ap.goto(`${BASE}/`);
  check(ap.url().startsWith(`${BASE}/login`), "anonymous visitor is redirected to /login");
  const apiAnon = await ap.request.get(`${BASE}/api/price`);
  check(apiAnon.status() === 401, "anonymous /api/price → 401");
  await shot(ap, "01-login");
  await ap.fill("#email", "stranger@example.com");
  await ap.click("text=أرسل رمز الدخول");
  const denied = await ap.waitForSelector("text=لا يوجد حساب بهذا البريد", { timeout: 8000 }).catch(() => null);
  check(!!denied && !(await ap.isVisible("#code")), "uninvited email cannot request a code");

  // -------------------------------------------------------- admin login --
  const adminCtx = await browser.newContext(phone);
  const page = await adminCtx.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(`${page.url()}: ${e.message}`));
  await login(page, "admin@example.com");
  const prof = (await db.query("select role,status from profiles where email='admin@example.com'")).rows[0];
  check(prof?.role === "admin" && prof?.status === "active", "ADMIN_EMAIL first login → active admin");
  check((await db.query("select count(*)::int n from login_events where email='admin@example.com' and success")).rows[0].n === 1, "login recorded in login_events");

  // ---------------------------------------------------------- price tick --
  const t1 = await cron();
  check(t1.status === 200 && t1.body.ok, `cron tick ok (source=${t1.body.tick?.source}, spot=${t1.body.tick?.spot})`);
  await page.goto(`${BASE}/`);
  await page.waitForSelector("text=أسعار العيارات");
  check(await page.isVisible("text=مباشر"), "home shows the live badge");
  check((await page.locator("tbody tr").count()) === 4, "karat table has 4 rows");
  const chartOk = await page.waitForFunction(() => !document.body.innerText.includes("جارٍ التحميل"), null, { timeout: 10000 }).then(() => true).catch(() => false);
  check(chartOk && (await page.locator("canvas").count()) > 0, "our price chart rendered");
  await shot(page, "02-home");

  // ------------------------------------------------------------- alerts --
  await page.goto(`${BASE}/alerts`);
  await page.click("text=+ تنبيه جديد");
  await page.fill("#th", "100"); // ounce above 100 → fires next tick
  await page.click("text=حفظ التنبيه");
  await page.waitForSelector("text=الأونصة أعلى من 100.00 $");
  await page.click("text=+ تنبيه جديد");
  await page.click("text=سعر الغرام");
  await page.selectOption("#karat", "21");
  await page.selectOption("#dir", "below");
  await page.fill("#th", "50"); // 21k below 50 SAR → should NOT fire
  await page.click("text=متكرر");
  await page.click("text=حفظ التنبيه");
  await page.waitForSelector("text=غرام عيار 21 (شراء) أقل من 50.00 ر.س");
  await page.click("text=+ تنبيه جديد");
  await page.click("text=نسبة التغيّر");
  await page.selectOption("#win", "1h");
  await page.fill("#th", "150");
  await page.click("text=حفظ التنبيه");
  check(!!(await page.waitForSelector("text=النسبة يجب أن تكون أقل من 100%", { timeout: 8000 }).catch(() => null)), "validation: % alert must be < 100");
  await page.click("text=إلغاء");

  const t2 = await cron();
  check(t2.body.alerts?.fired?.length === 1, `exactly one alert fired (${JSON.stringify(t2.body.alerts)})`);
  const once = (await db.query("select active, trigger_count from alerts where type='ounce_price'")).rows[0];
  check(once.active === false && once.trigger_count === 1, "one-shot alert deactivated after firing");
  const t3 = await cron();
  check(t3.body.alerts?.fired?.length === 0, "it does not fire again");
  const ev = (await db.query("select title, delivery from alert_events")).rows;
  check(ev.length === 1 && ev[0].title.includes("الأونصة"), "alert_events logged");
  await page.goto(`${BASE}/alerts`);
  check(await page.isVisible("text=سجل التنبيهات"), "alerts page shows history");
  await shot(page, "03-alerts");

  // ------------------------------------------------------- market & calc --
  await page.goto(`${BASE}/market`);
  await page.waitForSelector("text=الإشارة الحالية");
  check(await page.isVisible("text=هذه قراءة فنية آلية وليست نصيحة استثمارية"), "market page shows the disclaimer");
  const label = await page.locator("section div.text-3xl").innerText();
  check(["فرصة شراء محتملة", "محايد", "فرصة بيع محتملة"].includes(label.trim()), `signal label: ${label}`);
  await shot(page, "04-market");

  await page.goto(`${BASE}/calculator`);
  await page.fill("#w", "10");
  await page.click("button:has-text('18')");
  await page.waitForTimeout(300);
  check(await page.isVisible("text=قيمة البيع"), "calculator shows values");
  await shot(page, "05-calculator");

  // ---------------------------------------------------- admin: settings --
  await page.goto(`${BASE}/admin`);
  await page.fill("input[name=usd_sar]", "3.76");
  await page.fill("input[name=making_21]", "22");
  await page.click("form:has(input[name=usd_sar]) button:has-text('حفظ')");
  await page.waitForSelector("text=تم حفظ الإعدادات");
  const s = (await db.query("select usd_sar, karats from settings")).rows[0];
  check(Number(s.usd_sar) === 3.76 && s.karats["21"].making === 22, "admin updated usd_sar and making charge");

  // ------------------------------------------------- admin: link invite --
  await page.uncheck("input[name=auto_approve]");
  await page.click("text=إنشاء الدعوة");
  await page.waitForSelector("text=تم إنشاء رابط الدعوة");
  const link = await page.locator("form input[readonly]").first().inputValue();
  check(/\/invite\/[0-9a-f]{64}$/.test(link), "invite link generated");
  await shot(page, "06-admin");

  // ------------------------------------------------------------ viewer --
  const vCtx = await browser.newContext(phone);
  const vp = await vCtx.newPage();
  await vp.goto(link);
  await vp.fill("#email", "viewer@example.com");
  await vp.click("text=قبول الدعوة");
  await vp.waitForSelector("#code");
  await vp.fill("#code", "123456");
  await vp.click("button:has-text('دخول')");
  const pend = await vp.waitForURL(/\/pending$/, { timeout: 10000 }).then(() => true).catch(() => false);
  check(pend && (await vp.isVisible("text=بانتظار موافقة المشرف")), "invite without auto-approve → pending page");
  await shot(vp, "07-pending");
  const vApi = await vp.request.get(`${BASE}/api/price`);
  check(vApi.status() === 403, "pending user cannot read prices");

  // reuse of a single-use invite fails
  const other = await (await browser.newContext(phone)).newPage();
  await other.goto(link);
  check(await other.isVisible("text=تم استخدام الدعوة بالكامل"), "single-use invite cannot be reused");

  // admin approves
  await page.goto(`${BASE}/admin`);
  await page.locator("li", { hasText: "viewer@example.com" }).locator("button:has-text('موافقة')").click();
  await page.waitForTimeout(800);
  check((await db.query("select status from profiles where email='viewer@example.com'")).rows[0].status === "active", "admin approved the viewer");

  await vp.goto(`${BASE}/`);
  await vp.waitForSelector("text=أسعار العيارات");
  check(!(await vp.isVisible("text=لوحة الأدمن")), "viewer has no admin link");
  await vp.goto(`${BASE}/admin`);
  check(vp.url() === `${BASE}/`, "viewer is bounced from /admin");
  const shop21 = await vp.locator("tbody tr", { hasText: "عيار 21" }).locator("td").last().innerText();
  check(Number(shop21.replace(/,/g, "")) > 0, `viewer sees shop price for 21k (${shop21})`);
  await vp.goto(`${BASE}/alerts`);
  check(!(await vp.isVisible("text=الأونصة أعلى من 100.00")), "viewer does not see the admin's alerts");
  await vp.click("text=+ تنبيه جديد");
  await vp.fill("#th", "99999");
  await vp.click("text=حفظ التنبيه");
  await vp.waitForSelector("text=الأونصة أعلى من 99,999.00 $");
  await vp.goto(`${BASE}/settings`);
  await shot(vp, "08-viewer-settings");

  // push subscription endpoint stores a subscription for this user
  const sub = await vp.request.post(`${BASE}/api/push/subscribe`, {
    data: { endpoint: "https://push.example.com/abc", keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" } },
  });
  check(sub.ok(), "push subscription saved");

  // ------------------------------------------------------ admin suspends --
  await page.goto(`${BASE}/admin`);
  await page.locator("li", { hasText: "viewer@example.com" }).locator("button:has-text('إيقاف')").click();
  await page.waitForTimeout(800);
  await vp.goto(`${BASE}/`);
  await vp.waitForURL(/\/login/);
  check(await vp.isVisible("text=تم إيقاف حسابك"), "suspended viewer is signed out with a message");

  // ------------------------------------------------------- PWA basics --
  const man = await (await fetch(`${BASE}/manifest.webmanifest`)).json();
  check(man.display === "standalone" && man.dir === "rtl" && man.icons.some((i) => i.purpose === "maskable"), "manifest is installable (standalone, rtl, maskable icon)");
  const sw = await fetch(`${BASE}/sw.js`);
  check(sw.ok && (await sw.text()).includes("addEventListener(\"push\""), "service worker served with a push handler");
  const html = await (await fetch(`${BASE}/login`)).text();
  check(html.includes('dir="rtl"') && html.includes("apple-touch-icon"), "html is RTL with apple-touch-icon");

  check(pageErrors.length === 0, `no client-side errors ${pageErrors.join(" | ")}`);
  await browser.close();
  await db.end();
  console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll E2E checks passed");
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
