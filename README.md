Invoice PDF server (Render)
Files: server.js, package.json, Dockerfile, .dockerignore, public/index.html, fonts/
Output matches the manually printed reference: A4 paper, 100% scale, ~1 cm margins,
2px #1f2937 outer border, Segoe-UI-compatible font (Selawik) + Noto Sans rupee sign.
Optional exact Segoe UI: copy segoeui.ttf, segoeuib.ttf, segoeuii.ttf into fonts/ (they are picked up automatically).
Paper size: set env var PAPER_FORMAT = A4 | Legal | Letter on Render (default A4).
