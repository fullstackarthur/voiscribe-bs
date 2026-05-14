FROM node:22-slim AS base

RUN apt-get update && apt-get install -y \
    openssl \
    xvfb \
    pulseaudio \
    ffmpeg \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libdbus-1-3 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpangocairo-1.0-0 \
    libpango-1.0-0 \
    libcairo2 \
    libgdk-pixbuf-2.0-0 \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm

WORKDIR /app

COPY pnpm-workspace.yaml ./
COPY pnpm-lock.yaml ./
COPY package.json ./
COPY tsconfig.base.json ./
COPY prisma/ ./prisma/

COPY packages/logger/package.json ./packages/logger/
COPY packages/config/package.json ./packages/config/
COPY packages/db/package.json ./packages/db/
COPY apps/worker/package.json ./apps/worker/

RUN pnpm install --frozen-lockfile

RUN pnpm --filter @meetingbot/worker exec playwright install chromium

COPY packages/ ./packages/
COPY apps/worker/ ./apps/worker/

RUN pnpm --filter @meetingbot/logger build
RUN pnpm --filter @meetingbot/config build
RUN pnpm --filter @meetingbot/db build
RUN pnpm db:generate
RUN pnpm --filter @meetingbot/worker build

COPY apps/worker/start.sh /start.sh
RUN chmod +x /start.sh
RUN mkdir -p /data/chrome-profile

ENV NODE_ENV=production
ENV DISPLAY=:99
EXPOSE 3001
CMD ["/start.sh"]
