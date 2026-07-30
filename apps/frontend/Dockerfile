FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY tsconfig.base.json ./tsconfig.base.json
COPY apps/frontend/package.json ./apps/frontend/package.json
COPY apps/backend/package.json ./apps/backend/package.json
RUN npm ci --no-audit --no-fund
COPY apps/frontend ./apps/frontend
RUN npm run build --workspace=@nextq/frontend

FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
ENV BACKEND_URL=http://backend:8088 NGINX_ENVSUBST_FILTER=^BACKEND_URL$
COPY apps/frontend/default.conf.template /etc/nginx/templates/default.conf.template
COPY --chown=nginx:nginx --from=build /app/apps/frontend/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:8080/
