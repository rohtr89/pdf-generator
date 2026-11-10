// Kreyasi invoice PDF server
// Browser (invoice page) -> POST /api/generate-pdf -> Playwright/Chromium makes the PDF
// -> uploaded to your existing Google Apps Script (Base64) -> your Drive folder.

const express = require('express');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const PORT = process.env.PORT || 3000;
const APPS_SCRIPT_URL =
  process.env.APPS_SCRIPT_URL ||
  'https://script.google.com/macros/s/AKfycbxgJ2XG7VVblvwnOMcBOQPA3O-4llS8AohBUpYEc3T-3qZhgIUKiEtuQDImona0g1EcbA/exec';

const app = express();
app.use(express.json({ limit: '10mb' }));

// Allow the page to call this server even if opened as a file:// document
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/health', (req, res) => res.send('ok'));
app.use(express.static(path.join(__dirname, 'public')));

// ---- Fonts: the reference invoice uses Segoe UI (Windows). Linux servers don't have it,
// so we embed Selawik (metric-compatible, open source) and a Noto Sans rupee glyph. ----
const fontPath = (f) => path.join(__dirname, 'fonts', f);
const b64 = (f) => fs.readFileSync(fontPath(f)).toString('base64');
// OPTIONAL: for a pixel-exact match, copy segoeui.ttf / segoeuib.ttf / segoeuii.ttf from
// C:\Windows\Fonts into the fonts/ folder (check Microsoft's font licence first). They are used automatically.
const pick = (segoe, fallback) => (fs.existsSync(fontPath(segoe)) ? segoe : fallback);
const ITALIC_CSS = fs.existsSync(fontPath('segoeuii.ttf'))
  ? `@font-face{font-family:'InvoiceSans';font-weight:400;font-style:italic;src:url(data:font/ttf;base64,${b64('segoeuii.ttf')}) format('truetype');}`
  : '';
const FONT_CSS = `
@font-face{font-family:'InvoiceSans';font-weight:400;font-style:normal;src:url(data:font/ttf;base64,${b64(pick('segoeui.ttf', 'selawk.ttf'))}) format('truetype');}
@font-face{font-family:'InvoiceSans';font-weight:700;font-style:normal;src:url(data:font/ttf;base64,${b64(pick('segoeuib.ttf', 'selawkb.ttf'))}) format('truetype');}
${ITALIC_CSS}
@font-face{font-family:'InvoiceSans';font-weight:400;src:url(data:font/woff2;base64,${b64('rupee-400.woff2')}) format('woff2');unicode-range:U+20B9;}
@font-face{font-family:'InvoiceSans';font-weight:700;src:url(data:font/woff2;base64,${b64('rupee-700.woff2')}) format('woff2');unicode-range:U+20B9;}
html, body, table, th, td, div, span, p, input, textarea, select, button { font-family:'InvoiceSans','Segoe UI',Arial,sans-serif !important; text-rendering:geometricPrecision; font-kerning:normal; }
body { background:#fff !important; }
/* the page's own print CSS removes the outer border; the reference PDF keeps it */
#invoiceContainer { border:2px solid #1f2937 !important; box-sizing:border-box; }
`;

// ---- One shared Chromium instance (fast; relaunches itself if it ever dies) ----
let browserPromise = null;
function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none', '--disable-lcd-text'] }).then((b) => {
      b.on('disconnected', () => { browserPromise = null; });
      return b;
    });
  }
  return browserPromise;
}

// ---- HTML -> PDF ----
// A4 paper, 100% scale, ~1 cm margins (set PAPER_FORMAT=Legal|Letter to change).
const PAPER = process.env.PAPER_FORMAT || 'A4';
const PAPER_MM = { Legal: [215.9, 355.6], A4: [210, 297], Letter: [215.9, 279.4] }[PAPER] || [210, 297];
const MARGIN_MM = 10;
const PAGE_W_PX = Math.round(((PAPER_MM[0] - 2 * MARGIN_MM) / 25.4) * 96);
const PAGE_H_PX = Math.round(((PAPER_MM[1] - 2 * MARGIN_MM) / 25.4) * 96);

async function renderPdf(html) {
  const browser = await getBrowser();
  const context = await browser.newContext({
    viewport: { width: PAGE_W_PX, height: PAGE_H_PX },
    locale: 'en-IN',
  });
  const page = await context.newPage();
  try {
    // Same CSS that the browser's Print dialog uses (@media print rules)
    await page.emulateMedia({ media: 'print' });
    await page.setContent(html.replace('</head>', `<style>${FONT_CSS}</style></head>`), { waitUntil: 'networkidle' });

    // Wait until the Tailwind CDN has generated its styles (text-xs on <body> = 12px)
    await page.waitForFunction(
      () => getComputedStyle(document.body).fontSize === '12px',
      null,
      { timeout: 20000 }
    );
    await page.evaluate(() => document.fonts.ready);

    // Re-run the auto-height logic of the buyer textarea at print width
    await page.evaluate(() => {
      document.querySelectorAll('textarea').forEach((t) => {
        t.style.height = 'auto';
        t.style.height = t.scrollHeight + 'px';
      });
    });

    // Safety net: if the invoice ever grows taller than one page, shrink it to fit
    const contentHeight = await page.evaluate(
      () => Math.ceil(document.getElementById('invoiceContainer').getBoundingClientRect().height) + 4
    );
    const scale = Math.max(0.5, Math.min(1, Math.floor((PAGE_H_PX / contentHeight) * 100) / 100));

    return await page.pdf({
      format: PAPER,
      printBackground: false,
      scale,
      margin: {
        top: `${MARGIN_MM}mm`,
        bottom: `${MARGIN_MM}mm`,
        left: `${MARGIN_MM}mm`,
        right: `${MARGIN_MM}mm`,
      },
    });
  } finally {
    await context.close();
  }
}

// ---- Upload to your existing Apps Script (doPost) ----
async function uploadToDrive(fileName, pdfBuffer) {
  const response = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ fileName, base64: pdfBuffer.toString('base64') }),
    redirect: 'follow',
    signal: AbortSignal.timeout(60000),
  });
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Unexpected reply from Apps Script: ' + text.slice(0, 200));
  }
}

app.post('/api/generate-pdf', async (req, res) => {
  try {
    const { html, fileName } = req.body || {};
    if (!html || !fileName) {
      return res.status(400).json({ status: 'error', message: 'html and fileName are required' });
    }
    // Apps Script appends ".pdf" itself, so just make the name safe
    const safeName = String(fileName).replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 150);

    const pdf = await renderPdf(html);
    const result = await uploadToDrive(safeName, pdf);

    if (result.status !== 'success') {
      return res.status(502).json({ status: 'error', message: 'Apps Script: ' + (result.message || 'unknown error') });
    }
    res.json({ status: 'success', url: result.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Optional: download the PDF instead of uploading (handy for testing the layout)
app.post('/api/preview-pdf', async (req, res) => {
  try {
    const pdf = await renderPdf(req.body.html);
    res.setHeader('Content-Type', 'application/pdf');
    res.send(pdf);
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

module.exports = { renderPdf };
if (require.main === module) app.listen(PORT, '0.0.0.0', () => {
  console.log(`Invoice server running ->  http://localhost:${PORT}`);
  getBrowser().then(() => console.log('Chromium ready')).catch((e) => console.error('Chromium failed to start:', e.message));
});

process.on('SIGINT', async () => {
  try { (await browserPromise)?.close(); } catch {}
  process.exit(0);
});
