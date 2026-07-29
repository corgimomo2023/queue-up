FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY tsconfig.base.json ./tsconfig.base.json
COPY apps/frontend/package.json ./apps/frontend/package.json
COPY apps/backend/package.json ./apps/backend/package.json
RUN npm ci --no-audit --no-fund
COPY apps/backend ./apps/backend
RUN npm run build --workspace=@nextq/backend

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=8088 DATA_DIR=/app/data
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/frontend/package.json ./apps/frontend/package.json
COPY apps/backend/package.json ./apps/backend/package.json
RUN npm ci --omit=dev --workspace=@nextq/backend --include-workspace-root=false --no-audit --no-fund \
    && groupadd --system nextq \
    && useradd --system --gid nextq --home /app nextq \
    && mkdir -p /app/data \
    && chown nextq:nextq /app/data
COPY --from=build --chown=nextq:nextq /app/apps/backend/dist ./apps/backend/dist
USER nextq
WORKDIR /app/apps/backend
EXPOSE 8088
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:8088/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
