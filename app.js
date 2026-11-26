/* ذهب لايف — vanilla JS, no build step. */
(() => {
  "use strict";

  // ------------------------------------------------------------ config --
  const API_SPOT = "https://xaus.com/api/v1/spot";
  const API_INTRADAY = "https://xaus.com/api/v1/intraday?symbol=xau&hours=24";
  const USD_SAR = 3.75;
  const GRAMS_PER_OZ = 31.1035;
  const KARATS = [24, 22, 21, 18];
  const REFRESH_MS = 30_000;
  const SERIES_REFRESH_MS = 5 * 60_000;
  const KEYS = { last: "gold.last", series: "gold.series", alerts: "gold.alerts", buys: "gold.buys", tab: "gold.tab" };

  // ----------------------------------------------------------- helpers --
  const $ = (sel, root = document) => root.querySelector(sel);
  const fmt2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmt0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
  const fmtW = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });
  const money = (v) => (Number.isFinite(v) ? fmt2.format(v) : "—");
  const signed = (v, suffix = "") => (Number.isFinite(v) ? `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmt2.format(Math.abs(v))}${suffix}` : "—");
  const timeFmt = new Intl.DateTimeFormat("ar-SA-u-nu-latn-ca-gregory", { hour: "numeric", minute: "2-digit" });
  const dateTimeFmt = new Intl.DateTimeFormat("ar-SA-u-nu-latn-ca-gregory", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  const dateFmt = new Intl.DateTimeFormat("ar-SA-u-nu-latn-ca-gregory", { year: "numeric", month: "short", day: "numeric" });
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  /** Arabic/Persian digits and separators → a JS number (NaN if invalid). */
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

  /** Tiny DOM builder: h("div", {class: "x"}, "text", child) — text is never parsed as HTML. */
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

  const gramSar = (usdOz, karat) => (usdOz / GRAMS_PER_OZ) * (karat / 24) * USD_SAR;

  // -------------------------------------------------------------- state --
  const state = {
    last: store.get(KEYS.last, null), // { price, asOf, fetchedAt }
    series: store.get(KEYS.series, []), // [{ t, p }]
    alerts: store.get(KEYS.alerts, []),
    buys: store.get(KEYS.buys, []),
    online: true,
    loading: false,
    seriesFetchedAt: 0,
  };

  // ------------------------------------------------------------ network --
  async function getJSON(url, { timeout = 10_000, retries = 1 } = {}) {
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

  function readSpot(d) {
    const p = Number(d?.spot_usd_oz ?? d?.xau?.price);
    if (!Number.isFinite(p) || p < 300 || p > 100_000) throw new Error("bad price");
    const asOf = d.price_as_of || d.updated_at || new Date().toISOString();
    return { price: p, asOf };
  }

  async function refreshSpot() {
    try {
      const d = await getJSON(API_SPOT);
      const { price, asOf } = readSpot(d);
      const prev = state.last?.price;
      state.last = { price, asOf, fetchedAt: new Date().toISOString() };
      state.online = true;
      store.set(KEYS.last, state.last);
      renderPrice(prev);
      checkAlerts();
      renderBuys();
      renderAlertHint();
    } catch {
      state.online = false;
      renderPrice();
    }
    renderStatus();
  }

  async function refreshSeries(force = false) {
    if (!force && Date.now() - state.seriesFetchedAt < SERIES_REFRESH_MS) return;
    try {
      const d = await getJSON(API_INTRADAY);
      const pts = (d?.points || [])
        .map((x) => ({ t: Number(x.t), p: Number(x.p) }))
        .filter((x) => Number.isFinite(x.t) && Number.isFinite(x.p) && x.p > 0)
        .sort((a, b) => a.t - b.t);
      if (pts.length) {
        state.series = pts;
        state.seriesFetchedAt = Date.now();
        store.set(KEYS.series, pts);
      }
    } catch {
      /* keep cached series */
    }
    renderChange();
    renderChart();
  }

  async function refreshAll(force = false) {
    if (state.loading) return;
    state.loading = true;
    $("#refresh").classList.add("spinning");
    await Promise.all([refreshSpot(), refreshSeries(force)]);
    state.loading = false;
    $("#refresh").classList.remove("spinning");
  }

  // -------------------------------------------------------------- home --
  function renderPrice(prev) {
    const last = state.last;
    const big = $("#price-usd");
    if (!last) {
      big.textContent = "—";
      $("#price-sar").textContent = "—";
      $("#updated").textContent = state.online ? "…" : "لا توجد بيانات محفوظة";
      $("#karats").replaceChildren(...KARATS.map((k) => karatCard(k, NaN)));
      return;
    }
    big.textContent = "$" + money(last.price);
    if (prev != null && prev !== last.price) {
      big.classList.remove("flash-up", "flash-down");
      void big.offsetWidth; // restart animation
      big.classList.add(last.price > prev ? "flash-up" : "flash-down");
    }
    $("#price-sar").textContent = money(last.price * USD_SAR);
    const asOf = new Date(last.fetchedAt || last.asOf);
    const sameDay = asOf.toDateString() === new Date().toDateString();
    $("#updated").textContent = (sameDay ? timeFmt : dateTimeFmt).format(asOf);
    $("#karats").replaceChildren(...KARATS.map((k) => karatCard(k, gramSar(last.price, k))));
    renderChange();
    renderChart();
  }

  function karatCard(k, v) {
    return h("div", { class: "karat" }, h("span", { class: "k" }, `عيار ${k}`), h("span", { class: "v num" }, money(v)));
  }

  /** Change since the first sample after local midnight (falls back to 24h). */
  function dayChange() {
    const price = state.last?.price;
    const pts = state.series;
    if (!price || !pts.length) return null;
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    const cut = midnight.getTime() / 1000;
    const open = pts.find((x) => x.t >= cut);
    const ref = open ?? pts[0];
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
    const fresh = state.last?.fetchedAt && Date.now() - new Date(state.last.fetchedAt).getTime() < 3 * REFRESH_MS;
    const st = !state.online ? "offline" : fresh ? "live" : "loading";
    s.dataset.state = st;
    s.querySelector("b").textContent = st === "live" ? "مباشر" : st === "offline" ? "غير متصل" : "جارٍ التحميل";
    $("#offline-banner").hidden = state.online || !state.last;
  }

  // ------------------------------------------------------------- chart --
  const SVGNS = "http://www.w3.org/2000/svg";
  const svg = (tag, attrs) => {
    const el = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  };

  function chartPoints() {
    const pts = state.series.slice();
    const last = state.last;
    if (last && pts.length) {
      const t = Math.floor(new Date(last.fetchedAt || last.asOf).getTime() / 1000);
      if (t > pts[pts.length - 1].t) pts.push({ t, p: last.price });
    }
    return pts;
  }

  function renderChart() {
    const box = $("#chart");
    const pts = chartPoints();
    box.replaceChildren();
    if (pts.length < 2) {
      box.append(h("div", { class: "empty" }, state.online ? "جارٍ تحميل المنحنى…" : "لا يوجد منحنى محفوظ"));
      $("#chart-range").textContent = "";
      return;
    }
    const W = Math.max(box.clientWidth, 280);
    const H = box.clientHeight || 200;
    const pad = { l: 4, r: 58, t: 12, b: 22 };
    const t0 = pts[0].t;
    const t1 = pts[pts.length - 1].t;
    let lo = Math.min(...pts.map((p) => p.p));
    let hi = Math.max(...pts.map((p) => p.p));
    const span = hi - lo || hi * 0.001;
    lo -= span * 0.08;
    hi += span * 0.08;
    const x = (t) => pad.l + ((t - t0) / Math.max(t1 - t0, 1)) * (W - pad.l - pad.r);
    const y = (p) => pad.t + (1 - (p - lo) / (hi - lo)) * (H - pad.t - pad.b);

    const up = pts[pts.length - 1].p >= pts[0].p;
    const stroke = "#d4af37";
    const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none" });
    const defs = svg("defs", {});
    const grad = svg("linearGradient", { id: "g", x1: "0", y1: "0", x2: "0", y2: "1" });
    grad.append(svg("stop", { offset: "0", "stop-color": stroke, "stop-opacity": "0.35" }), svg("stop", { offset: "1", "stop-color": stroke, "stop-opacity": "0" }));
    defs.append(grad);
    root.append(defs);

    // grid + price labels (4 lines)
    for (let i = 0; i <= 3; i++) {
      const p = lo + ((hi - lo) * i) / 3;
      const yy = y(p);
      root.append(svg("line", { x1: pad.l, x2: W - pad.r, y1: yy, y2: yy, stroke: "#2e2920", "stroke-width": "1" }));
      const lbl = svg("text", { x: W - pad.r + 6, y: yy + 4, fill: "#a39a86", "font-size": "11" });
      lbl.textContent = fmt0.format(p);
      root.append(lbl);
    }
    // time labels every 6h
    const first6 = Math.ceil(t0 / 21600) * 21600;
    for (let t = first6; t <= t1; t += 21600) {
      const xx = x(t);
      if (xx < pad.l + 20 || xx > W - pad.r - 20) continue;
      const lbl = svg("text", { x: xx, y: H - 4, fill: "#a39a86", "font-size": "11", "text-anchor": "middle" });
      lbl.textContent = timeFmt.format(new Date(t * 1000));
      root.append(lbl);
    }

    const line = pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.p).toFixed(1)}`).join("");
    root.append(svg("path", { d: `${line}L${x(t1).toFixed(1)},${H - pad.b}L${x(t0).toFixed(1)},${H - pad.b}Z`, fill: "url(#g)" }));
    root.append(svg("path", { d: line, fill: "none", stroke, "stroke-width": "2", "stroke-linejoin": "round", "stroke-linecap": "round" }));
    const lastPt = pts[pts.length - 1];
    root.append(svg("circle", { cx: x(lastPt.t), cy: y(lastPt.p), r: "3.5", fill: up ? "#22c55e" : "#ef4444" }));

    // scrubber
    const cursor = svg("line", { y1: pad.t, y2: H - pad.b, stroke: "#9c7a1c", "stroke-width": "1", "stroke-dasharray": "3 3", visibility: "hidden" });
    const dot = svg("circle", { r: "4", fill: "#f0d77b", visibility: "hidden" });
    root.append(cursor, dot);
    box.append(root);

    const tip = $("#chart-tip");
    const defaultTip = "المس المنحنى لعرض السعر";
    tip.textContent = defaultTip;
    const scrub = (clientX) => {
      const r = root.getBoundingClientRect();
      const px = ((clientX - r.left) / r.width) * W;
      const t = t0 + ((px - pad.l) / (W - pad.l - pad.r)) * (t1 - t0);
      let best = pts[0];
      for (const p of pts) if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
      const cx = x(best.t);
      const cy = y(best.p);
      cursor.setAttribute("x1", cx);
      cursor.setAttribute("x2", cx);
      dot.setAttribute("cx", cx);
      dot.setAttribute("cy", cy);
      cursor.setAttribute("visibility", "visible");
      dot.setAttribute("visibility", "visible");
      tip.textContent = `${timeFmt.format(new Date(best.t * 1000))} — $${money(best.p)}`;
    };
    const hide = () => {
      cursor.setAttribute("visibility", "hidden");
      dot.setAttribute("visibility", "hidden");
      tip.textContent = defaultTip;
    };
    root.addEventListener("pointerdown", (e) => scrub(e.clientX));
    root.addEventListener("pointermove", (e) => (e.pointerType === "mouse" || e.buttons) && scrub(e.clientX));
    // Touch pointers fire pointerleave right after pointerup, so only mice hide on leave;
    // fingers keep the reading visible for a moment after lifting.
    let hideTimer;
    root.addEventListener("pointerleave", (e) => e.pointerType === "mouse" && hide());
    root.addEventListener("pointerup", (e) => {
      if (e.pointerType === "mouse") return;
      clearTimeout(hideTimer);
      hideTimer = setTimeout(hide, 2500);
    });

    $("#chart-range").textContent = `$${fmt0.format(Math.min(...pts.map((p) => p.p)))} – $${fmt0.format(Math.max(...pts.map((p) => p.p)))}`;
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
    if ("Notification" in window && Notification.permission === "granted") {
      try {
        const reg = await navigator.serviceWorker?.getRegistration();
        if (reg) await reg.showNotification(title, { body, icon: "./icons/icon-192.png", badge: "./icons/icon-192.png", lang: "ar", dir: "rtl", tag: "gold-alert-" + Date.now() });
        else new Notification(title, { body, icon: "./icons/icon-192.png" });
      } catch {
        /* toast already shown */
      }
    }
  }

  function setupNotifButton() {
    const btn = $("#notif-btn");
    if (!("Notification" in window) || Notification.permission !== "default") {
      btn.hidden = true;
      return;
    }
    btn.hidden = false;
    btn.onclick = async () => {
      unlockAudio();
      const p = await Notification.requestPermission();
      btn.hidden = true;
      toast(p === "granted" ? "تم تفعيل الإشعارات" : "لم يتم تفعيل الإشعارات", p === "granted" ? "ستظهر التنبيهات أيضاً في إشعارات الجهاز." : "يمكنك تفعيلها لاحقاً من إعدادات الجهاز.", "info", 5000);
    };
  }

  // ------------------------------------------------------------- alerts --
  const dirLabel = (d) => (d === "above" ? "أعلى من" : "أقل من");
  const saveAlerts = () => store.set(KEYS.alerts, state.alerts);

  function checkAlerts() {
    const price = state.last?.price;
    if (!price) return;
    let changed = false;
    for (const a of state.alerts) {
      if (a.triggeredAt) continue;
      const g = gramSar(price, a.karat);
      const hit = a.dir === "above" ? g >= a.price : g <= a.price;
      if (!hit) continue;
      a.triggeredAt = new Date().toISOString();
      a.triggeredValue = g;
      changed = true;
      notify(`🔔 عيار ${a.karat} ${dirLabel(a.dir)} ${money(a.price)} ريال`, `سعر الجرام الآن ${money(g)} ريال`);
    }
    if (changed) {
      saveAlerts();
      renderAlerts();
    }
  }

  function renderAlerts() {
    const list = $("#alert-list");
    if (!state.alerts.length) {
      list.replaceChildren(h("li", { class: "empty" }, "لا توجد تنبيهات بعد."));
      return;
    }
    const price = state.last?.price;
    list.replaceChildren(
      ...state.alerts.map((a) => {
        const now = price ? gramSar(price, a.karat) : NaN;
        return h(
          "li",
          { class: `item${a.triggeredAt ? " hit" : ""}` },
          h(
            "div",
            { class: "main" },
            h("span", { class: "title" }, `عيار ${a.karat} ${dirLabel(a.dir)} `, h("span", { class: "num" }, money(a.price)), " ريال", a.triggeredAt ? h("span", { class: "badge" }, "تحقق ✓") : null),
            h(
              "span",
              { class: "meta" },
              a.triggeredAt
                ? `تحقق ${dateTimeFmt.format(new Date(a.triggeredAt))} عند ${money(a.triggeredValue)} ريال`
                : `السعر الحالي ${money(now)} ريال`,
            ),
          ),
          h(
            "div",
            { class: "actions" },
            a.triggeredAt
              ? h("button", { class: "mini", type: "button", onclick: () => rearm(a.id) }, "إعادة تفعيل")
              : null,
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
    saveAlerts();
    renderAlerts();
    checkAlerts();
  }

  function removeAlert(id) {
    if (!confirm("حذف هذا التنبيه؟")) return;
    state.alerts = state.alerts.filter((x) => x.id !== id);
    saveAlerts();
    renderAlerts();
  }

  function renderAlertHint() {
    const form = $("#alert-form");
    const k = Number(form.karat.value);
    const price = state.last?.price;
    $("#alert-hint").textContent = price ? `سعر الجرام الحالي لعيار ${k}: ${money(gramSar(price, k))} ريال` : "";
  }

  function setupAlertForm() {
    const form = $("#alert-form");
    const err = $("#alert-error");
    form.karat.addEventListener("change", renderAlertHint);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      unlockAudio();
      const price = parseNum(form.price.value);
      if (!(price > 0)) {
        err.textContent = "أدخل سعراً صحيحاً للجرام بالريال";
        err.hidden = false;
        return;
      }
      err.hidden = true;
      state.alerts.unshift({ id: uid(), karat: Number(form.karat.value), dir: form.dir.value, price, createdAt: new Date().toISOString(), triggeredAt: null });
      saveAlerts();
      form.price.value = "";
      renderAlerts();
      toast("تمت إضافة التنبيه", "سيُفحص مع كل تحديث للسعر.", "info", 3500);
      checkAlerts();
    });
  }

  // --------------------------------------------------------- purchases --
  const saveBuys = () => store.set(KEYS.buys, state.buys);

  function valuation(b, price) {
    const value = price ? b.weight * gramSar(price, b.karat) : NaN;
    const pl = value - b.paid;
    return { value, pl, pct: (pl / b.paid) * 100 };
  }

  function plClass(v) {
    return !Number.isFinite(v) || Math.abs(v) < 0.005 ? "" : v > 0 ? "up" : "down";
  }

  function renderBuys() {
    const price = state.last?.price;
    const list = $("#buy-list");
    const buys = state.buys.slice().sort((a, b) => (b.date || "").localeCompare(a.date || "") || b.createdAt.localeCompare(a.createdAt));
    if (!buys.length) {
      list.replaceChildren(h("li", { class: "empty" }, "لا توجد عمليات شراء بعد."));
    } else {
      list.replaceChildren(
        ...buys.map((b) => {
          const v = valuation(b, price);
          const cls = plClass(v.pl);
          return h(
            "li",
            { class: "item buy" },
            h(
              "div",
              { class: "top" },
              h(
                "div",
                { class: "main" },
                h("span", { class: "title" }, `عيار ${b.karat} · `, h("span", { class: "num" }, fmtW.format(b.weight)), " جم"),
                h("span", { class: "meta" }, b.date ? dateFmt.format(new Date(b.date + "T12:00:00")) : ""),
              ),
              h(
                "div",
                { class: "actions" },
                h("button", { class: "mini", type: "button", onclick: () => editBuy(b.id) }, "تعديل"),
                h("button", { class: "mini danger", type: "button", onclick: () => removeBuy(b.id) }, "حذف"),
              ),
            ),
            h(
              "div",
              { class: "nums" },
              h("div", {}, h("span", { class: "muted small" }, "المدفوع"), h("b", { class: "num" }, money(b.paid))),
              h("div", {}, h("span", { class: "muted small" }, "القيمة الآن"), h("b", { class: "num" }, money(v.value))),
              h("div", {}, h("span", { class: "muted small" }, "الربح/الخسارة"), h("b", { class: `num ${cls}` }, signed(v.pl)), h("span", { class: `num small ${cls}` }, signed(v.pct, "%"))),
            ),
          );
        }),
      );
    }

    // totals
    const paid = buys.reduce((s, b) => s + b.paid, 0);
    const value = price ? buys.reduce((s, b) => s + valuation(b, price).value, 0) : NaN;
    const pl = value - paid;
    const pct = paid ? (pl / paid) * 100 : NaN;
    $("#sum-paid").textContent = buys.length ? money(paid) : "—";
    $("#sum-value").textContent = buys.length ? money(value) : "—";
    const plEl = $("#sum-pl");
    plEl.className = `pl num ${buys.length ? plClass(pl) : ""}`;
    plEl.textContent = buys.length ? `${signed(pl)} ريال (${signed(pct, "%")})` : "—";
    const grams = buys.reduce((s, b) => s + b.weight, 0);
    const pure = buys.reduce((s, b) => s + (b.weight * b.karat) / 24, 0);
    $("#sum-weights").textContent = buys.length ? `الوزن الإجمالي ${fmtW.format(grams)} جم (${fmtW.format(pure)} جم ذهب خالص)` : "";
  }

  function resetBuyForm() {
    const form = $("#buy-form");
    form.reset();
    form.editId.value = "";
    form.date.value = new Date().toLocaleDateString("en-CA");
    $("#buy-title").textContent = "إضافة عملية شراء";
    $("#buy-submit").textContent = "حفظ";
    $("#buy-cancel").hidden = true;
    $("#buy-error").hidden = true;
  }

  function editBuy(id) {
    const b = state.buys.find((x) => x.id === id);
    if (!b) return;
    const form = $("#buy-form");
    form.editId.value = b.id;
    form.date.value = b.date;
    form.karat.value = String(b.karat);
    form.weight.value = String(b.weight);
    form.paid.value = String(b.paid);
    $("#buy-title").textContent = "تعديل عملية الشراء";
    $("#buy-submit").textContent = "حفظ التعديل";
    $("#buy-cancel").hidden = false;
    form.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function removeBuy(id) {
    if (!confirm("حذف عملية الشراء هذه؟")) return;
    state.buys = state.buys.filter((x) => x.id !== id);
    saveBuys();
    if ($("#buy-form").editId.value === id) resetBuyForm();
    renderBuys();
  }

  function setupBuyForm() {
    const form = $("#buy-form");
    const err = $("#buy-error");
    resetBuyForm();
    $("#buy-cancel").addEventListener("click", resetBuyForm);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const weight = parseNum(form.weight.value);
      const paid = parseNum(form.paid.value);
      const date = form.date.value;
      const problem = !date ? "اختر التاريخ" : !(weight > 0) ? "أدخل الوزن بالجرام" : !(paid > 0) ? "أدخل المبلغ المدفوع بالريال" : "";
      if (problem) {
        err.textContent = problem;
        err.hidden = false;
        return;
      }
      const data = { date, karat: Number(form.karat.value), weight, paid };
      const id = form.editId.value;
      if (id) {
        const b = state.buys.find((x) => x.id === id);
        if (b) Object.assign(b, data);
      } else {
        state.buys.push({ id: uid(), createdAt: new Date().toISOString(), ...data });
      }
      saveBuys();
      resetBuyForm();
      renderBuys();
      toast(id ? "تم حفظ التعديل" : "تمت إضافة عملية الشراء", "", "info", 2500);
    });
  }

  // --------------------------------------------------------------- tabs --
  function showTab(name) {
    document.querySelectorAll(".tab").forEach((t) => (t.dataset.active = String(t.id === `tab-${name}`)));
    document.querySelectorAll(".tabbar button").forEach((b) => (b.dataset.tab === name ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current")));
    store.set(KEYS.tab, name);
    window.scrollTo({ top: 0 });
    if (name === "home") renderChart(); // size depends on visibility
  }

  // --------------------------------------------------------------- boot --
  function boot() {
    document.querySelectorAll(".tabbar button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
    showTab(["home", "alerts", "buys"].includes(store.get(KEYS.tab, "home")) ? store.get(KEYS.tab, "home") : "home");
    setupAlertForm();
    setupBuyForm();
    setupNotifButton();

    // Show what we have immediately (works offline), then go to the network.
    renderPrice();
    renderAlerts();
    renderBuys();
    renderAlertHint();
    renderStatus();
    refreshAll(true);

    $("#refresh").addEventListener("click", () => refreshAll(true));
    setInterval(() => {
      if (document.visibilityState === "visible") {
        refreshSpot();
        refreshSeries();
      }
    }, REFRESH_MS);
    setInterval(renderStatus, 10_000);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") return;
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

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(() => {});
    }
  }

  boot();
})();
