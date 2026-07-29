FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=8088 DATA_DIR=/app/data
WORKDIR /app
RUN groupadd --system queueflow \
    && useradd --system --gid queueflow --home /app queueflow \
    && mkdir -p /app/data \
    && chown queueflow:queueflow /app/data
COPY --from=build --chown=queueflow:queueflow /app/node_modules ./node_modules
COPY --from=build --chown=queueflow:queueflow /app/dist ./dist
COPY --from=build --chown=queueflow:queueflow /app/dist-server ./dist-server
COPY --from=build --chown=queueflow:queueflow /app/package.json ./package.json
USER queueflow
EXPOSE 8088
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:8088/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node","dist-server/server/index.js"]
