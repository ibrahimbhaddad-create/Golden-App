import { describe, expect, it } from "vitest";
import https from "node:https";
import type http from "node:http";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createECDH, randomBytes } from "node:crypto";
import { generateVAPIDKeys, sendNotification } from "web-push";

describe("web push", () => {
  it("sends an encrypted, VAPID-signed notification to a push endpoint", async () => {
    const vapid = generateVAPIDKeys();
    const ecdh = createECDH("prime256v1");
    ecdh.generateKeys();
    const sub = {
      keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") },
    };
    let got: { headers: http.IncomingHttpHeaders; body: Buffer } | null = null;
    const dir = mkdtempSync(path.join(tmpdir(), "push-"));
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=127.0.0.1", "-days", "1", "-keyout", path.join(dir, "k.pem"), "-out", path.join(dir, "c.pem")], { stdio: "ignore" });
    const server = https.createServer({ key: readFileSync(path.join(dir, "k.pem")), cert: readFileSync(path.join(dir, "c.pem")) }, (req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        got = { headers: req.headers, body: Buffer.concat(chunks) };
        res.writeHead(201).end();
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    try {
      const r = await sendNotification(
        { endpoint: `https://127.0.0.1:${port}/push/abc`, ...sub },
        JSON.stringify({ title: "اختبار", body: "مرحبا" }),
        { vapidDetails: { subject: "mailto:test@example.com", publicKey: vapid.publicKey, privateKey: vapid.privateKey }, TTL: 60, agent: new https.Agent({ rejectUnauthorized: false }) },
      );
      expect(r.statusCode).toBe(201);
      expect(got!.headers["content-encoding"]).toBe("aes128gcm");
      expect(String(got!.headers.authorization)).toMatch(/^vapid t=.+, k=/);
      expect(got!.body.length).toBeGreaterThan(50);
    } finally {
      server.close();
    }
  });
});
