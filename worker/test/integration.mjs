// Integration test: runs the worker locally (wrangler dev), registers a fake
// device whose push endpoint is a local server that decrypts with http_ece,
// then triggers the cron and checks what arrives.
// Usage: node test/integration.mjs   (needs network access to xaus.com)
import { spawn } from "node:child_process";
import http from "node:http";
import { createECDH, randomBytes } from "node:crypto";
import ece from "http_ece";

const PORT = 8799;
const W = `http://127.0.0.1:${PORT}`;
let failures = 0;
const check = (ok, msg) => {
  console.log(`${ok ? "✓" : "✗"} ${msg}`);
  if (!ok) failures++;
};

// fake push service
const ua = createECDH("prime256v1");
ua.generateKeys();
const auth = randomBytes(16);
const inbox = [];
let respond = 201;
const push = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    try {
      const body = Buffer.concat(chunks);
      const msg = JSON.parse(ece.decrypt(body, { version: "aes128gcm", privateKey: ua, authSecret: auth }).toString());
      inbox.push({ headers: req.headers, msg });
    } catch (e) {
      inbox.push({ error: String(e) });
    }
    res.writeHead(respond).end();
  });
});
await new Promise((r) => push.listen(0, "127.0.0.1", r));
const endpoint = `http://127.0.0.1:${push.address().port}/push/device1`;

// local relay to the real xaus.com API (the sandbox's workerd has no proxy support)
const relay = http.createServer(async (req, res) => {
  try {
    const r = await fetch("https://xaus.com/api/v1" + req.url);
    res.writeHead(r.status, { "content-type": "application/json" }).end(await r.text());
  } catch (e) {
    res.writeHead(502).end(String(e));
  }
});
await new Promise((r) => relay.listen(0, "127.0.0.1", r));

const dev = spawn(
  "npx",
  ["wrangler", "dev", "--port", String(PORT), "--test-scheduled", "--var", "ALLOW_HTTP_ENDPOINTS:1", "--var", `XAUS_BASE:http://127.0.0.1:${relay.address().port}`, "--var", "ALLOWED_ORIGINS:https://ibrahimbhaddad-create.github.io", "--persist-to", ".wrangler/test-state"],
  { stdio: ["ignore", "pipe", "pipe"], detached: true, env: { ...process.env, WRANGLER_SEND_METRICS: "false" } },
);
let log = "";
dev.stdout.on("data", (d) => (log += d));
dev.stderr.on("data", (d) => (log += d));
const stop = () => {
  try {
    process.kill(-dev.pid, "SIGTERM"); // whole process group (npx → wrangler → workerd)
  } catch {}
};

try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${W}/health`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  const post = (p, body) => fetch(W + p, { method: "POST", headers: { "content-type": "application/json", origin: "https://ibrahimbhaddad-create.github.io" }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, headers: r.headers, data: await r.json() }));
  const cron = () => fetch(`${W}/__scheduled?cron=*+*+*+*+*`).then((r) => r.text());

  const v = await (await fetch(`${W}/vapid`)).json();
  check(typeof v.publicKey === "string" && v.publicKey.length > 80, "GET /vapid returns a public key");
  const v2 = await (await fetch(`${W}/vapid`)).json();
  check(v2.publicKey === v.publicKey, "VAPID key is stable");

  const bad = await post("/register", { subscription: { endpoint: "https://evil.example.com/x", keys: { p256dh: "a", auth: "b" } } });
  check(bad.status === 400, "rejects non push-service endpoints");

  const sub = { endpoint, keys: { p256dh: ua.getPublicKey("base64url"), auth: auth.toString("base64url") } };
  const reg = await post("/register", { subscription: sub, tz: "Asia/Riyadh" });
  check(reg.status === 200 && reg.data.id && reg.data.token, "register returns id + token");
  check(reg.headers.get("access-control-allow-origin") === "https://ibrahimbhaddad-create.github.io", "CORS allows the app origin");
  const again = await post("/register", { subscription: sub, tz: "Asia/Riyadh" });
  check(again.data.id === reg.data.id, "re-registering the same endpoint reuses the device");
  const { id, token } = reg.data;

  check((await post("/sync", { id, token: "wrong", alerts: [] })).status === 404, "wrong token rejected");

  const alerts = [
    { id: "a1", kind: "gram", item: "g21", dir: "above", value: 1, currency: "SAR", repeat: 0 }, // fires
    { id: "a2", kind: "ounce", metal: "gold", dir: "below", value: 1, repeat: 0 }, // never
    { id: "a3", kind: "gram", item: "g24", dir: "above", value: 1, currency: "JOD", repeat: 60 }, // fires, repeats hourly
    { id: "bad", kind: "nope", value: 1 }, // dropped
  ];
  const s1 = await post("/sync", { id, token, alerts, tz: "Asia/Riyadh" });
  check(s1.status === 200 && s1.data.alerts.length === 3, "sync stores valid alerts only");

  await cron();
  await new Promise((r) => setTimeout(r, 1500));
  const got = inbox.filter((x) => x.msg);
  check(inbox.every((x) => !x.error), `push bodies decrypt correctly ${inbox.filter((x) => x.error).map((x) => x.error)}`);
  check(got.length === 2, `cron sent 2 pushes (${got.map((x) => x.msg.title).join(" | ")})`);
  check(got.some((x) => x.msg.title.includes("عيار 21 أعلى من 1.00 ريال") && /سعر الجرام الآن [\d,]+\.\d\d ريال/.test(x.msg.body)), "gram alert payload (Arabic title/body)");
  check(got.some((x) => x.msg.title.includes("عيار 24") && x.msg.body.includes("دينار")), "JOD alert uses the dinar rate");
  const h = got[0].headers;
  check(h["content-encoding"] === "aes128gcm" && /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/.test(h.authorization) && h.ttl === "86400", "push headers (aes128gcm, VAPID, TTL)");

  const st = await post("/state", { id, token });
  const a1 = st.data.alerts.find((a) => a.id === "a1");
  check(a1.triggeredAt && a1.count === 1, "state: one-shot alert marked triggered");

  inbox.length = 0;
  await cron();
  await new Promise((r) => setTimeout(r, 1000));
  check(inbox.length === 0, "second run: one-shot done, repeating alert in cooldown → no pushes");

  // device re-arms a1 → server must not resurrect the old trigger
  const rearmed = st.data.alerts.map((a) => (a.id === "a1" ? { ...a, triggeredAt: null, lastFiredAt: null, triggeredValue: null, rearmedAt: new Date().toISOString() } : a));
  const s2 = await post("/sync", { id, token, alerts: rearmed });
  check(!s2.data.alerts.find((a) => a.id === "a1").triggeredAt, "re-arm from the device is respected");
  // stale device copy (no firing info) must not erase a newer server firing
  const stale = await post("/sync", { id, token, alerts: alerts.slice(0, 3) });
  check(stale.data.alerts.find((a) => a.id === "a3").count === 1, "stale sync keeps the server's firing state");

  inbox.length = 0;
  const t = await post("/test", { id, token });
  await new Promise((r) => setTimeout(r, 500));
  check(t.data.sent === true && inbox[0]?.msg?.title.includes("تنبيهات الخلفية تعمل"), "POST /test delivers a test notification");

  // dead subscription → device removed
  respond = 410;
  await post("/sync", { id, token, alerts: [{ id: "z", kind: "gram", item: "g18", dir: "above", value: 1, currency: "SAR", repeat: 0 }] });
  await cron();
  await new Promise((r) => setTimeout(r, 1000));
  check((await post("/state", { id, token })).status === 404, "410 Gone from the push service removes the device");
  const health = await (await fetch(`${W}/health`)).json();
  check(health.ok && health.lastRun && typeof health.devices === "number", `health: ${JSON.stringify(health.lastRun)}`);
} catch (e) {
  console.error(e);
  console.error(log.slice(-3000));
  failures++;
} finally {
  stop();
  push.close();
  relay.close();
}
if (failures) console.error(log.slice(-2000));
console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll worker integration checks passed");
process.exit(failures ? 1 : 0);
