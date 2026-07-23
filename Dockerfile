# SolVamos Studio — Cloud Run image
# Fail-closed: prisma client MUST be generated into the runtime image
# (omit=dev leaves @prisma/client without engines → crash before listen on :8080).

FROM node:20-slim AS build
WORKDIR /app

# OpenSSL for Prisma engines on slim
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm ci || npm install
# Generate before bundle so CI/local catch missing schema early
RUN npx prisma generate
COPY . .
RUN npm run build \
  && test -f dist/server.cjs \
  && test -d node_modules/.prisma/client

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
COPY prisma ./prisma
# Production deps + generate engines for this Linux image
RUN npm ci --omit=dev || npm install --omit=dev \
  && npx prisma generate \
  && test -d node_modules/.prisma/client

COPY --from=build /app/dist ./dist

RUN mkdir -p /tmp/solvamos-data && chown -R node:node /app /tmp/solvamos-data
ENV DATA_DIR=/tmp/solvamos-data
EXPOSE 8080
USER node

# Boot smoke: fail image build if server cannot load (no listen needed)
# Skipped at build — Cloud Run provides PORT; use CI docker run smoke instead.
CMD ["node", "dist/server.cjs"]
