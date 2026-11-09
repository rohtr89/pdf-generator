# Use the official Microsoft Playwright image which has all dependencies pre-installed
FROM mcr.microsoft.com/playwright:v1.40.0-jammy

WORKDIR /app

# Copy package files and install Express/Cors
COPY package*.json ./
RUN npm install

# Copy your server.js file
COPY . .

# Expose the port Render expects
EXPOSE 3000

# Start the server
CMD ["npm", "start"]
