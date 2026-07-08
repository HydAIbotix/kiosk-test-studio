# CLAUDE.md — kiosk-test-studio

Guidance for Claude Code (and humans) working in this repo. This is the **operator UI** (control
plane) of a two-repo system; all real work happens in the sibling backend
`../robotic-vision-agent-claude` (FastAPI + LangGraph, port 8001).

---

## What this is

A React/Vite **management studio** for the Robotic Kiosk Test Automation platform — the dashboard a
human operator uses to author, launch, monitor, and review automated robot-driven tests.

> **This is NOT the kiosk-under-test.** The kiosk being tested is a *separate* app (defaults to
> `http://localhost:5173`). This studio is a thin client that talks to the backend over HTTP/WebSocket.

Ports: **studio 5174** · backend **8001** · kiosk-under-test **5173**.

### Pages (9, in `src/pages/`)

| Page | Purpose |
|------|---------|
| Dashboard | Health metrics, robot fleet status, readiness; polls runs+robots every 5s, "Backend offline" detection |
| App Explorer | Trigger automated UI discovery of the kiosk; polls explore status; can clear the app map |
| App Map | Browse discovered screens + pixel-coordinate element inventory; raw + annotated screenshots |
| Test Intake | Import test cases from Excel; Claude generates structured plans; client-side plan cache |
| Execution | Select test cases, preview per-step plans grouped by device/channel, pick mode, start a run |
| Live Monitor | WebSocket stream of real-time step results as the robot executes |
| Results | Historical runs, JIRA defect badges, screenshot evidence |
| Configuration | Device Map (physical positions), kiosk URLs, robot connection/backend, exploration mode, card-service URL |
| Robot Setup | Robot/AGV/camera health dashboard; ad-hoc robot test-call tester |

---

## Tech stack

- **React 19.1** + **TypeScript 5.9** + **Vite 7.1**. Function components + hooks only.
- **No router** — routing is a `useState<Page>` switch in `src/App.tsx` (conditional rendering).
- **No state library** — `useState`/`useRef` + `localStorage`. No Redux/Zustand.
- **No UI framework** — custom design system via CSS variables in `src/styles.css`.
- **No socket.io** — native browser `WebSocket`.
- ESLint 9 + typescript-eslint 8 declared, **but no eslint config file exists** (the `lint` script
  will not work as-is).

---

## Layout (`src/`)

```
main.tsx                 React entry (StrictMode → <App/>), imports styles.css
App.tsx                  Root: Page union type, useState routing, TITLES map
styles.css               Global CSS variables design system (no framework)
api/client.ts            ★ ALL backend I/O + ALL shared TS types — start here for any API change
components/
  Layout.tsx             App shell: grouped sidebar nav, topbar, ResetButton
  StatusBadge.tsx        Status pill color mapping
  StepShots.tsx          Step "after" screenshot thumbnail
pages/                   The 9 screens above
assets/                  arm.jpg, base.jpg (Robot Setup imagery)
```

`src/api/client.ts` is the **single most important file**: the `req<T>()` fetch wrapper (base `/api`,
AbortController timeouts), the `api` object (~35 endpoint methods), `runWs(run_id, onEvent)` (native
WebSocket to `/api/runs/{id}/ws`), `runScreenshotUrl(...)`, and every exported domain type (`Run`,
`RunDetail`, `TestCase`, `DeviceConfig`, `Config`, `Robot`, `RobotHealth`, `AppMap`, `TcPlan`,
`Defect`, …).

---

## How it connects to the backend

Vite proxies everything under `/api` (HTTP **and** WebSocket) to `http://127.0.0.1:8001`
(`vite.config.ts`, `changeOrigin: true, ws: true`).

The **app_map contract** is central: the studio does not produce the map — the backend's App Explorer
does — the studio browses it. Each `AppMapScreen` has `description`, `dom_id`, `element_count`, and
`elements[]` of `{id, label, type, center: [x, y]}` — the **pixel-coordinate centers the robot taps**.
Execution plan steps (`TcPlanStep`) carry `screen_id`, `element_id`, `px`, `py`, `channel`
(`robot|web|db|validation`), and `device` (alias like `TVM`, `MPOS`).

Automation is **vision/coordinate-based against the external kiosk**, not selector-based. The studio
itself has **no `data-testid` / `aria-*` hooks** — it's a human dashboard, not an automation target.

**localStorage keys** (deliberately survive backend `/reset`): `tc_plan_<id>` (cached Claude plans,
invalidated by `planSig()` — currently `v10`), `tc_config_<id>` (per-test field values),
`selected_tcs`, and credentials.

---

## Key design decisions

- **Plans are cached** — Claude is called once per test case to generate a plan; it's cached
  (backend disk + localStorage) and reused. Force-regenerate from Test Intake when steps change.
- **Device Map is one-time config** — physical device positions (TVM/MPOS/RSV…) are entered once in
  Configuration; Claude embeds the target device on each step at plan time.
- **Zero hardcoding** — device names, coordinates, kiosk URLs, credentials all come from the
  backend DB or localStorage. Switching customers = updating config, not code.
- **Robot backend selectable from the UI** — `playwright` / `real` / `demo`, persisted to the
  backend `.env`.

---

## Running it

```bash
npm install
npm run dev        # scripts/start-api.cjs: starts backend (uvicorn on 8001), waits for its TCP
                   # port, THEN starts Vite on 5174 — no "Backend offline" race
npm run dev:ui     # Vite only (backend already running)
npm run build      # tsc -b && vite build  → dist/ (gitignored artifact)
npm run preview
```

`scripts/start-api.cjs` resolves the backend as the **sibling** dir `../../robotic-vision-agent-claude`
and spawns `python -m uvicorn api.main:app --port 8001` **without `--reload`** (reload caused port
flaps). It skips launching the backend if 8001 is already open. `PYTHON` env var overrides the
interpreter. `.claude/launch.json` defines a single `"aria-studio"` config (`npm run dev`, port 5174).

---

## Work done in the recent session (reconstructed from git, commits `ea3cb8f`…`44016e5`, 2026-07-03 → 07-07)

> Reconstructed from git history and current code, not a saved chat transcript. Commits mirror the
> backend repo's: "Enhancements" → "Robot API changes" → "Fixes" → "Fixes".

- **Robot API changes** (`35de143`): reworked `src/api/client.ts` robot/config methods and the
  `Configuration.tsx` / `RobotSetup.tsx` pages to match the backend's new **dual-controller** model
  (separate arm and AGV URLs, per-component health).
- **Enhancements** (`ea3cb8f`, `c18b9eb`): added the **Robot Setup** page (`RobotSetup.tsx`) and
  `StepShots.tsx`; added `arm.jpg`/`base.jpg` assets; multi-app support in `AppExplorer.tsx` /
  `AppMap.tsx`; Test Intake plan-cache/`planSig` and Configuration expansions; first `README.md`,
  `.gitignore`, `vite-env.d.ts`.
- **Fixes** (`46809bc`, `44016e5`): `Dashboard.tsx` offline detection, `AppMap.tsx` /
  `AppExplorer.tsx` display fixes, `Layout.tsx` nav.

**Files touched across the session:** `src/api/client.ts` (every commit), `src/App.tsx`,
`src/components/Layout.tsx`, `src/components/StepShots.tsx`, and pages `AppExplorer`, `AppMap`,
`Configuration`, `Dashboard`, `Execution`, `LiveMonitor`, `Results`, `RobotSetup`, `TestIntake`;
plus `src/assets/arm.jpg`, `src/assets/base.jpg`, `src/vite-env.d.ts`, `README.md`, `.gitignore`.

---

## What needs to be built next

1. **Add an ESLint config** — `eslint`, `@eslint/js`, `typescript-eslint` are installed and `npm run
   lint` exists, but there's no `eslint.config.js`. Add flat config so linting works.
2. **Remove the unused `concurrently` dependency** — replaced by `scripts/start-api.cjs`.
3. **Harden the backend path assumption** — `start-api.cjs` requires the backend at a fixed sibling
   path; make it configurable / fail with a clear message if missing.
4. **Track backend endpoint parity** — `client.ts` is the source of truth for the API contract; keep
   it in sync with `api/main.py` in the backend (e.g. the `PATCH` verdict/config/explore-config
   routes) when either side changes.

---

## Conventions — adding a page

1. Create `src/pages/MyPage.tsx`.
2. Wire nav in `src/components/Layout.tsx` (NAV array) + add a render branch and `TITLES` entry in `src/App.tsx`.
3. Add any new backend calls **and their types** to `src/api/client.ts` (never fetch elsewhere).
