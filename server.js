// Kreyasi invoice PDF server
// Browser (invoice page) -> POST /api/generate-pdf -> Playwright/Chromium makes the PDF
// -> uploaded to your existing Google Apps Script (Base64) -> your Drive folder.

const express = require('express');
const path = require('path');
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

// ---- One shared Chromium instance (fast; relaunches itself if it ever dies) ----
let browserPromise = null;
function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] }).then((b) => {
      b.on('disconnected', () => { browserPromise = null; });
      return b;
    });
  }
  return browserPromise;
}

// ---- HTML -> PDF ----
// A4 with 8 mm margins -> printable area is 194 mm x 281 mm
const MARGIN_MM = 8;
const PAGE_W_PX = Math.round(((210 - 2 * MARGIN_MM) / 25.4) * 96); // ~733 px
const PAGE_H_PX = Math.round(((297 - 2 * MARGIN_MM) / 25.4) * 96); // ~1062 px

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
    await page.setContent(html, { waitUntil: 'networkidle' });

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
      format: 'A4',
      printBackground: true,
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Invoice server running ->  http://localhost:${PORT}`);
  getBrowser().then(() => console.log('Chromium ready')).catch((e) => console.error('Chromium failed to start:', e.message));
});

process.on('SIGINT', async () => {
  try { (await browserPromise)?.close(); } catch {}
  process.exit(0);
});
