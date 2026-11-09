const express = require('express');
const { chromium } = require('playwright');
const cors = require('cors');

const app = express();
app.use(cors());
// Allow large HTML payloads
app.use(express.json({ limit: '10mb' }));

app.post('/generate', async (req, res) => {
    const { html, fileName, scriptUrl } = req.body;
    
    if (!html || !fileName || !scriptUrl) {
        return res.status(400).json({ status: "error", message: "Missing required data" });
    }

    let browser;
    try {
        // 1. Launch headless Chromium
        browser = await chromium.launch({
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();
        
        // 2. Load the HTML from the frontend
        await page.setContent(html, { waitUntil: 'networkidle' });
        
        // 3. Generate a perfect A4 PDF
        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: { top: '0', right: '0', bottom: '0', left: '0' }
        });
        
        // 4. Convert to Base64 string
        const base64Pdf = pdfBuffer.toString('base64');
        
        // 5. Send it to your existing Google Apps Script
        const scriptResponse = await fetch(scriptUrl, {
            method: 'POST',
            body: JSON.stringify({ fileName: fileName, base64: base64Pdf }),
            headers: { 'Content-Type': 'text/plain;charset=utf-8' }
        });
        
        const result = await scriptResponse.json();
        
        // 6. Send the Google success message back to your frontend
        res.json(result);
        
    } catch (error) {
        console.error("PDF Generation Error:", error);
        res.status(500).json({ status: "error", message: error.toString() });
    } finally {
        if (browser) {
            await browser.close();
        }
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
