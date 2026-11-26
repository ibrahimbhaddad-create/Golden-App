// Renders scripts/icon.svg to the PNG sizes the PWA needs. Run: node scripts/gen-icons.cjs
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const svg = fs.readFileSync(path.join(__dirname, "icon.svg"), "utf8");
const out = path.join(__dirname, "..", "public", "icons");
fs.mkdirSync(out, { recursive: true });

const jobs = [
  { file: "icon-192.png", size: 192, pad: 0, radius: 0 },
  { file: "icon-512.png", size: 512, pad: 0, radius: 0 },
  { file: "apple-touch-icon.png", size: 180, pad: 0, radius: 0 },
  { file: "maskable-512.png", size: 512, pad: 0.12, radius: 0 },
  { file: "favicon-32.png", size: 32, pad: 0, radius: 0 },
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const j of jobs) {
    const inner = Math.round(j.size * (1 - 2 * j.pad));
    await page.setViewportSize({ width: j.size, height: j.size });
    await page.setContent(
      `<html><body style="margin:0;background:#0b0a08;display:grid;place-items:center;width:${j.size}px;height:${j.size}px">` +
        `<div style="width:${inner}px;height:${inner}px">${svg.replace("<svg ", `<svg width="${inner}" height="${inner}" `)}</div></body></html>`,
    );
    await page.screenshot({ path: path.join(out, j.file), omitBackground: false });
  }
  // Monochrome badge for Android status bar (white on transparent).
  await page.setViewportSize({ width: 72, height: 72 });
  await page.setContent(
    `<html><body style="margin:0;background:transparent"><svg width="72" height="72" viewBox="0 0 512 512"><polygon points="146,330 366,330 400,392 112,392" fill="#fff"/><polygon points="176,282 336,282 366,330 146,330" fill="#fff"/><polyline points="120,236 196,180 250,206 330,128 392,128" fill="none" stroke="#fff" stroke-width="30" stroke-linecap="round" stroke-linejoin="round"/></svg></body></html>`,
  );
  await page.screenshot({ path: path.join(out, "badge-72.png"), omitBackground: true });
  await browser.close();
  console.log("icons written to", out);
})();
