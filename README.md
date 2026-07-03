# Kiosk Test Studio

React/Vite management interface for the **Robotic Kiosk Test Automation** platform. Provides test intake, live execution monitoring, results analysis, and system configuration — all in one dashboard.

## What it does

| Page | Purpose |
|------|---------|
| **Dashboard** | Run health metrics, robot fleet status, readiness checklist |
| **App Explorer** | Trigger automated UI discovery; build the app map of screen elements |
| **App Map** | Browse discovered screens and their pixel-coordinate element inventory |
| **Test Intake** | Import test cases from Excel; Claude generates structured execution plans |
| **Test Execution** | Select test cases, preview step-by-step plans grouped by device, start a run |
| **Live Monitor** | WebSocket stream of real-time step results as the robot executes |
| **Results** | Historical run results with JIRA defect badges and failure evidence |
| **Configuration** | Device Map (physical positions), kiosk URLs, robot settings, credentials |

## Architecture

```
kiosk-test-studio (this repo, port 5174)
        │
        │  HTTP / WebSocket (Vite proxy → :8001)
        ▼
robotic-vision-agent-claude  (FastAPI + LangGraph, port 8001)
        │
        ├── Claude API  (plan generation, vision analysis)
        ├── SQLite DB   (runs, test cases, defects, device map)
        ├── Robot stubs → real arm when hardware arrives
        └── Playwright  (browser proxy in dev mode)
```

## Quick start

```bash
npm install
npm run dev          # starts backend (port 8001) then Vite (port 5174)
```

The launcher (`scripts/start-api.cjs`) waits for the FastAPI backend TCP port before opening the browser — no race conditions, no "Backend offline" flashes.

> Backend source lives at `../robotic-vision-agent-claude`. The Vite dev server proxies all `/api` requests to it.

## Key design decisions

- **Plans are cached** — Claude is called once per test case to generate an execution plan. The plan is saved to disk and reused on every subsequent run. Force-regenerate from Test Intake if steps change.
- **Device Map is one-time config** — physical device positions (TVM, MPOS, RSV, etc.) are entered once in Configuration. Claude reads them at plan-generation time and embeds the target device on each step. No repeated lookups at runtime.
- **Zero hardcoding** — device names, coordinates, kiosk URLs, and credentials all come from the database or localStorage. Switching customers means updating config, not code.
- **Robot stubs** — all hardware calls (`tap`, `move_to_position`, `capture_screen`) live in the backend's `vision_agent/robot/stubs.py`. Replacing with real arm code requires only changing those function bodies.

## Scripts

```bash
npm run dev       # unified launcher (backend + Vite)
npm run dev:ui    # Vite only (backend already running)
npm run build     # production build
npm run lint      # ESLint
```

## Environment

| Variable | Where | Purpose |
|----------|-------|---------|
| `ANTHROPIC_API_KEY` | backend `.env` | Claude API access |
| `ROBOT_BACKEND` | backend `.env` | `playwright` / `real` / `demo` |
| `ROBOT_IP` | backend `.env` | IP of physical robot controller |
| Vite proxy target | `vite.config.ts` | Default `http://localhost:8001` |

## Adding a new page

1. Create `src/pages/MyPage.tsx`
2. Add a nav entry in `src/App.tsx` (sidebar + route)
3. Add any new API calls to `src/api/client.ts`

## Tech stack

- React 19, TypeScript 5.9, Vite 7
- No UI framework — custom CSS variables (`src/index.css`)
- WebSocket via native browser API (no socket.io)
- State: React `useState` / `useRef` — no Redux/Zustand
