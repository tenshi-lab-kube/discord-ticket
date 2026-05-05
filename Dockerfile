FROM node:20-bookworm-slim AS deps

WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:20-bookworm-slim

ENV NODE_ENV=production \
    WEB_PORT=3000 \
    CONFIG_PATH=/app/runtime/config.json \
    DB_PATH=/app/runtime/data/tickets.db

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY index.js ./
COPY config.example.json ./
COPY src ./src

RUN mkdir -p /app/runtime/data \
  && chown -R node:node /app

USER node
EXPOSE 3000

CMD ["node", "index.js"]
