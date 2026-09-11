# Cloud-Agnostic Deployment — Kiosk Test Studio (operator UI)

**Branch:** `studio-cloud-agnostic` (from `main`)

The Studio is a **single static Vite/React SPA**. It is **same-origin by design** — the REST base is
`/api` (`src/api/client.ts`) and the live-run WebSocket is `${location.host}/api/runs/<id>/ws` — so a
single nginx serves the SPA **and** reverse-proxies `/api/` (REST + WebSocket) to the QA backend.
**No application source changes** are needed to run on a VM; this branch only adds container packaging.

## The stack (same on Azure / GCP / EC2 / on-prem)

```
browser ──▶ studio (nginx :8080)  ── serves the SPA
                     └── /api/ ──▶ QA backend (:8001 on the VM host, via host.docker.internal)
                                     REST + WebSocket (live run updates)
```
One origin → no CORS, one exposed port. The QA backend runs as its **own** compose stack
(`robotic-vision-agent-claude`); the Studio reaches its published `:8001` over the docker host-gateway,
so the two stacks stay independent.

## Prerequisites
The QA backend stack must be up on the same VM (it publishes `:8001` on the host). The POS already
uses host port **80**, so the Studio uses **8080**.

## Run
```bash
# On the VM (backend + POS already running):
docker compose up -d --build          # builds the SPA, serves on :8080
```
Open **`http://<VM-EXTERNAL-IP>:8080`** in a browser.

Open port 8080 to your IP (GCP Cloud Shell), never to the world:
```bash
gcloud compute firewall-rules create allow-studio-8080 \
  --allow=tcp:8080 --target-tags=http-server --source-ranges=<YOUR_IP>/32
```

## Files added on this branch
| File | Purpose |
|---|---|
| `Dockerfile` | Multi-stage: build the Vite bundle → serve with nginx |
| `nginx.conf` | SPA history fallback + `/api/` reverse-proxy (REST + WebSocket) to the backend |
| `docker-compose.yml` | Builds + serves the Studio on `:8080`, host-gateway to the backend `:8001` |
| `.dockerignore` | Keeps the build context small |

## Notes
- **WebSocket:** `nginx.conf` sets the `Upgrade`/`Connection` headers + a long `proxy_read_timeout`
  so the live-run stream (`/api/runs/<id>/ws`) stays open for the duration of a run.
- **Backend must be reachable:** if the UI loads but shows "API not reachable", confirm the backend
  stack is up (`curl http://localhost:8001/api/health` on the VM) — the Studio proxies to it.
- **Rebuild on new deploys:** `docker compose up -d --build` (nginx never caches `index.html`, so a
  rebuilt bundle is picked up immediately).
