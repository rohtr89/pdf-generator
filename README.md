# Kreyasi Invoice – Playwright PDF setup

## One-time setup (Windows)
1. Install Node.js LTS (18 or newer): https://nodejs.org
2. Unzip this folder, e.g. to C:\invoice-app
3. Open the folder, click the address bar, type `cmd`, press Enter, then run:
       npm install
   (this also downloads Chromium automatically; ~150 MB, once only)

## Daily use
Double-click `start-invoice.bat`  (or run `npm start`)
-> the invoice opens at http://localhost:3000
-> fill it in -> "Save to Drive & Print"
Keep the black server window open while you work.

## No change needed in Google Apps Script
Your existing Script.txt (doPost / doGet) works as it is.
If you ever redeploy it and the URL changes, update it in BOTH:
  - public/index.html  (WEB_APP_URL)
  - server.js          (APPS_SCRIPT_URL), or set the APPS_SCRIPT_URL environment variable

## Layout testing
POST the snapshot to /api/preview-pdf to get the PDF back without uploading.
