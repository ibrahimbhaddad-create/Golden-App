// node --test test/  — verifies our WebCrypto push implementation against independent code.
import test from "node:test";
import assert from "node:assert/strict";
import { createECDH, createPublicKey, verify, randomBytes } from "node:crypto";
import ece from "http_ece";
import { encryptPayload, generateVapidKeys, vapidJwt, isAllowedEndpoint, unb64u, b64u } from "../src/webpush.js";

test("aes128gcm payload decrypts with http_ece (RFC 8291)", async () => {
  const ua = createECDH("prime256v1");
  ua.generateKeys();
  const auth = randomBytes(16);
  const msg = JSON.stringify({ title: "🔔 عيار 21 أعلى من 330 ريال", body: "سعر الجرام الآن 331.20 ريال" });
  const body = await encryptPayload(msg, b64u(ua.getPublicKey()), b64u(auth));
  const out = ece.decrypt(Buffer.from(body), { version: "aes128gcm", privateKey: ua, authSecret: auth });
  assert.equal(out.toString("utf8"), msg);
  // header layout: salt(16) rs(4)=4096 idlen(1)=65 keyid(65)
  assert.equal(Buffer.from(body.slice(16, 20)).readUInt32BE(0), 4096);
  assert.equal(body[20], 65);
});

test("rejects malformed subscription keys", async () => {
  await assert.rejects(encryptPayload("x", b64u(new Uint8Array(10)), b64u(new Uint8Array(16))));
});

test("VAPID JWT is a valid ES256 signature over header.claims", async () => {
  const { publicKey, privateJwk } = await generateVapidKeys();
  assert.equal(unb64u(publicKey).length, 65);
  const { jwt, exp } = await vapidJwt("https://web.push.apple.com", "https://example.com/app/", privateJwk);
  const [h, c, s] = jwt.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(h, "base64url")), { typ: "JWT", alg: "ES256" });
  const claims = JSON.parse(Buffer.from(c, "base64url"));
  assert.equal(claims.aud, "https://web.push.apple.com");
  assert.equal(claims.sub, "https://example.com/app/");
  assert.ok(exp > Date.now() / 1000 + 3600 && exp <= Date.now() / 1000 + 24 * 3600);
  const pub = createPublicKey({ key: { kty: "EC", crv: "P-256", x: privateJwk.x, y: privateJwk.y }, format: "jwk" });
  const ok = verify("sha256", Buffer.from(`${h}.${c}`), { key: pub, dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url"));
  assert.ok(ok, "signature verifies");
});

test("endpoint allow-list", () => {
  assert.ok(isAllowedEndpoint("https://web.push.apple.com/QGx..."));
  assert.ok(isAllowedEndpoint("https://fcm.googleapis.com/fcm/send/abc"));
  assert.ok(isAllowedEndpoint("https://wns2-par02p.notify.windows.com/w/?token=1"));
  assert.ok(!isAllowedEndpoint("https://evil.example.com/push"));
  assert.ok(!isAllowedEndpoint("http://web.push.apple.com/x"));
  assert.ok(!isAllowedEndpoint("http://127.0.0.1:9/x"));
  assert.ok(isAllowedEndpoint("http://127.0.0.1:9/x", true));
});
