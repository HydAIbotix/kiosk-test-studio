# Cloud-agnostic image for the Kiosk Test Studio (operator UI). Runs identically on Azure / GCP /
# EC2 / on-prem. Two stages: build the Vite SPA, then serve it with nginx.
#
# The Studio is SAME-ORIGIN by design — the REST base is '/api' (src/api/client.ts) and the live-run
# WebSocket is ${location.host}/api/runs/<id>/ws — so nginx serves the SPA AND reverse-proxies /api/
# (REST + WebSocket) to the QA backend. There is NO build-time API URL to set, no CORS, one exposed
# port. See nginx.conf + docker-compose.yml.
#
# Build:  docker build -t kiosk-test-studio .

# ---- Stage 1: build ----
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- Stage 2: serve ----
FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
