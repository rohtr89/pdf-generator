# Playwright image with Chromium + system libraries preinstalled.
# IMPORTANT: this tag and the "playwright" version in package.json must match exactly.
FROM mcr.microsoft.com/playwright:v1.40.0-jammy

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
EXPOSE 3000

CMD ["npm", "start"]
