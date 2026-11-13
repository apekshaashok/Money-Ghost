// Renders docs/diagrams/*.mmd to SVG + PNG with Mermaid in headless Chrome.
//   node scripts/render-diagrams.mjs
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const dir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'docs', 'diagrams');
const CHROME = process.env.CHROME_PATH || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => fs.existsSync(p));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, defaultViewport: { width: 1800, height: 1200, deviceScaleFactor: 2 } });
const page = await browser.newPage();
await page.setContent(`<!doctype html><html><body style="margin:0;background:#fff">
  <div id="out"></div>
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js"></script></body></html>`, { waitUntil: 'networkidle0' });
await page.evaluate(() => window.mermaid.initialize({ startOnLoad: false, theme: 'neutral', fontFamily: 'Helvetica, Arial, sans-serif',
  er: { layoutDirection: 'TB', minEntityWidth: 120 }, flowchart: { curve: 'basis' } }));
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.mmd'))) {
  const src = fs.readFileSync(path.join(dir, file), 'utf8');
  const name = file.replace(/\.mmd$/, '');
  const svg = await page.evaluate(async (code, id) => {
    const { svg } = await window.mermaid.render(id, code);
    document.getElementById('out').innerHTML = svg;
    return svg;
  }, src, `d_${name.replace(/\W/g, '_')}`);
  fs.writeFileSync(path.join(dir, `${name}.svg`), svg);
  const el = await page.$('#out svg');
  await el.screenshot({ path: path.join(dir, `${name}.png`) });
  console.log(`  rendered ${name}.svg / .png`);
}
await browser.close();
