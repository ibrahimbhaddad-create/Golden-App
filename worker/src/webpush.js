// Web Push for Cloudflare Workers using only WebCrypto.
// - Payload encryption: RFC 8291 (aes128gcm, RFC 8188)
// - Server identification: VAPID, RFC 8292 (ES256 JWT)

const enc = new TextEncoder();

export function b64u(bytes) {
  let s = "";
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function unb64u(str) {
  const s = String(str).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s + "===".slice((s.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concat(...parts) {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

async function hmac(keyBytes, data) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, data));
}

/** HKDF-Expand for a single block (length ≤ 32). */
async function hkdfExpand1(prk, info, length) {
  return (await hmac(prk, concat(info, new Uint8Array([1])))).slice(0, length);
}

/**
 * Encrypt `payload` (string) for a subscription's p256dh/auth keys.
 * Returns the aes128gcm body (header + single record).
 */
export async function encryptPayload(payload, p256dh, authSecret, { salt, localKeys } = {}) {
  const uaPublic = unb64u(p256dh);
  const auth = unb64u(authSecret);
  if (uaPublic.length !== 65 || auth.length < 16) throw new Error("bad subscription keys");

  const keys = localKeys ?? (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]));
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, keys.privateKey, 256));

  // RFC 8291 §3.4
  const prkKey = await hmac(auth, ecdhSecret);
  const keyInfo = concat(enc.encode("WebPush: info\0"), uaPublic, asPublic);
  const ikm = await hkdfExpand1(prkKey, keyInfo, 32);

  // RFC 8188 §2.2
  const s = salt ?? crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(s, ikm);
  const cek = await hkdfExpand1(prk, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdfExpand1(prk, enc.encode("Content-Encoding: nonce\0"), 12);

  const plaintext = concat(enc.encode(payload), new Uint8Array([2])); // last-record delimiter
  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aes, plaintext));

  const rs = 4096;
  const header = concat(s, new Uint8Array([(rs >>> 24) & 255, (rs >>> 16) & 255, (rs >>> 8) & 255, rs & 255]), new Uint8Array([asPublic.length]), asPublic);
  return concat(header, ciphertext);
}

/** New VAPID key pair: { publicKey (b64url raw, for applicationServerKey), privateJwk }. */
export async function generateVapidKeys() {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  const privateJwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
  return { publicKey: b64u(pub), privateJwk };
}

/** ES256-signed VAPID JWT for the push service origin. */
export async function vapidJwt(audience, subject, privateJwk, ttlSeconds = 12 * 3600) {
  const header = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const claims = b64u(enc.encode(JSON.stringify({ aud: audience, exp, sub: subject })));
  const key = await crypto.subtle.importKey("jwk", privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${header}.${claims}`)));
  return { jwt: `${header}.${claims}.${b64u(sig)}`, exp };
}

/** Push services we are willing to call (prevents using the worker to hit arbitrary URLs). */
export function isAllowedEndpoint(url, allowHttp = false) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (allowHttp && u.protocol === "http:" && (u.hostname === "127.0.0.1" || u.hostname === "localhost")) return true;
  if (u.protocol !== "https:") return false;
  const h = u.hostname;
  return (
    h === "web.push.apple.com" ||
    h === "fcm.googleapis.com" ||
    h === "updates.push.services.mozilla.com" ||
    h.endsWith(".push.apple.com") ||
    h.endsWith(".notify.windows.com") ||
    h.endsWith(".push.services.mozilla.com")
  );
}

/**
 * Send one push. `getJwt(audience)` returns a cached VAPID JWT.
 * Resolves to { ok, status, gone } where gone=true means the subscription is dead.
 */
export async function sendPush(subscription, payloadObj, { publicKey, getJwt, ttl = 86400, urgency = "high" }) {
  const body = await encryptPayload(JSON.stringify(payloadObj), subscription.keys.p256dh, subscription.keys.auth);
  const audience = new URL(subscription.endpoint).origin;
  const jwt = await getJwt(audience);
  const res = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      TTL: String(ttl),
      Urgency: urgency,
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      Authorization: `vapid t=${jwt}, k=${publicKey}`,
    },
    body,
  });
  return { ok: res.ok, status: res.status, gone: res.status === 404 || res.status === 410 };
}
