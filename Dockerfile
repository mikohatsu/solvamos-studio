# SolVamos Studio — Cloud Run image
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci || npm install
COPY . .
RUN npm run build

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY --from=build /app/dist ./dist
RUN mkdir -p /tmp/solvamos-data && chown -R node:node /app /tmp/solvamos-data
ENV DATA_DIR=/tmp/solvamos-data
EXPOSE 8080
USER node
CMD ["node", "dist/server.cjs"]
