// ذهب لايف — background alerts server (Cloudflare Worker + Durable Object).
//
// The app registers its Web Push subscription and syncs its alerts here.
// A cron trigger runs every minute: fetch the gold price, evaluate every
// device's alerts, and push a notification when one fires.
//
// Endpoints (JSON):
//   GET  /health                      → { ok, devices, lastRun }
//   GET  /vapid                       → { publicKey }
//   POST /register   { subscription, tz }           → { id, token }
//   POST /sync       { id, token, alerts, tz }      → { alerts }
//   POST /state      { id, token }                  → { alerts }
//   POST /test       { id, token }                  → { sent }
//   POST /unregister { id, token }                  → { ok }

import { DurableObject } from "cloudflare:workers";
import { evaluate, mergeState, normAlert, MAX_ALERTS } from "./alerts.js";
import { generateVapidKeys, isAllowedEndpoint, sendPush, vapidJwt } from "./webpush.js";

const XAUS_DEFAULT = "https://xaus.com/api/v1";
const MAX_DEVICES = 500;
const MAX_BODY = 32_000;
const MAX_PUSHES_PER_RUN = 40; // stays under the free plan's subrequest limit

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });

function corsHeaders(req, env) {
  const origin = req.headers.get("origin") || "";
  const allowed = String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const ok = allowed.includes(origin) || allowed.includes("*");
  return ok
    ? { "access-control-allow-origin": origin || "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type", "access-control-max-age": "86400", vary: "origin" }
    : { vary: "origin" };
}

const randomId = (bytes = 18) => {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

function validTz(tz) {
  try {
    if (typeof tz !== "string" || tz.length > 60) return "Asia/Riyadh";
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "Asia/Riyadh";
  }
}

async function getJSON(url) {
  const res = await fetch(url, { headers: { accept: "application/json" }, cf: { cacheTtl: 0 } });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
}

export class Hub extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.env = env;
    this.jwtCache = new Map();
  }

  async vapid() {
    let v = await this.ctx.storage.get("vapid");
    if (!v) {
      v = await generateVapidKeys();
      await this.ctx.storage.put("vapid", v);
    }
    return v;
  }

  async getJwt(audience) {
    const hit = this.jwtCache.get(audience);
    if (hit && hit.exp - 3600 > Date.now() / 1000) return hit.jwt;
    const v = await this.vapid();
    const r = await vapidJwt(audience, this.env.VAPID_SUBJECT || "https://example.com/", v.privateJwk);
    this.jwtCache.set(audience, r);
    return r.jwt;
  }

  async device(id, token) {
    if (typeof id !== "string" || typeof token !== "string") return null;
    const d = await this.ctx.storage.get(`dev:${id}`);
    if (!d || d.token !== token) return null;
    return d;
  }

  async push(d, payload) {
    const v = await this.vapid();
    try {
      const r = await sendPush(d.sub, payload, { publicKey: v.publicKey, getJwt: (aud) => this.getJwt(aud) });
      if (r.gone) await this.ctx.storage.delete(`dev:${d.id}`);
      return r;
    } catch (e) {
      return { ok: false, status: 0, error: String(e?.message || e) };
    }
  }

  // ---------------------------------------------------------------- API --
  async handle(path, body) {
    const allowHttp = this.env.ALLOW_HTTP_ENDPOINTS === "1";
    switch (path) {
      case "/vapid":
        return { publicKey: (await this.vapid()).publicKey };

      case "/health": {
        const devices = await this.ctx.storage.list({ prefix: "dev:" });
        return { ok: true, devices: devices.size, lastRun: (await this.ctx.storage.get("lastRun")) || null };
      }

      case "/register": {
        const sub = body?.subscription;
        if (!sub || typeof sub.endpoint !== "string" || !sub.keys?.p256dh || !sub.keys?.auth) return { error: "invalid subscription", status: 400 };
        if (!isAllowedEndpoint(sub.endpoint, allowHttp)) return { error: "unsupported push service", status: 400 };
        const all = await this.ctx.storage.list({ prefix: "dev:" });
        for (const d of all.values()) {
          if (d.sub.endpoint === sub.endpoint) {
            d.sub = { endpoint: sub.endpoint, keys: { p256dh: String(sub.keys.p256dh), auth: String(sub.keys.auth) } };
            d.tz = validTz(body.tz);
            await this.ctx.storage.put(`dev:${d.id}`, d);
            return { id: d.id, token: d.token };
          }
        }
        if (all.size >= MAX_DEVICES) return { error: "server full", status: 503 };
        const d = {
          id: randomId(12),
          token: randomId(24),
          sub: { endpoint: sub.endpoint, keys: { p256dh: String(sub.keys.p256dh), auth: String(sub.keys.auth) } },
          tz: validTz(body.tz),
          alerts: [],
          createdAt: new Date().toISOString(),
        };
        await this.ctx.storage.put(`dev:${d.id}`, d);
        return { id: d.id, token: d.token };
      }

      case "/sync": {
        const d = await this.device(body?.id, body?.token);
        if (!d) return { error: "unknown device", status: 404 };
        const incoming = (Array.isArray(body.alerts) ? body.alerts : []).slice(0, MAX_ALERTS).map(normAlert).filter(Boolean);
        const old = new Map(d.alerts.map((a) => [a.id, a]));
        d.alerts = incoming.map((a) => mergeState(a, old.get(a.id)));
        d.tz = validTz(body.tz ?? d.tz);
        d.seenAt = new Date().toISOString();
        await this.ctx.storage.put(`dev:${d.id}`, d);
        return { alerts: d.alerts };
      }

      case "/state": {
        const d = await this.device(body?.id, body?.token);
        if (!d) return { error: "unknown device", status: 404 };
        return { alerts: d.alerts };
      }

      case "/test": {
        const d = await this.device(body?.id, body?.token);
        if (!d) return { error: "unknown device", status: 404 };
        const r = await this.push(d, { title: "✅ تنبيهات الخلفية تعمل", body: "ستصلك تنبيهات الذهب حتى لو كان التطبيق مغلقاً.", tag: "test" });
        return { sent: r.ok, status: r.status, ...(r.error ? { error: r.error } : {}) };
      }

      case "/unregister": {
        const d = await this.device(body?.id, body?.token);
        if (d) await this.ctx.storage.delete(`dev:${d.id}`);
        return { ok: true };
      }
    }
    return { error: "not found", status: 404 };
  }

  // --------------------------------------------------------------- cron --
  async tick() {
    const all = await this.ctx.storage.list({ prefix: "dev:" });
    const devices = [...all.values()].filter((d) => d.alerts?.some((a) => a.repeat || !a.triggeredAt));
    const run = { at: new Date().toISOString(), devices: devices.length, fired: 0, sent: 0, failed: 0 };
    if (devices.length) {
      const XAUS = this.env.XAUS_BASE || XAUS_DEFAULT;
      const spot = await getJSON(`${XAUS}/spot`);
      const gold = Number(spot.spot_usd_oz ?? spot.xau?.price);
      if (!(gold > 300 && gold < 100_000)) throw new Error("bad gold price");
      const prices = { gold, silver: Number(spot.silver_usd_oz) || NaN, rates: spot.fx_rates || {} };

      let points = null;
      const needsPct = devices.some((d) => d.alerts.some((a) => a.kind === "pct"));
      if (needsPct) {
        const cached = await this.ctx.storage.get("intraday");
        if (cached && Date.now() - cached.at < 5 * 60_000) points = cached.points;
        else {
          try {
            const r = await getJSON(`${XAUS}/intraday?symbol=xau&hours=24`);
            points = (r.points || []).map((p) => ({ t: Number(p.t), p: Number(p.p) })).filter((p) => p.t > 0 && p.p > 0);
            await this.ctx.storage.put("intraday", { at: Date.now(), points });
          } catch {
            points = cached?.points || null;
          }
        }
      }

      const now = new Date();
      for (const d of devices) {
        const notes = [];
        for (const a of d.alerts) {
          const n = evaluate(a, { prices, points, tz: d.tz }, now);
          if (n) notes.push(n);
        }
        if (!notes.length) continue;
        run.fired += notes.length;
        await this.ctx.storage.put(`dev:${d.id}`, d);
        for (const n of notes) {
          if (run.sent + run.failed >= MAX_PUSHES_PER_RUN) break;
          const r = await this.push(d, n);
          r.ok ? run.sent++ : run.failed++;
          if (r.gone) break;
        }
      }
    }
    await this.ctx.storage.put("lastRun", run);
    return run;
  }
}

export default {
  async fetch(req, env) {
    const cors = corsHeaders(req, env);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const url = new URL(req.url);
    const hub = env.HUB.get(env.HUB.idFromName("main"));
    let body = null;
    if (req.method === "POST") {
      const text = await req.text();
      if (text.length > MAX_BODY) return json({ error: "too large" }, 413, cors);
      try {
        body = text ? JSON.parse(text) : {};
      } catch {
        return json({ error: "invalid json" }, 400, cors);
      }
    } else if (req.method !== "GET") {
      return json({ error: "method not allowed" }, 405, cors);
    }
    const getOnly = ["/health", "/vapid"];
    if (getOnly.includes(url.pathname) !== (req.method === "GET")) return json({ error: "method not allowed" }, 405, cors);
    const out = await hub.handle(url.pathname, body);
    const { status = 200, ...data } = out || {};
    return json(data, status, cors);
  },

  async scheduled(_event, env, ctx) {
    const hub = env.HUB.get(env.HUB.idFromName("main"));
    ctx.waitUntil(hub.tick());
  },
};
