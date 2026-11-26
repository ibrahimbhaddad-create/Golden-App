// TEST-ONLY stand-in for the slice of Supabase (PostgREST + GoTrue) this app
// uses, backed by a real local Postgres so RLS is enforced per request.
// Not a general implementation — just enough for scripts/e2e.sh.
//
//   PGURL=postgres://postgres@/postgres?host=/tmp&port=55432 node tests/e2e/mini-supabase.mjs
//
// Any OTP code "123456" is accepted. Sent OTPs are logged to stdout.
import http from "node:http";
import { randomUUID } from "node:crypto";
import pg from "pg";

pg.types.setTypeParser(1700, (v) => (v == null ? null : Number(v))); // numeric
pg.types.setTypeParser(20, (v) => (v == null ? null : Number(v))); // int8

const PORT = Number(process.env.MINI_SUPABASE_PORT ?? 54321);
const SERVICE_KEY = process.env.SERVICE_KEY ?? "service-role-test-key";
const pool = new pg.Pool({ connectionString: process.env.PGURL });

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const makeJwt = (sub, email) => {
  const now = Math.floor(Date.now() / 1000);
  return `${b64u({ alg: "HS256", typ: "JWT" })}.${b64u({ sub, email, role: "authenticated", aud: "authenticated", iat: now, exp: now + 3600 })}.sig`;
};
const readJwt = (t) => {
  try {
    return JSON.parse(Buffer.from(t.split(".")[1], "base64url").toString());
  } catch {
    return null;
  }
};

async function body(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const s = Buffer.concat(chunks).toString();
  return s ? JSON.parse(s) : {};
}

function send(res, status, data, headers = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(data === undefined ? "" : JSON.stringify(data));
}

// ---------------------------------------------------------------- auth ----
const userJson = (u) => ({
  id: u.id,
  aud: "authenticated",
  role: "authenticated",
  email: u.email,
  email_confirmed_at: u.created_at,
  app_metadata: u.raw_app_meta_data ?? {},
  user_metadata: u.raw_user_meta_data ?? {},
  created_at: u.created_at,
  updated_at: u.created_at,
  identities: [],
});

function session(u) {
  const now = Math.floor(Date.now() / 1000);
  return {
    access_token: makeJwt(u.id, u.email),
    token_type: "bearer",
    expires_in: 3600,
    expires_at: now + 3600,
    refresh_token: `rt-${u.id}`,
    user: userJson(u),
  };
}

async function findUserByEmail(email) {
  const { rows } = await pool.query("select * from auth.users where lower(email) = lower($1)", [email]);
  return rows[0];
}

async function auth(req, res, path, url) {
  const authz = req.headers.authorization?.replace(/^Bearer /, "") ?? "";
  if (path === "/otp" && req.method === "POST") {
    const b = await body(req);
    const u = await findUserByEmail(b.email);
    if (!u && b.create_user === false) return send(res, 422, { code: 422, error_code: "otp_disabled", msg: "Signups not allowed for otp" });
    console.log(`[mini-supabase] OTP for ${b.email}: 123456`);
    return send(res, 200, {});
  }
  if (path === "/verify" && req.method === "POST") {
    const b = await body(req);
    const u = await findUserByEmail(b.email ?? "");
    if (!u || b.token !== "123456") return send(res, 403, { code: 403, error_code: "otp_expired", msg: "Token has expired or is invalid" });
    return send(res, 200, session(u));
  }
  if (path === "/token" && url.searchParams.get("grant_type") === "refresh_token") {
    const b = await body(req);
    const id = String(b.refresh_token ?? "").replace(/^rt-/, "");
    const { rows } = await pool.query("select * from auth.users where id::text = $1", [id]);
    if (!rows[0]) return send(res, 400, { error: "invalid_grant" });
    return send(res, 200, session(rows[0]));
  }
  if (path === "/user" && req.method === "GET") {
    const claims = readJwt(authz);
    if (!claims?.sub || claims.exp < Date.now() / 1000) return send(res, 401, { code: 401, msg: "invalid JWT" });
    const { rows } = await pool.query("select * from auth.users where id = $1", [claims.sub]);
    if (!rows[0]) return send(res, 403, { code: 403, error_code: "user_not_found", msg: "User not found" });
    return send(res, 200, userJson(rows[0]));
  }
  if (path === "/logout") return send(res, 204);
  // ---- admin (service role only)
  if (path.startsWith("/admin/") || path === "/invite") {
    if (authz !== SERVICE_KEY) return send(res, 401, { msg: "service role required" });
    if (path === "/admin/users" && req.method === "POST") {
      const b = await body(req);
      if (await findUserByEmail(b.email)) return send(res, 422, { code: 422, error_code: "email_exists", msg: "A user with this email address has already been registered" });
      const { rows } = await pool.query(
        "insert into auth.users (email, raw_app_meta_data, raw_user_meta_data) values ($1, $2, $3) returning *",
        [b.email, b.app_metadata ?? {}, b.user_metadata ?? {}],
      );
      return send(res, 200, userJson(rows[0]));
    }
    if (path === "/invite" && req.method === "POST") {
      const b = await body(req);
      const { rows } = await pool.query("insert into auth.users (email) values ($1) returning *", [b.email]);
      console.log(`[mini-supabase] invite email to ${b.email} redirect=${b.redirect_to ?? ""}`);
      return send(res, 200, userJson(rows[0]));
    }
    const m = path.match(/^\/admin\/users\/([0-9a-f-]{36})$/);
    if (m && req.method === "DELETE") {
      await pool.query("delete from auth.users where id = $1", [m[1]]);
      return send(res, 200, {});
    }
  }
  return send(res, 404, { msg: `mini-supabase: unsupported auth route ${req.method} ${path}` });
}

// ---------------------------------------------------------------- rest ----
const ident = (s) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`bad identifier ${s}`);
  return `"${s}"`;
};

function parseSelect(sel, table) {
  // supports "*", "a,b", and embeds like "*, profiles!inner(status, telegram_chat_id)"
  const parts = [];
  let depth = 0;
  let cur = "";
  for (const ch of sel ?? "*") {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  const cols = [];
  const joins = [];
  for (const p of parts) {
    const em = p.match(/^([a-z_]+)(!inner)?\((.*)\)$/);
    if (em) {
      const [, rel, , inner] = em;
      const fields = inner.split(",").map((f) => f.trim());
      cols.push(`json_build_object(${fields.map((f) => `'${f}', ${ident(rel)}.${ident(f)}`).join(", ")}) as ${ident(rel)}`);
      joins.push(`join public.${ident(rel)} on ${ident(rel)}.id = ${ident(table)}.user_id`);
    } else if (p === "*") cols.push(`${ident(table)}.*`);
    else cols.push(`${ident(table)}.${ident(p)}`);
  }
  return { cols: cols.join(", "), joins: joins.join(" ") };
}

const OPS = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=", like: "like", ilike: "ilike" };

function where(url, table, params) {
  const conds = [];
  for (const [key, raw] of url.searchParams) {
    if (["select", "order", "limit", "offset", "on_conflict", "columns"].includes(key)) continue;
    const [colRaw] = [key];
    const col = colRaw.includes(".") ? colRaw.split(".").map(ident).join(".") : `${ident(table)}.${ident(colRaw)}`;
    const dot = raw.indexOf(".");
    const op = raw.slice(0, dot);
    const val = raw.slice(dot + 1);
    if (op === "is") conds.push(`${col} is ${val === "null" ? "null" : val === "true" ? "true" : "false"}`);
    else if (op === "in") {
      params.push(val.replace(/^\(|\)$/g, "").split(",").map((v) => v.replace(/^"|"$/g, "")));
      conds.push(`${col}::text = any($${params.length}::text[])`);
    } else if (OPS[op]) {
      params.push(op.endsWith("like") ? val.replace(/\*/g, "%") : val);
      conds.push(`${col} ${OPS[op]} $${params.length}`);
    } else throw new Error(`unsupported filter ${key}=${raw}`);
  }
  return conds.length ? `where ${conds.join(" and ")}` : "";
}

function orderLimit(url, table) {
  let s = "";
  const order = url.searchParams.get("order");
  if (order) {
    s += " order by " + order.split(",").map((o) => {
      const [c, dir] = o.split(".");
      return `${ident(table)}.${ident(c)} ${dir === "desc" ? "desc" : "asc"}`;
    }).join(", ");
  }
  const limit = url.searchParams.get("limit");
  if (limit) s += ` limit ${Number(limit)}`;
  return s;
}

async function withRole(req, fn) {
  const authz = req.headers.authorization?.replace(/^Bearer /, "") ?? "";
  const client = await pool.connect();
  try {
    await client.query("begin");
    if (authz === SERVICE_KEY) {
      await client.query("set local role service_role");
    } else {
      const claims = readJwt(authz);
      if (claims?.sub) {
        await client.query("set local role authenticated");
        await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
      } else {
        await client.query("set local role anon");
      }
    }
    const out = await fn(client);
    await client.query("commit");
    return out;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

function pgError(res, e) {
  const status = e.code === "42501" ? 403 : e.code === "23505" ? 409 : e.code?.startsWith("23") ? 400 : 400;
  send(res, status, { code: e.code, message: e.message, details: null, hint: null });
}

async function rest(req, res, path, url) {
  const prefer = req.headers.prefer ?? "";
  const wantsObject = (req.headers.accept ?? "").includes("vnd.pgrst.object");
  const returning = prefer.includes("return=representation");
  const countExact = prefer.includes("count=exact");

  try {
    const rpc = path.match(/^\/rpc\/([a-z_]+)$/);
    if (rpc) {
      const b = await body(req);
      const params = [];
      const args = Object.entries(b).map(([k, v]) => {
        params.push(v);
        return `${ident(k)} => $${params.length}`;
      });
      const rows = await withRole(req, (c) => c.query(`select * from public.${ident(rpc[1])}(${args.join(", ")})`, params).then((r) => r.rows));
      return send(res, 200, rows);
    }

    const table = path.replace(/^\//, "");
    ident(table);
    const params = [];

    if (req.method === "GET" || req.method === "HEAD") {
      const { cols, joins } = parseSelect(url.searchParams.get("select"), table);
      const w = where(url, table, params);
      const sql = `select ${cols} from public.${ident(table)} ${joins} ${w} ${orderLimit(url, table)}`;
      const { rows, total } = await withRole(req, async (c) => {
        const r = await c.query(sql, params);
        const t = countExact ? (await c.query(`select count(*)::int as n from public.${ident(table)} ${joins} ${w}`, params)).rows[0].n : null;
        return { rows: r.rows, total: t };
      });
      const headers = countExact ? { "content-range": `0-${Math.max(rows.length - 1, 0)}/${total}` } : {};
      if (req.method === "HEAD") return send(res, 200, undefined, headers);
      if (wantsObject) {
        if (rows.length !== 1) return send(res, 406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: `The result contains ${rows.length} rows` });
        return send(res, 200, rows[0], headers);
      }
      return send(res, 200, rows, headers);
    }

    if (req.method === "POST") {
      const b = await body(req);
      const items = Array.isArray(b) ? b : [b];
      if (!items.length) return send(res, 201, []);
      const keys = [...new Set(items.flatMap((i) => Object.keys(i)))];
      const values = items.map((it) => `(${keys.map((k) => {
        if (!(k in it)) return "default";
        const v = it[k];
        params.push(v !== null && typeof v === "object" && !Array.isArray(v) ? JSON.stringify(v) : v);
        return `$${params.length}`;
      }).join(", ")})`);
      let sql = `insert into public.${ident(table)} (${keys.map(ident).join(", ")}) values ${values.join(", ")}`;
      const conflict = url.searchParams.get("on_conflict");
      if (prefer.includes("resolution=merge-duplicates")) {
        const target = conflict ? conflict.split(",").map(ident).join(", ") : '"id"';
        const upd = keys.filter((k) => !(conflict ?? "id").split(",").includes(k));
        sql += ` on conflict (${target}) do ${upd.length ? `update set ${upd.map((k) => `${ident(k)} = excluded.${ident(k)}`).join(", ")}` : "nothing"}`;
      }
      sql += " returning *";
      const rows = await withRole(req, (c) => c.query(sql, params).then((r) => r.rows));
      if (wantsObject) return send(res, 201, rows[0]);
      return send(res, 201, returning ? rows : undefined);
    }

    if (req.method === "PATCH") {
      const b = await body(req);
      const sets = Object.entries(b).map(([k, v]) => {
        params.push(v !== null && typeof v === "object" && !Array.isArray(v) ? JSON.stringify(v) : v);
        return `${ident(k)} = $${params.length}`;
      });
      const w = where(url, table, params);
      const { cols } = parseSelect(url.searchParams.get("select") ?? "*", table);
      const rows = await withRole(req, (c) => c.query(`update public.${ident(table)} set ${sets.join(", ")} ${w} returning ${cols}`, params).then((r) => r.rows));
      return send(res, 200, returning ? rows : undefined);
    }

    if (req.method === "DELETE") {
      const w = where(url, table, params);
      const rows = await withRole(req, (c) => c.query(`delete from public.${ident(table)} ${w} returning *`, params).then((r) => r.rows));
      return send(res, 200, returning ? rows : undefined);
    }
    return send(res, 405, { message: "method not allowed" });
  } catch (e) {
    if (!e.code) console.error("[mini-supabase]", req.method, req.url, e.message);
    return pgError(res, e);
  }
}

http
  .createServer(async (req, res) => {
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "*");
    res.setHeader("access-control-allow-methods", "GET,POST,PATCH,DELETE,HEAD,OPTIONS");
    if (req.method === "OPTIONS") return send(res, 204);
    const url = new URL(req.url, `http://${req.headers.host}`);
    try {
      if (url.pathname.startsWith("/auth/v1")) return await auth(req, res, url.pathname.slice(8), url);
      if (url.pathname.startsWith("/rest/v1")) return await rest(req, res, url.pathname.slice(8), url);
      return send(res, 404, { msg: "not found" });
    } catch (e) {
      console.error("[mini-supabase] error", e);
      return send(res, 500, { msg: e.message });
    }
  })
  .listen(PORT, "127.0.0.1", () => console.log(`[mini-supabase] listening on http://127.0.0.1:${PORT}`));
