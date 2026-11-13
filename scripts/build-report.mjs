// npm run report  ->  docs/Money_Ghosts_Report.pdf  (Markdown -> HTML -> PDF with headless Chrome)
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { marked } from 'marked';
import puppeteer from 'puppeteer-core';

const docs = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'docs');
const CHROME = process.env.CHROME_PATH || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => fs.existsSync(p));
const md = fs.readFileSync(path.join(docs, 'REPORT.md'), 'utf8')
  + '\n\n<div class="pb"></div>\n\n' + fs.readFileSync(path.join(docs, 'TEST_RESULTS.md'), 'utf8').replace(/^# /m, '# Appendix A — ')
  + '\n\n<div class="pb"></div>\n\n' + fs.readFileSync(path.join(docs, 'DATA_DICTIONARY.md'), 'utf8').replace(/^# /m, '# Appendix B — ');
const html = `<!doctype html><html><head><meta charset="utf-8"><base href="${pathToFileURL(docs + '/').href}">
<style>
  body { font-family: -apple-system, "Helvetica Neue", Arial, sans-serif; font-size: 10.5pt; line-height: 1.5; color: #1b2230; }
  h1 { font-size: 20pt; border-bottom: 2px solid #5847d6; padding-bottom: 6px; }
  h2 { font-size: 14pt; color: #3a2db0; margin-top: 22px; page-break-after: avoid; }
  h3 { font-size: 11.5pt; page-break-after: avoid; }
  table { border-collapse: collapse; width: 100%; margin: 8px 0; font-size: 9pt; page-break-inside: auto; }
  tr { page-break-inside: avoid; }
  th, td { border: 1px solid #ddd; padding: 4px 6px; text-align: left; vertical-align: top; }
  th { background: #f2f0fb; }
  code { font-family: Menlo, monospace; font-size: 8.5pt; background: #f4f3ef; padding: 1px 3px; border-radius: 3px; }
  pre { background: #f4f3ef; padding: 8px; border-radius: 6px; font-size: 8pt; white-space: pre-wrap; page-break-inside: avoid; }
  pre code { background: none; padding: 0; }
  img { max-width: 100%; border: 1px solid #e4e2da; border-radius: 4px; }
  blockquote { border-left: 3px solid #5847d6; margin: 8px 0; padding: 2px 12px; color: #4a5263; }
  .pb { page-break-after: always; }
</style></head><body>${marked.parse(md)}</body></html>`;
const tmp = path.join(docs, '.report.html');
fs.writeFileSync(tmp, html);
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();
await page.goto(pathToFileURL(tmp).href, { waitUntil: 'networkidle0' });
await page.pdf({ path: path.join(docs, 'Money_Ghosts_Report.pdf'), format: 'A4', printBackground: true,
  margin: { top: '16mm', bottom: '16mm', left: '14mm', right: '14mm' },
  displayHeaderFooter: true, headerTemplate: '<span></span>',
  footerTemplate: '<div style="font-size:8px;width:100%;text-align:center;color:#888">Money Ghosts — DBMS Level 3 · page <span class="pageNumber"></span> / <span class="totalPages"></span></div>' });
await browser.close();
fs.unlinkSync(tmp);
console.log('Wrote docs/Money_Ghosts_Report.pdf');
