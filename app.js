/* ذهب لايف — vanilla JS, no build step. */
(() => {
  "use strict";

  // ------------------------------------------------------------ config --
  const API = "https://xaus.com/api/v1";
  const API_SPOT = `${API}/spot`;
  const API_INTRADAY = `${API}/intraday?symbol=xau&hours=48`;
  const API_HISTORY = `${API}/history`;
  const USD_SAR = 3.75; // fixed peg
  const OZ = 31.1035; // grams per troy ounce
  const REFRESH_MS = 30_000;
  const SERIES_REFRESH_MS = 5 * 60_000;
  const HISTORY_MAX_AGE_MS = 6 * 3600_000;
  const KEYS = {
    last: "gold.last",
    series: "gold.series",
    history: "gold.history",
    alerts: "gold.alerts",
    buys: "gold.buys",
    tab: "gold.tab",
    settings: "gold.settings",
    tf: "gold.tf",
    histUnit: "gold.histUnit",
    push: "gold.push",
    config: "gold.config",
    factor: "gold.factor",
    kl: "gold.kl",
  };

  const ITEMS = [
    { id: "g24", metal: "gold", label: "عيار 24", purity: 24 / 24 },
    { id: "g22", metal: "gold", label: "عيار 22", purity: 22 / 24 },
    { id: "g21", metal: "gold", label: "عيار 21", purity: 21 / 24 },
    { id: "g18", metal: "gold", label: "عيار 18", purity: 18 / 24 },
    { id: "s999", metal: "silver", label: "فضة 999", purity: 0.999 },
    { id: "s925", metal: "silver", label: "فضة 925", purity: 0.925 },
  ];
  const ITEM = Object.fromEntries(ITEMS.map((i) => [i.id, i]));
  const METAL_NAME = { gold: "الذهب", silver: "الفضة" };

  const CURRENCIES = [
    { code: "SAR", name: "ريال سعودي", unit: "ريال" },
    { code: "AED", name: "درهم إماراتي", unit: "درهم" },
    { code: "KWD", name: "دينار كويتي", unit: "د.ك" },
    { code: "QAR", name: "ريال قطري", unit: "ر.ق" },
    { code: "BHD", name: "دينار بحريني", unit: "د.ب" },
    { code: "OMR", name: "ريال عماني", unit: "ر.ع" },
    { code: "JOD", name: "دينار أردني", unit: "دينار" },
    { code: "IQD", name: "دينار عراقي", unit: "د.ع", digits: 0 },
    { code: "EGP", name: "جنيه مصري", unit: "جنيه" },
    { code: "USD", name: "دولار أمريكي", unit: "دولار" },
    { code: "EUR", name: "يورو", unit: "يورو" },
    { code: "GBP", name: "جنيه إسترليني", unit: "إسترليني" },
    { code: "TRY", name: "ليرة تركية", unit: "ليرة" },
  ];
  const CUR = Object.fromEntries(CURRENCIES.map((c) => [c.code, c]));

  const DEFAULT_SETTINGS = {
    currency: "SAR",
    making: { SAR: { g24: 0, g22: 15, g21: 20, g18: 25, s999: 1, s925: 3 } },
    vatOn: true,
    vatRate: 15,
  };

  // ----------------------------------------------------------- helpers --
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const nf = {};
  const numFmt = (d) => (nf[d] ??= new Intl.NumberFormat("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));
  const fmt0 = numFmt(0);
  const fmtW = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });
  const money = (v, d = 2) => (Number.isFinite(v) ? numFmt(d).format(v) : "—");
  const curDigits = (c) => CUR[c]?.digits ?? 2;
  const cm = (v, c) => money(v, curDigits(c)); // money in a currency
  const signed = (v, suffix = "", d = 2) =>
    Number.isFinite(v) ? `${v > 0 ? "+" : v < 0 ? "−" : ""}${numFmt(d).format(Math.abs(v))}${suffix}` : "—";
  const unitOf = (c) => CUR[c]?.unit ?? c;
  const ar = "ar-SA-u-nu-latn-ca-gregory";
  const timeFmt = new Intl.DateTimeFormat(ar, { hour: "numeric", minute: "2-digit" });
  const hourFmt = new Intl.DateTimeFormat(ar, { hour: "numeric" });
  const dayHourFmt = new Intl.DateTimeFormat(ar, { weekday: "short", hour: "numeric", minute: "2-digit" });
  const dateTimeFmt = new Intl.DateTimeFormat(ar, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  const dateFmt = new Intl.DateTimeFormat(ar, { year: "numeric", month: "short", day: "numeric" });
  const dayMonFmt = new Intl.DateTimeFormat(ar, { day: "numeric", month: "short" });
  const monYearFmt = new Intl.DateTimeFormat(ar, { month: "short", year: "2-digit" });
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const today = () => new Date().toLocaleDateString("en-CA");

  /** Arabic/Persian digits and separators → number (NaN if invalid). */
  function parseNum(raw) {
    const s = String(raw ?? "")
      .trim()
      .replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d))
      .replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d))
      .replace(/[٫,]/g, ".")
      .replace(/[\s٬']/g, "");
    if (!/^\d*\.?\d+$/.test(s)) return NaN;
    return Number(s);
  }

  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem(key);
        return v == null ? fallback : JSON.parse(v);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* storage full or blocked: keep working in memory */
      }
    },
  };

  /** DOM builder: text is never parsed as HTML. */
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
    return el;
  }

  // ------------------------------------------------- data normalisation --
  const isNum = (v) => typeof v === "number" && Number.isFinite(v);
  const posNum = (v) => (isNum(Number(v)) && Number(v) > 0 ? Number(v) : null);
  const curOk = (c) => (CUR[c] ? c : "SAR");
  const dateOk = (d) => (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);

  function normSettings(s) {
    const out = structuredClone(DEFAULT_SETTINGS);
    if (!s || typeof s !== "object") return out;
    out.currency = curOk(s.currency);
    if (s.making && typeof s.making === "object") {
      for (const [c, m] of Object.entries(s.making)) {
        if (!CUR[c] || !m || typeof m !== "object") continue;
        out.making[c] = {};
        for (const i of ITEMS) out.making[c][i.id] = Math.max(0, Number(m[i.id]) || 0);
      }
    }
    out.vatOn = s.vatOn !== false;
    const r = Number(s.vatRate);
    out.vatRate = isNum(r) && r >= 0 && r <= 50 ? r : 15;
    return out;
  }

  function normAlert(a) {
    if (!a || typeof a !== "object") return null;
    // v1 format: { karat, dir, price }
    if (a.karat && a.price != null && !a.kind) {
      a = { ...a, kind: "gram", item: `g${a.karat}`, value: a.price, currency: "SAR", repeat: 0 };
    }
    const kind = ["gram", "ounce", "pct"].includes(a.kind) ? a.kind : null;
    const value = posNum(a.value);
    if (!kind || !value) return null;
    if (kind === "gram" && !ITEM[a.item]) return null;
    if (kind === "pct" && value >= 100) return null;
    return {
      id: typeof a.id === "string" ? a.id : uid(),
      kind,
      item: kind === "gram" ? a.item : null,
      metal: kind === "ounce" ? (a.metal === "silver" ? "silver" : "gold") : kind === "pct" ? "gold" : ITEM[a.item].metal,
      dir: a.dir === "below" ? "below" : "above",
      value,
      currency: kind === "gram" ? curOk(a.currency) : "USD",
      repeat: [0, 15, 60, 180, 1440].includes(Number(a.repeat)) ? Number(a.repeat) : 0,
      createdAt: a.createdAt || new Date().toISOString(),
      triggeredAt: a.triggeredAt || null,
      triggeredValue: isNum(a.triggeredValue) ? a.triggeredValue : null,
      lastFiredAt: a.lastFiredAt || null,
      rearmedAt: a.rearmedAt || null,
      count: Number(a.count) || 0,
    };
  }

  function normBuy(b) {
    if (!b || typeof b !== "object") return null;
    const item = ITEM[b.item] ? b.item : b.karat ? `g${b.karat}` : null; // v1 had karat
    const weight = posNum(b.weight);
    const paid = posNum(b.paid);
    if (!item || !ITEM[item] || !weight || !paid) return null;
    const sold = b.sold && posNum(b.sold.price) ? { date: dateOk(b.sold.date) || today(), price: Number(b.sold.price) } : null;
    return {
      id: typeof b.id === "string" ? b.id : uid(),
      date: dateOk(b.date) || today(),
      item,
      weight,
      paid,
      currency: curOk(b.currency),
      note: typeof b.note === "string" ? b.note.slice(0, 80) : "",
      sold,
      createdAt: b.createdAt || new Date().toISOString(),
    };
  }

  // -------------------------------------------------------------- state --
  const state = {
    last: store.get(KEYS.last, null), // { price, silver, rates, asOf, fetchedAt }
    series: store.get(KEYS.series, []), // intraday [{t,p}] (5-minute samples, ≤48h)
    history: store.get(KEYS.history, null), // { fetchedAt, days: [[d,c,h,l]], high_52w, low_52w, return_ytd_pct, return_1y_pct }
    alerts: store.get(KEYS.alerts, []).map(normAlert).filter(Boolean),
    buys: store.get(KEYS.buys, []).map(normBuy).filter(Boolean),
    settings: normSettings(store.get(KEYS.settings, null)),
    tf: store.get(KEYS.tf, "1h"),
    histUnit: store.get(KEYS.histUnit, "oz"),
    histRows: 24,
    online: true,
    loading: false,
    seriesFetchedAt: 0,
    editCurrency: null,
    push: store.get(KEYS.push, null), // { server, id, token }
    pushServer: store.get(KEYS.config, {})?.pushServer || "",
  };
  if (!["1s", "1m", "5m", "15m", "1h", "4h", "1d", "1w"].includes(state.tf)) state.tf = "1m";

  const saveSettings = () => store.set(KEYS.settings, state.settings);
  const saveAlerts = () => store.set(KEYS.alerts, state.alerts);
  const saveBuys = () => store.set(KEYS.buys, state.buys);

  // ------------------------------------------------------------ pricing --
  function rate(c) {
    if (c === "USD") return 1;
    if (c === "SAR") return USD_SAR;
    const r = Number(state.last?.rates?.[c]);
    return r > 0 ? r : NaN;
  }
  const convert = (amount, from, to) => (from === to ? amount : (amount / rate(from)) * rate(to));
  const ounceUsd = (metal) => Number(metal === "silver" ? state.last?.silver : state.last?.price) || NaN;
  const gramPrice = (itemId, c = state.settings.currency) => {
    const it = ITEM[itemId];
    return (ounceUsd(it.metal) / OZ) * it.purity * rate(c);
  };
  function makingFor(itemId, c = state.settings.currency) {
    const m = state.settings.making[c];
    if (m && isNum(m[itemId])) return m[itemId];
    const sar = state.settings.making.SAR?.[itemId] ?? 0;
    const v = convert(sar, "SAR", c);
    return Number.isFinite(v) ? v : 0;
  }
  const vatFactor = () => (state.settings.vatOn ? 1 + state.settings.vatRate / 100 : 1);
  const shopPrice = (itemId, c = state.settings.currency) => (gramPrice(itemId, c) + makingFor(itemId, c)) * vatFactor();

  // ------------------------------------------------------------ network --
  async function getJSON(url, { timeout = 12_000, retries = 1 } = {}) {
    let lastErr;
    for (let i = 0; i <= retries; i++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeout);
      try {
        const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
      } catch (e) {
        lastErr = e;
        if (i < retries) await new Promise((r) => setTimeout(r, 800 * (i + 1)));
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr;
  }

  async function refreshSpot() {
    try {
      const d = await getJSON(API_SPOT);
      const price = Number(d?.spot_usd_oz ?? d?.xau?.price);
      if (!Number.isFinite(price) || price < 300 || price > 100_000) throw new Error("bad price");
      const silver = Number(d.silver_usd_oz);
      const rates = {};
      for (const c of CURRENCIES) {
        const r = Number(d.fx_rates?.[c.code]);
        if (r > 0) rates[c.code] = r;
      }
      const prev = state.last?.price;
      state.officialSpot = price;
      calibrate(price, d);
      state.last = {
        price: liveActive() ? liveSpot() : price,
        silver: silver > 1 && silver < 2000 ? silver : state.last?.silver ?? null,
        rates: Object.keys(rates).length ? rates : state.last?.rates ?? {},
        asOf: d.price_as_of || d.updated_at || new Date().toISOString(),
        fetchedAt: new Date().toISOString(),
        live: liveActive(),
      };
      state.online = true;
      store.set(KEYS.last, state.last);
      renderPrices(prev);
      checkAlerts();
      renderBuys();
      renderAlertHint();
      renderCalc();
    } catch {
      state.online = false;
      renderPrices();
    }
    renderStatus();
  }

  async function refreshSeries(force = false) {
    if (!force && Date.now() - state.seriesFetchedAt < SERIES_REFRESH_MS) return;
    try {
      const d = await getJSON(API_INTRADAY);
      const pts = (d?.points || [])
        .map((x) => ({ t: Number(x.t), p: Number(x.p) }))
        .filter((x) => Number.isFinite(x.t) && x.p > 0)
        .sort((a, b) => a.t - b.t);
      if (pts.length) {
        state.series = pts;
        state.seriesFetchedAt = Date.now();
        store.set(KEYS.series, pts);
      }
    } catch {
      /* keep cached */
    }
    renderChange();
    renderChart();
    renderHistoryTable();
    checkAlerts();
  }

  async function refreshHistory(force = false) {
    const age = Date.now() - (state.history?.fetchedAt || 0);
    if (!force && age < HISTORY_MAX_AGE_MS) return;
    try {
      const d = await getJSON(API_HISTORY, { timeout: 20_000 });
      const days = (d?.points || [])
        .filter((x) => dateOk(x.d) && Number(x.c) > 0)
        .map((x) => [x.d, Number(x.c), Number(x.h) || Number(x.c), Number(x.l) || Number(x.c)]);
      if (days.length) {
        state.history = {
          fetchedAt: Date.now(),
          days,
          high_52w: Number(d.high_52w) || null,
          low_52w: Number(d.low_52w) || null,
          return_ytd_pct: isNum(d.return_ytd_pct) ? d.return_ytd_pct : null,
          return_1y_pct: isNum(d.return_1y_pct) ? d.return_1y_pct : null,
        };
        store.set(KEYS.history, state.history);
      }
    } catch {
      /* keep cached */
    }
    if (state.tf === "1d" || state.tf === "1w") {
      renderChart();
      renderHistoryTable();
    }
  }

  async function refreshAll(force = false) {
    if (state.loading) return;
    state.loading = true;
    $("#refresh").classList.add("spinning");
    await Promise.all([refreshSpot(), refreshSeries(force), refreshHistory(false)]);
    state.loading = false;
    $("#refresh").classList.remove("spinning");
  }

  // ------------------------------------------------------------ candles --
  /** Candles from 5-minute samples, buckets aligned to local midnight. */
  function intradayCandles(hours) {
    const pts = state.series.slice();
    const live = state.last;
    if (live && pts.length) {
      const t = Math.floor(new Date(live.fetchedAt || live.asOf).getTime() / 1000);
      if (t > pts[pts.length - 1].t) pts.push({ t, p: live.price });
    }
    const size = hours * 3600;
    const off = -new Date().getTimezoneOffset() * 60; // local offset (s)
    const out = [];
    for (const { t, p } of pts) {
      const b = Math.floor((t + off) / size) * size - off;
      const c = out[out.length - 1];
      if (!c || c.t !== b) out.push({ t: b, o: p, h: p, l: p, c: p });
      else {
        c.h = Math.max(c.h, p);
        c.l = Math.min(c.l, p);
        c.c = p;
      }
    }
    return out;
  }

  // ------------------------------------------------------- live stream --
  // Tick-by-tick price from gold-backed tokens (XAUT, PAXG — 1 token = 1 oz)
  // on Binance's public market-data feed, scaled to the global spot price
  // measured from xaus.com. Falls back to xaus.com polling if unavailable.
  const BINANCE_REST = "https://data-api.binance.vision/api/v3";
  const BINANCE_WS = "wss://data-stream.binance.vision/stream?streams=xautusdt@trade/paxgusdt@trade";
  const TOKENS = ["XAUTUSDT", "PAXGUSDT"];
  const KLINE_SYMBOL = "XAUTUSDT";
  const LIVE_TF = {
    "1s": { iv: "1s", sec: 1, limit: 300 },
    "1m": { iv: "1m", sec: 60, limit: 300 },
    "5m": { iv: "5m", sec: 300, limit: 300 },
    "15m": { iv: "15m", sec: 900, limit: 300 },
    "1h": { iv: "1h", sec: 3600, limit: 300 },
    "4h": { iv: "4h", sec: 14400, limit: 300 },
  };
  const live = {
    ws: null,
    open: false,
    retry: 0,
    timer: null,
    px: {}, // symbol -> { p, t }
    factor: store.get(KEYS.factor, {}), // symbol -> spot / token price
    kl: Object.fromEntries(Object.entries(store.get(KEYS.kl, {})).filter(([k, v]) => LIVE_TF[k] && Array.isArray(v))),
    klAt: {},
    klFailed: false,
    renderTimer: null,
    lastSlow: 0,
    lastSave: 0,
  };

  /** Spot gold trading hours (New York): Sun 18:00 → Fri 17:00, daily break 17:00–18:00. */
  function marketOpen(d = new Date()) {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23" })
        .formatToParts(d)
        .map((x) => [x.type, x.value]),
    );
    const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
    const mins = Number(p.hour) * 60 + Number(p.minute);
    if (wd === 6) return false;
    if (wd === 5 && mins >= 17 * 60) return false;
    if (wd === 0 && mins < 18 * 60) return false;
    if (wd >= 1 && wd <= 4 && mins >= 17 * 60 && mins < 18 * 60) return false;
    return true;
  }

  const fresh = (x, ms) => x && Date.now() - x.t < ms;
  function liveSpot() {
    let sum = 0;
    let n = 0;
    for (const s of TOKENS) {
      const x = live.px[s];
      const f = live.factor[s];
      if (fresh(x, 5 * 60_000) && f) {
        sum += x.p * f;
        n++;
      }
    }
    return n ? sum / n : null;
  }
  const liveActive = () => live.open && marketOpen() && liveSpot() != null && TOKENS.some((s) => fresh(live.px[s], 120_000));

  /** Update token → spot factors from an official spot quote (smoothed). */
  function calibrate(spot, d) {
    const open = marketOpen();
    for (const s of TOKENS) {
      if (!open && live.factor[s]) continue; // spot is frozen while the market is closed
      const tok = fresh(live.px[s], 120_000) ? live.px[s].p : Number(s === "XAUTUSDT" ? d?.xaut_usd : d?.paxg_usd);
      if (!(tok > 0)) continue;
      const f = spot / tok;
      if (f < 0.95 || f > 1.05) continue; // ignore broken quotes
      live.factor[s] = live.factor[s] ? live.factor[s] * 0.7 + f * 0.3 : f;
    }
    store.set(KEYS.factor, live.factor);
  }

  function connectLive() {
    if (!("WebSocket" in window) || live.ws || document.visibilityState === "hidden") return;
    let ws;
    try {
      ws = new WebSocket(BINANCE_WS);
    } catch {
      return;
    }
    live.ws = ws;
    ws.onopen = () => {
      live.open = true;
      live.retry = 0;
      renderStatus();
    };
    ws.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data)?.data;
        if (d?.e === "trade") onTrade(d.s, Number(d.p), Number(d.T));
      } catch {
        /* ignore malformed frames */
      }
    };
    ws.onclose = () => {
      live.open = false;
      live.ws = null;
      renderStatus();
      if (document.visibilityState === "visible") {
        clearTimeout(live.timer);
        live.timer = setTimeout(connectLive, Math.min(30_000, 1000 * 2 ** live.retry++));
      }
    };
    ws.onerror = () => ws.close();
  }

  function disconnectLive() {
    clearTimeout(live.timer);
    if (live.ws) {
      const ws = live.ws;
      live.ws = null;
      ws.onclose = null;
      ws.close();
    }
    live.open = false;
  }

  function onTrade(sym, p, t) {
    if (!TOKENS.includes(sym) || !(p > 0) || !(t > 0)) return;
    live.px[sym] = { p, t };
    if (sym === KLINE_SYMBOL) {
      for (const [tf, arr] of Object.entries(live.kl)) {
        if (!arr.length) continue;
        const sec = LIVE_TF[tf].sec;
        const b = Math.floor(t / 1000 / sec) * sec;
        const last = arr[arr.length - 1];
        if (b === last.t) {
          last.h = Math.max(last.h, p);
          last.l = Math.min(last.l, p);
          last.c = p;
        } else if (b > last.t) {
          arr.push({ t: b, o: p, h: p, l: p, c: p });
          if (arr.length > 1200) arr.splice(0, arr.length - 1000);
        }
      }
    }
    scheduleLiveRender();
  }

  function scheduleLiveRender() {
    if (live.renderTimer) return;
    live.renderTimer = setTimeout(() => {
      live.renderTimer = null;
      if (document.visibilityState === "hidden") return;
      if (liveActive()) {
        const prev = state.last?.price;
        state.last = { ...(state.last || {}), price: liveSpot(), fetchedAt: new Date().toISOString(), live: true };
        renderPrices(prev);
        checkAlerts();
        const now = Date.now();
        if (now - live.lastSlow > 2000) {
          live.lastSlow = now;
          renderBuys();
          renderAlertHint();
          renderCalc();
          renderStatus();
        }
        if (now - live.lastSave > 10_000) {
          live.lastSave = now;
          store.set(KEYS.last, state.last);
        }
      } else if (LIVE_TF[state.tf]) {
        renderChart();
        renderHistoryTable();
      }
    }, 300);
  }

  async function fetchKlines(tf, force = false) {
    const cfg = LIVE_TF[tf];
    if (!cfg) return;
    const maxAge = tf === "1s" ? 30_000 : 120_000;
    if (!force && live.kl[tf]?.length && Date.now() - (live.klAt[tf] || 0) < maxAge) return;
    try {
      const rows = await getJSON(`${BINANCE_REST}/klines?symbol=${KLINE_SYMBOL}&interval=${cfg.iv}&limit=${cfg.limit}`, { timeout: 10_000, retries: 1 });
      const cs = rows.map((k) => ({ t: k[0] / 1000, o: +k[1], h: +k[2], l: +k[3], c: +k[4] })).filter((k) => k.o > 0 && k.c > 0);
      if (cs.length) {
        live.kl[tf] = cs;
        live.klAt[tf] = Date.now();
        live.klFailed = false;
        const keep = Object.fromEntries(Object.entries(live.kl).filter(([k]) => k !== "1s").map(([k, v]) => [k, v.slice(-300)]));
        store.set(KEYS.kl, keep);
      }
    } catch {
      live.klFailed = true;
    }
    if (state.tf === tf) {
      renderChart();
      renderHistoryTable();
    }
  }

  /** Live-timeframe candles scaled to spot; xaus.com 5-minute samples as fallback. */
  function liveCandles(tf) {
    const raw = live.kl[tf] || [];
    const f = live.factor[KLINE_SYMBOL] || 1;
    if (raw.length) return raw.map((k) => ({ t: k.t, o: k.o * f, h: k.h * f, l: k.l * f, c: k.c * f }));
    const sec = LIVE_TF[tf].sec;
    return sec >= 300 ? intradayCandles(sec / 3600) : [];
  }

  /** Daily candles (open = previous close), today's candle updated with the live price. */
  function dailyCandles() {
    const days = state.history?.days || [];
    const out = [];
    let prevClose = null;
    for (const [d, c, hi, lo] of days) {
      const o = prevClose ?? c;
      out.push({ t: Date.parse(d + "T12:00:00Z") / 1000, d, o, h: Math.max(hi, o, c), l: Math.min(lo, o, c), c });
      prevClose = c;
    }
    const live = state.last?.price;
    if (live && out.length) {
      const todayUtc = new Date().toISOString().slice(0, 10);
      const last = out[out.length - 1];
      const weekend = [0, 6].includes(new Date().getUTCDay());
      // today's candle — or, over the weekend, Friday's candle closes at the latest official price
      if (last.d === todayUtc || (weekend && last.d < todayUtc)) {
        last.c = live;
        last.h = Math.max(last.h, live);
        last.l = Math.min(last.l, live);
      } else if (last.d < todayUtc) {
        out.push({ t: Date.parse(todayUtc + "T12:00:00Z") / 1000, d: todayUtc, o: last.c, h: Math.max(last.c, live), l: Math.min(last.c, live), c: live });
      }
    }
    return out;
  }

  /** Weekly candles from daily (weeks start Monday). */
  function weeklyCandles() {
    const out = [];
    for (const k of dailyCandles()) {
      const dt = new Date(k.t * 1000);
      const monday = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7), 12));
      const t = monday.getTime() / 1000;
      const c = out[out.length - 1];
      if (!c || c.t !== t) out.push({ t, o: k.o, h: k.h, l: k.l, c: k.c });
      else {
        c.h = Math.max(c.h, k.h);
        c.l = Math.min(c.l, k.l);
        c.c = k.c;
      }
    }
    return out;
  }

  const hm = (t) => {
    const d = new Date(t * 1000);
    return `${d.getDate()}/${d.getMonth() + 1} ${hourFmt.format(d)}`;
  };
  const dm = (t) => {
    const d = new Date(t * 1000);
    const y = d.getUTCFullYear();
    return `${d.getUTCDate()}/${d.getUTCMonth() + 1}` + (y !== new Date().getFullYear() ? `/${String(y).slice(2)}` : "");
  };
  const secFmt = new Intl.DateTimeFormat(ar, { hour: "numeric", minute: "2-digit", second: "2-digit" });
  const dhm = (t) => {
    const d = new Date(t * 1000);
    return `${d.getDate()}/${d.getMonth() + 1} ${timeFmt.format(d)}`;
  };
  const tsec = (t) => secFmt.format(new Date(t * 1000));
  const tmin = (t) => timeFmt.format(new Date(t * 1000));
  const TF = {
    "1s": { name: "ثانية", candles: () => liveCandles("1s"), show: 120, label: tsec, tip: tsec, row: tsec },
    "1m": { name: "دقيقة", candles: () => liveCandles("1m"), show: 90, label: tmin, tip: dhm, row: tmin },
    "5m": { name: "5 دقائق", candles: () => liveCandles("5m"), show: 96, label: tmin, tip: dhm, row: dhm },
    "15m": { name: "15 دقيقة", candles: () => liveCandles("15m"), show: 96, label: dhm, tip: dhm, row: dhm },
    "1h": { name: "ساعة", candles: () => liveCandles("1h"), show: 72, label: hm, tip: (t) => dayHourFmt.format(new Date(t * 1000)), row: dhm },
    "4h": { name: "4 ساعات", candles: () => liveCandles("4h"), show: 60, label: hm, tip: (t) => dayHourFmt.format(new Date(t * 1000)), row: dhm },
    "1d": { name: "يوم", candles: dailyCandles, show: 60, label: (t) => dayMonFmt.format(new Date(t * 1000)), tip: (t) => dateFmt.format(new Date(t * 1000)), row: dm },
    "1w": { name: "أسبوع", candles: weeklyCandles, show: 52, label: (t) => monYearFmt.format(new Date(t * 1000)), tip: (t) => "أسبوع " + dateFmt.format(new Date(t * 1000)), row: dm },
  };
  function sourceNote(tf) {
    if (!LIVE_TF[tf]) return "السعر العالمي من xaus.com — حتى 5 سنوات.";
    if (!live.kl[tf]?.length) return LIVE_TF[tf].sec >= 300 ? "البث المباشر غير متاح الآن؛ الشموع من السعر العالمي كل 5 دقائق (آخر 48 ساعة)." : "";
    return `لحظي من تداول XAUT (كل وحدة = أونصة ذهب) على Binance، معدّل على السعر العالمي.${marketOpen() ? "" : " السوق العالمي مغلق الآن، فالحركة من تداول XAUT فقط والسعر الرسمي ثابت على الإغلاق."}`;
  }

  // -------------------------------------------------------------- home --
  function renderCurrencyNames() {
    const c = state.settings.currency;
    $$(".cur-name").forEach((el) => (el.textContent = unitOf(c)));
  }

  function renderPrices(prev) {
    const last = state.last;
    const c = state.settings.currency;
    const big = $("#price-usd");
    renderCurrencyNames();
    if (!last) {
      big.textContent = "—";
      $("#price-local").textContent = "—";
      $("#updated").textContent = state.online ? "…" : "لا توجد بيانات محفوظة";
    } else {
      big.textContent = "$" + money(last.price);
      if (prev != null && prev !== last.price) {
        big.classList.remove("flash-up", "flash-down");
        void big.offsetWidth;
        big.classList.add(last.price > prev ? "flash-up" : "flash-down");
      }
      $("#price-local").textContent = cm(last.price * rate(c), c);
      const asOf = new Date(last.fetchedAt || last.asOf);
      const sameDay = asOf.toDateString() === new Date().toDateString();
      $("#updated").textContent = (sameDay ? timeFmt : dateTimeFmt).format(asOf);
    }
    const hasMaking = ITEMS.some((i) => makingFor(i.id) > 0) || state.settings.vatOn;
    const card = (it) =>
      h(
        "div",
        { class: "karat" },
        h("span", { class: "k" }, it.label),
        h("span", { class: "v num" }, cm(gramPrice(it.id), c)),
        hasMaking ? h("span", { class: "shop" }, "في المحل ≈ ", h("b", { class: "num" }, cm(shopPrice(it.id), c))) : null,
      );
    $("#gold-grams").replaceChildren(...ITEMS.filter((i) => i.metal === "gold").map(card));
    $("#silver-grams").replaceChildren(...ITEMS.filter((i) => i.metal === "silver").map(card));
    $("#silver-usd").textContent = "$" + money(ounceUsd("silver"));
    $("#silver-local").textContent = cm(ounceUsd("silver") * rate(c), c);
    $("#shop-note").textContent = hasMaking
      ? `«في المحل» تقدير = السعر العالمي + المصنعية${state.settings.vatOn ? ` + ضريبة ${state.settings.vatRate}%` : ""}. عدّل المصنعية من الإعدادات.`
      : "";
    renderChange();
    renderChart();
    renderHistoryTable();
  }

  /** Gold change since the first sample after local midnight (falls back to 24h). */
  function dayChange() {
    const price = state.last?.price;
    const pts = state.series;
    if (!price || !pts.length) return null;
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    const cut = midnight.getTime() / 1000;
    const open = pts.find((x) => x.t >= cut);
    const ref = open ?? pts.find((x) => x.t >= Date.now() / 1000 - 86400) ?? pts[0];
    return { pct: ((price - ref.p) / ref.p) * 100, abs: price - ref.p, label: open ? "اليوم" : "24 ساعة" };
  }

  function renderChange() {
    const el = $("#change");
    const c = dayChange();
    el.classList.remove("up", "down");
    if (!c) {
      el.textContent = "—";
      return;
    }
    el.classList.add(c.pct >= 0 ? "up" : "down");
    el.replaceChildren(`${c.label} ${c.pct >= 0 ? "▲" : "▼"} `, h("span", { class: "num" }, signed(c.pct, "%")));
  }

  function renderStatus() {
    const s = $("#status");
    const recent = state.last?.fetchedAt && Date.now() - new Date(state.last.fetchedAt).getTime() < 3 * REFRESH_MS;
    const st = liveActive() ? "live" : !state.online && !live.open ? "offline" : !marketOpen() && state.last ? "closed" : recent ? "minute" : "loading";
    s.dataset.state = st;
    s.querySelector("b").textContent = { live: "مباشر", offline: "غير متصل", closed: "السوق مغلق", minute: "كل دقيقة", loading: "جارٍ التحميل" }[st];
    $("#offline-banner").hidden = state.online || live.open || !state.last;
  }

  // ------------------------------------------------------------- chart --
  const SVGNS = "http://www.w3.org/2000/svg";
  const svg = (tag, attrs) => {
    const el = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  };

  function renderRanges() {
    $$("#ranges button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tf === state.tf)));
  }

  function renderChart() {
    const box = $("#chart");
    if (!box.offsetParent && box.childElementCount) return; // hidden tab: render on show
    const tf = TF[state.tf];
    const all = tf.candles();
    const cs = all.slice(-tf.show);
    box.replaceChildren();
    $("#chart-stats").replaceChildren();
    if (cs.length < 2) {
      const msg = !LIVE_TF[state.tf]
        ? state.online ? "جارٍ تحميل البيانات التاريخية…" : "لا توجد بيانات تاريخية محفوظة"
        : live.klFailed ? "البث المباشر غير متاح الآن — جرّب إطار يوم أو أسبوع" : state.online ? "جارٍ تحميل الشارت…" : "لا يوجد شارت محفوظ";
      $("#chart-source").textContent = sourceNote(state.tf);
      box.append(h("div", { class: "empty" }, msg));
      $("#chart-range").textContent = "";
      return;
    }
    const W = Math.max(box.clientWidth, 280);
    const H = box.clientHeight || 220;
    const pad = { l: 4, r: 56, t: 10, b: 22 };
    let lo = Math.min(...cs.map((k) => k.l));
    let hi = Math.max(...cs.map((k) => k.h));
    const span = hi - lo || hi * 0.001;
    lo -= span * 0.06;
    hi += span * 0.06;
    const n = cs.length;
    const slot = (W - pad.l - pad.r) / n;
    const x = (i) => pad.l + slot * (i + 0.5);
    const y = (p) => pad.t + (1 - (p - lo) / (hi - lo)) * (H - pad.t - pad.b);
    const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none" });

    for (let i = 0; i <= 3; i++) {
      const p = lo + ((hi - lo) * i) / 3;
      const yy = y(p);
      root.append(svg("line", { x1: pad.l, x2: W - pad.r, y1: yy, y2: yy, stroke: "#2e2920", "stroke-width": "1" }));
      const t = svg("text", { x: W - pad.r + 6, y: yy + 4, fill: "#a39a86", "font-size": "11" });
      t.textContent = fmt0.format(p);
      root.append(t);
    }
    const ticks = 4;
    for (let j = 0; j < ticks; j++) {
      const i = Math.round(((n - 1) * (j + 0.5)) / ticks);
      const t = svg("text", { x: x(i), y: H - 5, fill: "#a39a86", "font-size": "10.5", "text-anchor": "middle" });
      t.textContent = tf.label(cs[i].t);
      root.append(t);
    }

    const bodyW = Math.max(1.5, Math.min(slot * 0.7, 14));
    cs.forEach((k, i) => {
      const up = k.c >= k.o;
      const col = up ? "#22c55e" : "#ef4444";
      root.append(svg("line", { x1: x(i), x2: x(i), y1: y(k.h), y2: y(k.l), stroke: col, "stroke-width": "1" }));
      const top = y(Math.max(k.o, k.c));
      const bh = Math.max(1, y(Math.min(k.o, k.c)) - top);
      root.append(svg("rect", { x: x(i) - bodyW / 2, y: top, width: bodyW, height: bh, fill: col, rx: "1" }));
    });
    // live price line
    const lastC = cs[n - 1].c;
    root.append(svg("line", { x1: pad.l, x2: W - pad.r, y1: y(lastC), y2: y(lastC), stroke: "#d4af37", "stroke-width": "1", "stroke-dasharray": "3 3" }));
    const tagY = Math.min(Math.max(y(lastC), pad.t + 8), H - pad.b - 4);
    root.append(svg("rect", { x: W - pad.r + 2, y: tagY - 9, width: pad.r - 4, height: 17, rx: "4", fill: "#d4af37" }));
    const tag = svg("text", { x: W - pad.r + 6, y: tagY + 4, fill: "#1a1405", "font-size": "11", "font-weight": "700" });
    tag.textContent = fmt0.format(lastC);
    root.append(tag);

    const cursor = svg("rect", { y: pad.t, height: H - pad.t - pad.b, width: slot, fill: "rgba(240,215,123,0.12)", visibility: "hidden" });
    root.append(cursor);
    box.append(root);

    const tip = $("#chart-tip");
    const defaultTip = "المس الشارت لعرض تفاصيل الشمعة";
    tip.textContent = defaultTip;
    const scrub = (clientX) => {
      const r = root.getBoundingClientRect();
      const px = ((clientX - r.left) / r.width) * W;
      const i = Math.min(n - 1, Math.max(0, Math.floor((px - pad.l) / slot)));
      const k = cs[i];
      cursor.setAttribute("x", x(i) - slot / 2);
      cursor.setAttribute("visibility", "visible");
      const ch = ((k.c - k.o) / k.o) * 100;
      tip.replaceChildren(
        `${tf.tip(k.t)} — `,
        h("span", { class: "num" }, `O ${money(k.o)} · H ${money(k.h)} · L ${money(k.l)} · C ${money(k.c)} `),
        h("span", { class: `num ${ch >= 0 ? "up" : "down"}` }, signed(ch, "%")),
      );
    };
    const hide = () => {
      cursor.setAttribute("visibility", "hidden");
      tip.textContent = defaultTip;
    };
    let hideTimer;
    root.addEventListener("pointerdown", (e) => scrub(e.clientX));
    root.addEventListener("pointermove", (e) => (e.pointerType === "mouse" || e.buttons) && scrub(e.clientX));
    // touch pointers fire pointerleave right after pointerup: only mice hide on leave
    root.addEventListener("pointerleave", (e) => e.pointerType === "mouse" && hide());
    root.addEventListener("pointerup", (e) => {
      if (e.pointerType === "mouse") return;
      clearTimeout(hideTimer);
      hideTimer = setTimeout(hide, 3000);
    });

    $("#chart-range").textContent = `$${fmt0.format(Math.min(...cs.map((k) => k.l)))} – $${fmt0.format(Math.max(...cs.map((k) => k.h)))}`;

    // stats
    const periodPct = ((lastC - cs[0].o) / cs[0].o) * 100;
    const stats = [
      [`التغير (${n} شمعة)`, signed(periodPct, "%"), periodPct >= 0 ? "up" : "down"],
      ["أعلى / أدنى", `${fmt0.format(Math.max(...cs.map((k) => k.h)))} / ${fmt0.format(Math.min(...cs.map((k) => k.l)))}`],
    ];
    const hst = state.history;
    if (hst && (state.tf === "1d" || state.tf === "1w")) {
      if (hst.high_52w) stats.push(["أعلى / أدنى 52 أسبوع", `${fmt0.format(hst.high_52w)} / ${fmt0.format(hst.low_52w)}`]);
      if (hst.return_ytd_pct != null) stats.push(["منذ بداية السنة", signed(hst.return_ytd_pct, "%"), hst.return_ytd_pct >= 0 ? "up" : "down"]);
    } else if (LIVE_TF[state.tf]) {
      const x = live.px[KLINE_SYMBOL];
      stats.push(["آخر صفقة", x ? secFmt.format(new Date(x.t)) : "—"]);
      stats.push(["السوق العالمي", marketOpen() ? "مفتوح" : "مغلق"]);
    }
    $("#chart-source").textContent = sourceNote(state.tf);
    $("#chart-stats").replaceChildren(
      ...stats.map(([k, v, cls]) => h("div", {}, h("span", { class: "muted small" }, k), h("b", { class: `num ${cls || ""}` }, v))),
    );
  }

  // ---------------------------------------------------- history table --
  function histUnitOptions() {
    const c = state.settings.currency;
    return [{ v: "oz", label: "الأونصة ($)" }, ...ITEMS.filter((i) => i.metal === "gold").map((i) => ({ v: i.id, label: `جرام ${i.label.replace("عيار ", "")} (${unitOf(c)})` }))];
  }

  function renderHistUnitSelect() {
    const sel = $("#hist-unit");
    const opts = histUnitOptions();
    if (!opts.some((o) => o.v === state.histUnit)) state.histUnit = "oz";
    sel.replaceChildren(...opts.map((o) => h("option", { value: o.v, selected: o.v === state.histUnit }, o.label)));
  }

  function renderHistoryTable() {
    const tf = TF[state.tf];
    const cs = tf.candles();
    const c = state.settings.currency;
    const conv = state.histUnit === "oz" ? (p) => p : (p) => (p / OZ) * ITEM[state.histUnit].purity * rate(c);
    const d = state.histUnit === "oz" ? 1 : curDigits(c);
    const rows = cs.slice().reverse().slice(0, state.histRows);
    $("#hist-caption").textContent = LIVE_TF[state.tf]
      ? `شموع كل ${tf.name} — تتحدّث لحظياً (الأحدث أولاً)`
      : `شموع ${tf.name === "يوم" ? "يومية" : "أسبوعية (تاريخ بداية الأسبوع)"} — حتى 5 سنوات (الأحدث أولاً)`;
    const body = $("#hist-body");
    if (!rows.length) {
      body.replaceChildren(h("tr", {}, h("td", { colspan: "6", class: "muted" }, state.online ? "جارٍ التحميل…" : "لا توجد بيانات محفوظة")));
      $("#hist-more").hidden = true;
      return;
    }
    body.replaceChildren(
      ...rows.map((k) => {
        const ch = ((k.c - k.o) / k.o) * 100;
        const cls = Math.abs(ch) < 0.005 ? "" : ch > 0 ? "up" : "down";
        return h(
          "tr",
          {},
          h("td", {}, tf.row(k.t)),
          h("td", { class: "num" }, money(conv(k.o), d)),
          h("td", { class: "num" }, money(conv(k.h), d)),
          h("td", { class: "num" }, money(conv(k.l), d)),
          h("td", { class: `num ${cls}` }, money(conv(k.c), d)),
          h("td", { class: `num ${cls}` }, signed(ch, "%")),
        );
      }),
    );
    $("#hist-more").hidden = cs.length <= state.histRows;
  }

  // ------------------------------------------------------- tradingview --
  function toggleTradingView() {
    const box = $("#tv-box");
    if (!box.hidden) {
      box.hidden = true;
      box.replaceChildren();
      $("#tv-btn").textContent = "شارت TradingView المتقدم (كل الفترات)";
      return;
    }
    if (!navigator.onLine) {
      toast("لا يوجد اتصال", "شارت TradingView يحتاج إنترنت.", "info", 3500);
      return;
    }
    box.hidden = false;
    $("#tv-btn").textContent = "إخفاء شارت TradingView";
    const interval = { "1s": "1", "1m": "1", "5m": "5", "15m": "15", "1h": "60", "4h": "240", "1d": "D", "1w": "W" }[state.tf];
    const widget = h("div", { class: "tradingview-widget-container__widget", style: "height:100%;width:100%" });
    const s = document.createElement("script");
    s.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    s.async = true;
    s.textContent = JSON.stringify({
      autosize: true,
      symbol: "OANDA:XAUUSD",
      interval,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Riyadh",
      theme: "dark",
      style: "1",
      locale: "ar_AE",
      backgroundColor: "rgba(21,19,15,1)",
      gridColor: "rgba(46,41,32,0.6)",
      hide_side_toolbar: true,
      allow_symbol_change: true,
      save_image: false,
      calendar: false,
      support_host: "https://www.tradingview.com",
    });
    const container = h("div", { class: "tradingview-widget-container", style: "height:100%;width:100%" }, widget);
    container.append(s);
    box.replaceChildren(container);
  }

  // ------------------------------------------------------ notifications --
  let audioCtx = null;
  function unlockAudio() {
    try {
      audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === "suspended") audioCtx.resume();
    } catch {
      /* no audio */
    }
  }
  ["pointerdown", "keydown", "touchend"].forEach((ev) => document.addEventListener(ev, unlockAudio, { passive: true }));

  function chime() {
    if (!audioCtx) return;
    const now = audioCtx.currentTime;
    [880, 1318.5, 1760].forEach((f, i) => {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = "sine";
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, now + i * 0.18);
      g.gain.exponentialRampToValueAtTime(0.3, now + i * 0.18 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.18 + 0.5);
      o.connect(g).connect(audioCtx.destination);
      o.start(now + i * 0.18);
      o.stop(now + i * 0.18 + 0.55);
    });
  }

  function toast(title, text, kind = "alert", ms = 12_000) {
    const el = h(
      "div",
      { class: `toast ${kind}`, role: "alert" },
      h("div", { class: "t-body" }, h("div", { class: "t-title" }, title), text ? h("div", { class: "t-text" }, text) : null),
      h("button", { "aria-label": "إغلاق", onclick: () => el.remove() }, "×"),
    );
    const box = $("#toasts");
    box.prepend(el);
    while (box.children.length > 3) box.lastElementChild.remove();
    if (ms) setTimeout(() => el.remove(), ms);
  }

  async function notify(title, body) {
    toast(title, body);
    chime();
    try {
      navigator.vibrate?.([250, 120, 250]);
    } catch {
      /* not supported (iOS) */
    }
    // With background alerts on, the server sends the system notification.
    if (!bgActive() && "Notification" in window && Notification.permission === "granted") {
      try {
        const reg = await navigator.serviceWorker?.getRegistration();
        const opts = { body, icon: "./icons/icon-192.png", badge: "./icons/icon-192.png", lang: "ar", dir: "rtl", tag: "gold-alert-" + Date.now() };
        if (reg) await reg.showNotification(title, opts);
        else new Notification(title, opts);
      } catch {
        /* toast already shown */
      }
    }
  }

  function renderNotifSettings() {
    const btn = $("#notif-btn");
    const st = $("#notif-status");
    if (!("Notification" in window)) {
      btn.hidden = true;
      st.textContent = "إشعارات النظام متاحة على الآيفون بعد تثبيت التطبيق على الشاشة الرئيسية وفتحه من الأيقونة (iOS 16.4 أو أحدث). التنبيهات داخل التطبيق تعمل دائماً.";
      return;
    }
    const p = Notification.permission;
    btn.hidden = p !== "default";
    st.textContent = p === "granted" ? "إشعارات النظام مفعّلة ✓" : p === "denied" ? "إشعارات النظام محظورة. فعّلها من إعدادات الجهاز ← الإشعارات ← ذهب لايف." : "فعّلها ليظهر التنبيه في مركز الإشعارات أيضاً.";
  }

  // ------------------------------------------------------------- alerts --
  function alertValue(a) {
    if (a.kind === "gram") return gramPrice(a.item, a.currency);
    if (a.kind === "ounce") return ounceUsd(a.metal);
    return dayChange()?.pct ?? NaN;
  }
  function alertHit(a, v) {
    if (!Number.isFinite(v)) return false;
    if (a.kind === "pct") return a.dir === "above" ? v >= a.value : v <= -a.value;
    return a.dir === "above" ? v >= a.value : v <= a.value;
  }
  function describeAlert(a) {
    if (a.kind === "gram") return `${ITEM[a.item].label} ${a.dir === "above" ? "أعلى من" : "أقل من"} ${cm(a.value, a.currency)} ${unitOf(a.currency)}`;
    if (a.kind === "ounce") return `أونصة ${METAL_NAME[a.metal]} ${a.dir === "above" ? "أعلى من" : "أقل من"} $${money(a.value)}`;
    return `${a.dir === "above" ? "صعود" : "نزول"} الذهب ${money(a.value)}% اليوم`;
  }
  function formatValue(a, v) {
    if (a.kind === "gram") return `${cm(v, a.currency)} ${unitOf(a.currency)}`;
    if (a.kind === "ounce") return `$${money(v)}`;
    return signed(v, "%");
  }

  function checkAlerts() {
    if (!state.last?.price) return;
    const now = Date.now();
    let changed = false;
    for (const a of state.alerts) {
      if (!a.repeat && a.triggeredAt) continue;
      if (a.repeat && a.lastFiredAt && now - new Date(a.lastFiredAt).getTime() < a.repeat * 60_000) continue;
      const v = alertValue(a);
      if (!alertHit(a, v)) continue;
      const at = new Date().toISOString();
      a.lastFiredAt = at;
      a.count += 1;
      a.triggeredValue = v;
      if (!a.repeat) a.triggeredAt = at;
      changed = true;
      const nowLine = a.kind === "pct" ? `تغيّر الذهب اليوم ${signed(v, "%")}` : a.kind === "gram" ? `سعر الجرام الآن ${formatValue(a, v)}` : `سعر الأونصة الآن ${formatValue(a, v)}`;
      notify(`🔔 ${describeAlert(a)}`, nowLine);
    }
    if (changed) {
      saveAlerts();
      renderAlerts();
      scheduleSync();
    }
  }

  function renderAlerts() {
    $("#alerts-mode").textContent = bgActive()
      ? "التنبيهات بالخلفية مفعّلة: تصلك الإشعارات حتى لو كان التطبيق مغلقاً (يُفحص السعر كل دقيقة)."
      : "تعمل التنبيهات أثناء فتح التطبيق، ويُفحص السعر كل 30 ثانية. فعّل «تنبيهات بالخلفية» من الإعدادات لتصلك والتطبيق مغلق.";
    const list = $("#alert-list");
    if (!state.alerts.length) {
      list.replaceChildren(h("li", { class: "empty" }, "لا توجد تنبيهات بعد."));
      return;
    }
    list.replaceChildren(
      ...state.alerts.map((a) => {
        const done = !a.repeat && a.triggeredAt;
        const meta = done
          ? `تحقق ${dateTimeFmt.format(new Date(a.triggeredAt))} عند ${formatValue(a, a.triggeredValue)}`
          : `الآن ${formatValue(a, alertValue(a))}${a.repeat ? ` · متكرر (${a.repeat >= 60 ? a.repeat / 60 + " س" : a.repeat + " د"})` : " · مرة واحدة"}${a.count && a.repeat ? ` · انطلق ${a.count} مرة` : ""}`;
        return h(
          "li",
          { class: `item${done ? " hit" : ""}` },
          h("div", { class: "main" }, h("span", { class: "title" }, describeAlert(a), done ? h("span", { class: "badge" }, "تحقق ✓") : null), h("span", { class: "meta" }, meta)),
          h(
            "div",
            { class: "actions" },
            done ? h("button", { class: "mini", type: "button", onclick: () => rearm(a.id) }, "إعادة تفعيل") : null,
            h("button", { class: "mini danger", type: "button", "aria-label": "حذف التنبيه", onclick: () => removeAlert(a.id) }, "حذف"),
          ),
        );
      }),
    );
  }

  function rearm(id) {
    const a = state.alerts.find((x) => x.id === id);
    if (!a) return;
    a.triggeredAt = null;
    a.triggeredValue = null;
    a.lastFiredAt = null;
    a.rearmedAt = new Date().toISOString();
    saveAlerts();
    renderAlerts();
    scheduleSync();
    checkAlerts();
  }

  function removeAlert(id) {
    if (!confirm("حذف هذا التنبيه؟")) return;
    state.alerts = state.alerts.filter((x) => x.id !== id);
    saveAlerts();
    renderAlerts();
    scheduleSync();
  }

  function alertFormKind() {
    return $("#alert-form").kind.value;
  }

  function renderAlertForm() {
    const form = $("#alert-form");
    const kind = alertFormKind();
    $$("[data-show]", form).forEach((el) => (el.hidden = el.dataset.show !== kind));
    $("#dir-above").textContent = kind === "pct" ? "صعود بنسبة" : "أعلى من";
    $("#dir-below").textContent = kind === "pct" ? "نزول بنسبة" : "أقل من";
    $("#alert-value-label").textContent =
      kind === "gram" ? `سعر الجرام (${unitOf(state.settings.currency)})` : kind === "ounce" ? "سعر الأونصة ($)" : "النسبة %";
    form.value.placeholder = kind === "pct" ? "مثال: 1.5" : "";
    renderAlertHint();
  }

  function renderAlertHint() {
    const form = $("#alert-form");
    const kind = alertFormKind();
    const c = state.settings.currency;
    let txt = "";
    if (state.last?.price) {
      if (kind === "gram") txt = `السعر الحالي لـ ${ITEM[form.item.value].label}: ${cm(gramPrice(form.item.value), c)} ${unitOf(c)}`;
      else if (kind === "ounce") txt = `سعر أونصة ${METAL_NAME[form.metal.value]} الآن: $${money(ounceUsd(form.metal.value))}`;
      else {
        const ch = dayChange();
        txt = ch ? `تغيّر الذهب اليوم: ${signed(ch.pct, "%")}` : "";
      }
    }
    $("#alert-hint").textContent = txt;
  }

  function setupAlertForm() {
    const form = $("#alert-form");
    const err = $("#alert-error");
    $$("input[name=kind]", form).forEach((r) => r.addEventListener("change", renderAlertForm));
    form.item.addEventListener("change", renderAlertHint);
    form.metal.addEventListener("change", renderAlertHint);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      unlockAudio();
      const kind = alertFormKind();
      const value = parseNum(form.value.value);
      const problem = !(value > 0) ? "أدخل قيمة صحيحة" : kind === "pct" && value >= 100 ? "النسبة يجب أن تكون أقل من 100%" : "";
      if (problem) {
        err.textContent = problem;
        err.hidden = false;
        return;
      }
      err.hidden = true;
      const a = normAlert({
        kind,
        item: form.item.value,
        metal: form.metal.value,
        dir: form.dir.value,
        value,
        currency: state.settings.currency,
        repeat: Number(form.repeat.value),
      });
      state.alerts.unshift(a);
      saveAlerts();
      form.value.value = "";
      renderAlerts();
      toast("تمت إضافة التنبيه", bgActive() ? "سيصلك الإشعار حتى لو كان التطبيق مغلقاً." : "سيُفحص مع كل تحديث للسعر.", "info", 3500);
      scheduleSync();
      checkAlerts();
    });
  }

  // --------------------------------------------------------- purchases --
  function valuation(b) {
    if (b.sold) {
      const pl = b.sold.price - b.paid;
      return { value: b.sold.price, pl, pct: (pl / b.paid) * 100 };
    }
    const value = b.weight * gramPrice(b.item, b.currency);
    const pl = value - b.paid;
    return { value, pl, pct: (pl / b.paid) * 100 };
  }
  const plClass = (v) => (!Number.isFinite(v) || Math.abs(v) < 0.005 ? "" : v > 0 ? "up" : "down");

  function renderBuys() {
    const c = state.settings.currency;
    const list = $("#buy-list");
    const buys = state.buys.slice().sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
    if (!buys.length) {
      list.replaceChildren(h("li", { class: "empty" }, "لا توجد عمليات شراء بعد."));
    } else {
      list.replaceChildren(
        ...buys.map((b) => {
          const v = valuation(b);
          const cls = plClass(v.pl);
          const u = unitOf(b.currency);
          return h(
            "li",
            { class: `item buy${b.sold ? " sold" : ""}` },
            h(
              "div",
              { class: "top" },
              h(
                "div",
                { class: "main" },
                h("span", { class: "title" }, `${ITEM[b.item].label} · `, h("span", { class: "num" }, fmtW.format(b.weight)), " جم", b.sold ? h("span", { class: "badge sold" }, "مُباع") : null),
                h("span", { class: "meta" }, dateFmt.format(new Date(b.date + "T12:00:00")), ` · متوسط الجرام ${cm(b.paid / b.weight, b.currency)} ${u}`),
                b.sold ? h("span", { class: "meta" }, `بيع ${dateFmt.format(new Date(b.sold.date + "T12:00:00"))} بـ ${cm(b.sold.price, b.currency)} ${u}`) : null,
                b.note ? h("span", { class: "note-line" }, b.note) : null,
              ),
            ),
            h(
              "div",
              { class: "nums" },
              h("div", {}, h("span", { class: "muted small" }, `المدفوع (${u})`), h("b", { class: "num" }, cm(b.paid, b.currency))),
              h("div", {}, h("span", { class: "muted small" }, b.sold ? "سعر البيع" : "القيمة الآن"), h("b", { class: "num" }, cm(v.value, b.currency))),
              h("div", {}, h("span", { class: "muted small" }, b.sold ? "الربح المحقق" : "الربح/الخسارة"), h("b", { class: `num ${cls}` }, signed(v.pl, "", curDigits(b.currency))), h("span", { class: `num small ${cls}` }, signed(v.pct, "%"))),
            ),
            h(
              "div",
              { class: "actions buy-actions" },
              h("button", { class: "mini", type: "button", onclick: () => editBuy(b.id) }, "تعديل"),
              b.sold
                ? h("button", { class: "mini", type: "button", onclick: () => unsell(b.id) }, "إلغاء البيع")
                : h("button", { class: "mini", type: "button", onclick: () => openSell(b.id) }, "بيع"),
              h("button", { class: "mini danger", type: "button", onclick: () => removeBuy(b.id) }, "حذف"),
            ),
          );
        }),
      );
    }

    // totals in the display currency
    const held = buys.filter((b) => !b.sold);
    const sold = buys.filter((b) => b.sold);
    const paid = held.reduce((s, b) => s + convert(b.paid, b.currency, c), 0);
    const value = held.reduce((s, b) => s + convert(valuation(b).value, b.currency, c), 0);
    const pl = value - paid;
    const pct = paid ? (pl / paid) * 100 : NaN;
    $("#sum-paid").textContent = held.length ? cm(paid, c) : "—";
    $("#sum-value").textContent = held.length ? cm(value, c) : "—";
    const plEl = $("#sum-pl");
    plEl.className = `pl num ${held.length ? plClass(pl) : ""}`;
    plEl.replaceChildren(
      ...(held.length
        ? [h("span", { class: "num" }, signed(pl, "", curDigits(c))), ` ${unitOf(c)} (`, h("span", { class: "num" }, signed(pct, "%")), ")"]
        : ["—"]),
    );
    const realized = sold.reduce((s, b) => s + convert(b.sold.price - b.paid, b.currency, c), 0);
    $("#sum-realized").replaceChildren(
      ...(sold.length
        ? ["الربح المحقق من المبيعات: ", h("span", { class: plClass(realized) }, h("span", { class: "num" }, signed(realized, "", curDigits(c))), ` ${unitOf(c)}`)]
        : []),
    );
    const goldHeld = held.filter((b) => ITEM[b.item].metal === "gold");
    const silverHeld = held.filter((b) => ITEM[b.item].metal === "silver");
    const pureGold = goldHeld.reduce((s, b) => s + b.weight * ITEM[b.item].purity, 0);
    const goldPaid = goldHeld.reduce((s, b) => s + convert(b.paid, b.currency, c), 0);
    const silverG = silverHeld.reduce((s, b) => s + b.weight, 0);
    const lines = [];
    if (goldHeld.length) {
      lines.push(`ذهب: ${fmtW.format(goldHeld.reduce((s, b) => s + b.weight, 0))} جم (${fmtW.format(pureGold)} جم خالص)`);
      lines.push(`متوسط تكلفة الجرام الخالص ${cm(goldPaid / pureGold, c)} · سعره الآن ${cm(gramPrice("g24", c), c)} ${unitOf(c)}`);
    }
    if (silverHeld.length) lines.push(`فضة: ${fmtW.format(silverG)} جم`);
    $("#sum-weights").replaceChildren(...lines.flatMap((l, i) => (i ? [h("br"), l] : [l])));
  }

  function resetBuyForm() {
    const form = $("#buy-form");
    form.reset();
    form.editId.value = "";
    form.date.value = today();
    state.editCurrency = null;
    $("#buy-title").textContent = "إضافة عملية شراء";
    $("#buy-submit").textContent = "حفظ";
    $("#buy-cancel").hidden = true;
    $("#buy-error").hidden = true;
    renderCurrencyNames();
  }

  function editBuy(id) {
    const b = state.buys.find((x) => x.id === id);
    if (!b) return;
    const form = $("#buy-form");
    form.editId.value = b.id;
    form.date.value = b.date;
    form.item.value = b.item;
    form.weight.value = String(b.weight);
    form.paid.value = String(b.paid);
    form.note.value = b.note || "";
    state.editCurrency = b.currency;
    $("#buy-form .cur-name").textContent = unitOf(b.currency);
    $("#buy-title").textContent = "تعديل عملية الشراء";
    $("#buy-submit").textContent = "حفظ التعديل";
    $("#buy-cancel").hidden = false;
    form.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function removeBuy(id) {
    if (!confirm("حذف هذه العملية؟")) return;
    state.buys = state.buys.filter((x) => x.id !== id);
    saveBuys();
    if ($("#buy-form").editId.value === id) resetBuyForm();
    closeSell();
    renderBuys();
  }

  function openSell(id) {
    const b = state.buys.find((x) => x.id === id);
    if (!b) return;
    const form = $("#sell-form");
    form.buyId.value = id;
    form.date.value = today();
    const est = valuation(b).value;
    form.price.value = Number.isFinite(est) ? est.toFixed(curDigits(b.currency)) : "";
    $("#sell-cur").textContent = unitOf(b.currency);
    $("#sell-what").textContent = `${ITEM[b.item].label} · ${fmtW.format(b.weight)} جم — اشتريته بـ ${cm(b.paid, b.currency)} ${unitOf(b.currency)}. القيمة المقترحة بالسعر العالمي، عدّلها للمبلغ الفعلي.`;
    $("#sell-error").hidden = true;
    $("#sell-card").hidden = false;
    $("#sell-card").scrollIntoView({ behavior: "smooth", block: "center" });
  }
  function closeSell() {
    $("#sell-card").hidden = true;
  }
  function unsell(id) {
    const b = state.buys.find((x) => x.id === id);
    if (!b || !confirm("إلغاء تسجيل البيع؟")) return;
    b.sold = null;
    saveBuys();
    renderBuys();
  }

  function setupBuyForms() {
    const form = $("#buy-form");
    const err = $("#buy-error");
    resetBuyForm();
    $("#buy-cancel").addEventListener("click", resetBuyForm);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const weight = parseNum(form.weight.value);
      const paid = parseNum(form.paid.value);
      const date = form.date.value;
      const problem = !date ? "اختر التاريخ" : !(weight > 0) ? "أدخل الوزن بالجرام" : !(paid > 0) ? "أدخل المبلغ المدفوع" : "";
      if (problem) {
        err.textContent = problem;
        err.hidden = false;
        return;
      }
      const id = form.editId.value;
      const data = { date, item: form.item.value, weight, paid, note: form.note.value.trim().slice(0, 80) };
      if (id) {
        const b = state.buys.find((x) => x.id === id);
        if (b) Object.assign(b, data);
      } else {
        state.buys.push(normBuy({ ...data, currency: state.settings.currency, id: uid(), createdAt: new Date().toISOString() }));
      }
      saveBuys();
      resetBuyForm();
      renderBuys();
      toast(id ? "تم حفظ التعديل" : "تمت إضافة عملية الشراء", "", "info", 2500);
    });

    const sell = $("#sell-form");
    const serr = $("#sell-error");
    $("#sell-cancel").addEventListener("click", closeSell);
    sell.addEventListener("submit", (e) => {
      e.preventDefault();
      const b = state.buys.find((x) => x.id === sell.buyId.value);
      if (!b) return closeSell();
      const price = parseNum(sell.price.value);
      const date = sell.date.value;
      const problem = !date ? "اختر تاريخ البيع" : date < b.date ? "تاريخ البيع قبل تاريخ الشراء" : !(price > 0) ? "أدخل سعر البيع" : "";
      if (problem) {
        serr.textContent = problem;
        serr.hidden = false;
        return;
      }
      b.sold = { date, price };
      saveBuys();
      closeSell();
      renderBuys();
      const pl = price - b.paid;
      toast("تم تسجيل البيع", `${pl >= 0 ? "ربح" : "خسارة"} ${cm(Math.abs(pl), b.currency)} ${unitOf(b.currency)}`, "info", 4000);
    });
  }

  // -------------------------------------------------------- calculator --
  function renderCalc() {
    const form = $("#calc-form");
    const c = state.settings.currency;
    const it = form.item.value;
    const w = parseNum(form.weight.value);
    const making = form.making.value.trim() === "" ? makingFor(it) : parseNum(form.making.value);
    form.making.placeholder = money(makingFor(it), curDigits(c));
    const raw = w * gramPrice(it);
    const mk = w * (Number.isFinite(making) ? making : 0);
    const vat = state.settings.vatOn ? (raw + mk) * (state.settings.vatRate / 100) : 0;
    const ok = w > 0 && Number.isFinite(raw);
    const u = ` ${unitOf(c)}`;
    $("#calc-raw").textContent = ok ? cm(raw, c) + u : "—";
    $("#calc-making").textContent = ok ? cm(mk, c) + u : "—";
    $("#calc-vat-label").textContent = state.settings.vatOn ? `ضريبة القيمة المضافة ${state.settings.vatRate}%` : "ضريبة القيمة المضافة (غير مفعّلة)";
    $("#calc-vat").textContent = ok ? cm(vat, c) + u : "—";
    $("#calc-total").textContent = ok ? cm(raw + mk + vat, c) + u : "—";
    $("#calc-note").textContent = ok
      ? `${fmtW.format(w * ITEM[it].purity)} جم ${ITEM[it].metal === "gold" ? "ذهب" : "فضة"} خالص. السعر العالمي هو تقريباً ما يدفعه لك المحل عند البيع؛ أسعار المحلات الفعلية قد تختلف.`
      : "أدخل وزناً صحيحاً.";
    $$("#calc-weights button").forEach((b) => b.classList.toggle("on", parseNum(b.dataset.w) === w));
  }

  function setupCalc() {
    const form = $("#calc-form");
    form.addEventListener("submit", (e) => e.preventDefault());
    form.addEventListener("input", renderCalc);
    form.item.addEventListener("change", () => {
      form.making.value = "";
      renderCalc();
    });
    $$("#calc-weights button").forEach((b) =>
      b.addEventListener("click", () => {
        form.weight.value = b.dataset.w;
        renderCalc();
      }),
    );
  }

  // ---------------------------------------------------------- settings --
  function fillItemSelects() {
    $$(".item-select").forEach((sel) => {
      const keep = sel.value || "g21";
      sel.replaceChildren(
        ...["gold", "silver"].map((m) =>
          h("optgroup", { label: METAL_NAME[m] }, ...ITEMS.filter((i) => i.metal === m).map((i) => h("option", { value: i.id }, i.label))),
        ),
      );
      sel.value = ITEM[keep] ? keep : "g21";
    });
  }

  function renderSettings() {
    const c = state.settings.currency;
    $("#currency").replaceChildren(...CURRENCIES.map((x) => h("option", { value: x.code, selected: x.code === c }, `${x.name} (${x.code})`)));
    const form = $("#settings-form");
    $("#making-fields").replaceChildren(
      ...ITEMS.map((i) =>
        h(
          "label",
          { class: "field" },
          h("span", {}, `مصنعية ${i.label}`),
          h("input", { name: `mk_${i.id}`, class: "input num", inputmode: "decimal", autocomplete: "off", value: String(+makingFor(i.id).toFixed(curDigits(c))) }),
        ),
      ),
    );
    form.vatOn.checked = state.settings.vatOn;
    form.vatRate.value = String(state.settings.vatRate);
    renderNotifSettings();
  }

  function rerenderAll() {
    renderCurrencyNames();
    renderPrices();
    renderHistUnitSelect();
    renderHistoryTable();
    renderAlertForm();
    renderAlerts();
    renderBuys();
    renderCalc();
  }

  function setupSettings() {
    $("#currency").addEventListener("change", (e) => {
      const c = e.target.value;
      if (!CUR[c]) return;
      state.settings.currency = c;
      saveSettings();
      if (!Number.isFinite(rate(c))) toast("سعر الصرف غير متوفر بعد", "سيظهر عند الاتصال بالإنترنت.", "info", 4000);
      renderSettings();
      rerenderAll();
    });
    const form = $("#settings-form");
    const msg = $("#settings-msg");
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const c = state.settings.currency;
      const m = {};
      for (const i of ITEMS) {
        const raw = form[`mk_${i.id}`].value.trim();
        const v = raw === "" ? 0 : parseNum(raw);
        if (!(v >= 0)) {
          msg.textContent = `قيمة غير صحيحة لمصنعية ${i.label}`;
          msg.hidden = false;
          return;
        }
        m[i.id] = v;
      }
      const vr = parseNum(form.vatRate.value);
      if (!(vr >= 0 && vr <= 50)) {
        msg.textContent = "نسبة الضريبة يجب أن تكون بين 0 و 50";
        msg.hidden = false;
        return;
      }
      state.settings.making[c] = m;
      state.settings.vatOn = form.vatOn.checked;
      state.settings.vatRate = vr;
      saveSettings();
      msg.textContent = "تم الحفظ ✓";
      msg.hidden = false;
      setTimeout(() => (msg.hidden = true), 2500);
      rerenderAll();
    });

    $("#notif-btn").addEventListener("click", async () => {
      unlockAudio();
      const p = await Notification.requestPermission();
      renderNotifSettings();
      toast(p === "granted" ? "تم تفعيل الإشعارات" : "لم يتم تفعيل الإشعارات", p === "granted" ? "ستظهر التنبيهات في إشعارات الجهاز أيضاً." : "يمكنك تفعيلها لاحقاً من إعدادات الجهاز.", "info", 4000);
    });
    $("#sound-test").addEventListener("click", () => {
      unlockAudio();
      setTimeout(chime, 50);
      try {
        navigator.vibrate?.([200, 100, 200]);
      } catch {
        /* iOS */
      }
    });

    $("#bg-enable").addEventListener("click", bgEnable);
    $("#bg-disable").addEventListener("click", bgDisable);
    $("#bg-test").addEventListener("click", bgTest);
    $("#export-btn").addEventListener("click", exportBackup);
    $("#import-file").addEventListener("change", importBackup);
  }

  // ------------------------------------------------------------ backup --
  async function exportBackup() {
    const data = { app: "gold-live", version: 2, exportedAt: new Date().toISOString(), settings: state.settings, alerts: state.alerts, buys: state.buys };
    const json = JSON.stringify(data, null, 2);
    const name = `gold-live-backup-${today()}.json`;
    const file = new File([json], name, { type: "application/json" });
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: "نسخة احتياطية — ذهب لايف" });
        return;
      }
    } catch (e) {
      if (e?.name === "AbortError") return;
    }
    const url = URL.createObjectURL(file);
    const a = h("a", { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast("تم تصدير النسخة الاحتياطية", name, "info", 3500);
  }

  async function importBackup(e) {
    const input = e.target;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    try {
      if (file.size > 2_000_000) throw new Error("big");
      const data = JSON.parse(await file.text());
      if (data?.app !== "gold-live" || !Array.isArray(data.buys) || !Array.isArray(data.alerts)) throw new Error("format");
      const buys = data.buys.map(normBuy).filter(Boolean);
      const alerts = data.alerts.map(normAlert).filter(Boolean);
      if (!confirm(`استيراد ${buys.length} عملية و${alerts.length} تنبيه؟ سيستبدل هذا بياناتك الحالية.`)) return;
      state.buys = buys;
      state.alerts = alerts;
      state.settings = normSettings(data.settings);
      saveBuys();
      saveAlerts();
      saveSettings();
      renderSettings();
      rerenderAll();
      scheduleSync();
      toast("تم الاستيراد", `${buys.length} عملية و${alerts.length} تنبيه`, "info", 3500);
    } catch {
      toast("ملف غير صالح", "اختر ملف نسخة احتياطية صدّرته من ذهب لايف.", "info", 4000);
    }
  }

  // ------------------------------------------- background alerts (push) --
  const bgActive = () => !!(state.push && state.pushServer && state.push.server === state.pushServer);
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

  async function loadConfig() {
    try {
      const res = await fetch("./config.json", { cache: "no-store" });
      if (res.ok) {
        const cfg = await res.json();
        const server = typeof cfg.pushServer === "string" ? cfg.pushServer.trim().replace(/\/+$/, "") : "";
        state.pushServer = /^https:\/\/|^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(server) ? server : "";
        store.set(KEYS.config, { pushServer: state.pushServer });
      }
    } catch {
      /* offline: keep cached config */
    }
    renderBg();
    renderAlerts();
  }

  async function api(path, body) {
    const res = await fetch(state.pushServer + path, {
      method: body ? "POST" : "GET",
      headers: body ? { "content-type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status });
    return data;
  }

  function renderBg() {
    const st = $("#bg-status");
    const show = (enable, actions) => {
      $("#bg-enable").hidden = !enable;
      $("#bg-actions").hidden = !actions;
      $("#bg-badge").hidden = !actions;
    };
    if (!state.pushServer) {
      st.textContent = "لم يتم ربط خادم التنبيهات بعد. بعد إعداده (شوف README) ستظهر هنا إمكانية التفعيل.";
      return show(false, false);
    }
    if (bgActive()) {
      st.textContent = "تصلك التنبيهات حتى لو كان التطبيق مغلقاً. الخادم يفحص السعر كل دقيقة.";
      return show(false, true);
    }
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      st.textContent = isIos && !standalone()
        ? "على الآيفون: ثبّت التطبيق على الشاشة الرئيسية (مشاركة ← إضافة إلى الشاشة الرئيسية) ثم افتحه من الأيقونة لتفعيلها. يتطلب iOS 16.4 أو أحدث."
        : "هذا المتصفح لا يدعم الإشعارات بالخلفية.";
      return show(false, false);
    }
    if (Notification.permission === "denied") {
      st.textContent = "الإشعارات محظورة. فعّلها من إعدادات الجهاز ← الإشعارات ← ذهب لايف، ثم ارجع هنا.";
      return show(false, false);
    }
    st.textContent = "تصلك التنبيهات كإشعار حتى لو كان التطبيق مغلقاً أو الجوال مقفلاً.";
    show(true, false);
  }

  function b64uToBytes(str) {
    const s = str.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(s + "===".slice((s.length + 3) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  }

  async function bgEnable() {
    const btn = $("#bg-enable");
    btn.disabled = true;
    try {
      unlockAudio();
      const perm = await Notification.requestPermission(); // must run inside the tap
      if (perm !== "granted") throw new Error(perm === "denied" ? "رُفض إذن الإشعارات" : "لم يتم منح الإذن");
      const reg = (await navigator.serviceWorker.getRegistration()) || (await navigator.serviceWorker.register("./sw.js", { scope: "./" }));
      await navigator.serviceWorker.ready;
      const { publicKey } = await api("/vapid");
      const key = b64uToBytes(publicKey);
      let sub = await reg.pushManager.getSubscription();
      if (sub) {
        const cur = sub.options?.applicationServerKey ? new Uint8Array(sub.options.applicationServerKey) : null;
        if (!cur || cur.length !== key.length || cur.some((b, i) => b !== key[i])) {
          await sub.unsubscribe();
          sub = null;
        }
      }
      sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Riyadh";
      const { id, token } = await api("/register", { subscription: sub.toJSON(), tz });
      state.push = { server: state.pushServer, id, token };
      store.set(KEYS.push, state.push);
      await syncNow();
      toast("تم تفعيل التنبيهات بالخلفية ✓", "ستصلك الإشعارات حتى لو كان التطبيق مغلقاً.", "info", 5000);
    } catch (e) {
      toast("تعذّر التفعيل", e?.message || "حاول مرة أخرى", "info", 6000);
    } finally {
      btn.disabled = false;
      renderBg();
      renderAlerts();
      renderNotifSettings();
    }
  }

  async function bgDisable() {
    if (!confirm("إيقاف التنبيهات بالخلفية على هذا الجهاز؟")) return;
    const p = state.push;
    state.push = null;
    store.set(KEYS.push, null);
    try {
      if (p) await api("/unregister", { id: p.id, token: p.token });
    } catch {
      /* server may be unreachable; local state is cleared anyway */
    }
    try {
      const sub = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription();
      await sub?.unsubscribe();
    } catch {
      /* ignore */
    }
    renderBg();
    renderAlerts();
  }

  async function bgTest() {
    if (!bgActive()) return;
    try {
      const r = await api("/test", { id: state.push.id, token: state.push.token });
      toast(r.sent ? "أُرسل إشعار تجريبي" : "لم يصل الإشعار", r.sent ? "إذا لم يظهر، تأكد من السماح بالإشعارات." : "أعد التفعيل من جديد.", "info", 4000);
    } catch (e) {
      handleBgError(e);
    }
  }

  function handleBgError(e) {
    if (e?.status === 404) {
      // server forgot this device (e.g. subscription expired)
      state.push = null;
      store.set(KEYS.push, null);
      renderBg();
      renderAlerts();
      toast("انتهى اشتراك التنبيهات بالخلفية", "فعّلها من جديد من الإعدادات.", "info", 6000);
    }
  }

  /** Copy firing state from the server where it acted more recently. */
  function mergeRemote(remote) {
    const byId = new Map((remote || []).map((a) => [a.id, a]));
    const t = (v) => (v ? Date.parse(v) : 0);
    let changed = false;
    for (const a of state.alerts) {
      const r = byId.get(a.id);
      if (!r || t(r.lastFiredAt) <= Math.max(t(a.lastFiredAt), t(a.rearmedAt))) continue;
      a.lastFiredAt = r.lastFiredAt;
      a.triggeredAt = r.triggeredAt;
      a.triggeredValue = r.triggeredValue;
      a.count = Math.max(a.count, r.count || 0);
      changed = true;
    }
    if (changed) {
      saveAlerts();
      renderAlerts();
    }
  }

  let syncTimer = null;
  function scheduleSync() {
    if (!bgActive()) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncNow, 400);
  }
  async function syncNow() {
    if (!bgActive()) return;
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Riyadh";
      const r = await api("/sync", { id: state.push.id, token: state.push.token, alerts: state.alerts, tz });
      mergeRemote(r.alerts);
    } catch (e) {
      handleBgError(e);
    }
  }
  async function pullState() {
    if (!bgActive() || !navigator.onLine) return;
    try {
      const r = await api("/state", { id: state.push.id, token: state.push.token });
      mergeRemote(r.alerts);
    } catch (e) {
      handleBgError(e);
    }
  }

  // --------------------------------------------------------------- tabs --
  const TABS = ["home", "calc", "alerts", "buys", "settings"];
  function showTab(name) {
    if (!TABS.includes(name)) name = "home";
    $$(".tab").forEach((t) => (t.dataset.active = String(t.id === `tab-${name}`)));
    $$(".tabbar button").forEach((b) => (b.dataset.tab === name ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current")));
    store.set(KEYS.tab, name);
    window.scrollTo({ top: 0 });
    if (name === "home") renderChart();
    if (name === "settings") {
      renderNotifSettings();
      renderBg();
    }
  }

  // --------------------------------------------------------------- boot --
  function boot() {
    fillItemSelects();
    renderSettings();
    renderHistUnitSelect();
    renderRanges();
    $$(".tabbar button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
    showTab(store.get(KEYS.tab, "home"));
    setupAlertForm();
    setupBuyForms();
    setupCalc();
    setupSettings();

    $$("#ranges button").forEach((b) =>
      b.addEventListener("click", () => {
        state.tf = b.dataset.tf;
        state.histRows = 24;
        store.set(KEYS.tf, state.tf);
        renderRanges();
        renderChart();
        renderHistoryTable();
        if (state.tf === "1d" || state.tf === "1w") refreshHistory();
        else fetchKlines(state.tf);
      }),
    );
    $("#hist-unit").addEventListener("change", (e) => {
      state.histUnit = e.target.value;
      store.set(KEYS.histUnit, state.histUnit);
      renderHistoryTable();
    });
    $("#hist-more").addEventListener("click", () => {
      state.histRows += 24;
      renderHistoryTable();
    });
    $("#tv-btn").addEventListener("click", toggleTradingView);

    // Show what we have immediately (works offline), then go to the network.
    rerenderAll();
    renderBg();
    renderStatus();
    connectLive();
    refreshAll(true);
    refreshHistory();
    fetchKlines(state.tf, true);
    setInterval(() => document.visibilityState === "visible" && LIVE_TF[state.tf] && fetchKlines(state.tf), 60_000);
    loadConfig().then(() => {
      scheduleSync(); // push any changes made while offline
    });
    navigator.serviceWorker?.addEventListener("message", (e) => e.data?.type === "pushed" && pullState());
    setInterval(() => document.visibilityState === "visible" && pullState(), 120_000);

    $("#refresh").addEventListener("click", () => refreshAll(true));
    setInterval(() => {
      if (document.visibilityState === "visible") {
        refreshSpot();
        refreshSeries();
      }
    }, REFRESH_MS);
    setInterval(renderStatus, 10_000);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") {
        disconnectLive(); // iOS suspends hidden pages anyway
        return;
      }
      connectLive();
      if (LIVE_TF[state.tf]) fetchKlines(state.tf, true);
      pullState();
      const age = Date.now() - new Date(state.last?.fetchedAt || 0).getTime();
      if (age > REFRESH_MS - 5000) refreshAll();
    });
    window.addEventListener("online", () => refreshAll(true));
    window.addEventListener("offline", () => {
      state.online = false;
      renderStatus();
    });
    let resizeTimer;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(renderChart, 150);
    });

    if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(() => {});
  }

  boot();
})();
