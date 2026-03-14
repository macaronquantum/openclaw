FROM node:22-bookworm

WORKDIR /app

COPY package.json ./
RUN npm install

# Install Chromium for Playwright automation.
RUN npx playwright install --with-deps chromium

COPY tsconfig.json ./
COPY src ./src

CMD ["npm", "run", "start"]
