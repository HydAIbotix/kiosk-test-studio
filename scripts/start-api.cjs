/**
 * Unified dev launcher — starts the FastAPI backend, waits until the TCP port
 * is accepting connections, THEN starts the Vite dev server.
 *
 * Why a single script instead of `concurrently`:
 *   - Vite starts ONLY after the backend port is open → no "Backend offline" flash
 *   - TCP socket check is instant & reliable on Windows (no HTTP parsing quirks)
 *   - --reload is intentionally removed; it caused brief worker restarts that
 *     made the HTTP health-check time out even after uvicorn said "startup complete"
 *
 * Layout assumed (both dirs are siblings):
 *   kiosk-test-studio/           ← this package
 *   robotic-vision-agent-claude/ ← Python backend
 */

const { spawn } = require('child_process');
const net        = require('net');
const path       = require('path');

const API_PORT = 8001;
const API_HOST = '127.0.0.1';
const API_DIR  = path.resolve(__dirname, '..', '..', 'robotic-vision-agent-claude');
const PYTHON   = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');

// ── helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/** Returns true the moment a TCP connection to host:port succeeds. */
function tcpReady(host, port) {
  return new Promise(resolve => {
    const sock = new net.Socket();
    sock.setTimeout(800);
    sock.on('connect', () => { sock.destroy(); resolve(true);  });
    sock.on('error',   () => { sock.destroy(); resolve(false); });
    sock.on('timeout', () => { sock.destroy(); resolve(false); });
    sock.connect(port, host);
  });
}

/** Poll tcpReady every 500 ms until it succeeds or deadline passes. */
async function waitForPort(host, port, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await tcpReady(host, port)) return true;
    await sleep(500);
  }
  return false;
}

/** Prefix every stdout/stderr line from a child process. */
function pipeWithPrefix(proc, prefix) {
  let buf = '';
  function flush(chunk) {
    buf += chunk.toString();
    const lines = buf.split('\n');
    buf = lines.pop(); // keep incomplete last line in buffer
    for (const line of lines) console.log(`${prefix} ${line}`);
  }
  proc.stdout?.on('data', flush);
  proc.stderr?.on('data', flush);
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  // 1. If port is already open, skip spawning a new backend.
  if (await tcpReady(API_HOST, API_PORT)) {
    console.log(`[API] Port ${API_PORT} already open — using existing backend`);
  } else {
    // 2. Spawn uvicorn WITHOUT --reload.
    //    --reload causes uvicorn to restart its worker process on file changes,
    //    which briefly closes the TCP port and causes the Vite proxy to get
    //    ECONNREFUSED — that's what shows "Backend offline" in the dashboard.
    console.log(`[API] Starting backend…  cwd: ${API_DIR}`);
    const api = spawn(PYTHON, [
      '-m', 'uvicorn', 'api.main:app',
      '--host', '0.0.0.0',
      '--port', String(API_PORT),
    ], {
      cwd:   API_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });

    pipeWithPrefix(api, '[API]');

    api.on('error', err => {
      console.error(`[API] ✗ Could not start Python: ${err.message}`);
      console.error(`[API]   Tried: ${PYTHON}   Set PYTHON env var to override.`);
    });
    api.on('close', code => {
      if (code !== 0 && code !== null)
        console.error(`[API] uvicorn exited (code ${code})`);
    });

    // 3. Wait for the TCP port — plain socket connect, no HTTP parsing.
    process.stdout.write('[API] Waiting for backend port');
    const ready = await waitForPort(API_HOST, API_PORT, 90_000);
    if (ready) {
      console.log(`\n[API] ✓ Backend ready on port ${API_PORT}`);
    } else {
      console.error('\n[API] ✗ Backend port did not open within 90 s');
      console.error('[API]   Check the output above for Python errors.');
    }

    process.on('SIGINT',  () => api.kill('SIGINT'));
    process.on('SIGTERM', () => api.kill('SIGTERM'));
  }

  // 4. Start Vite — only after the backend port is confirmed open.
  console.log('[UI]  Starting Vite…');
  const ui = spawn('npx', ['vite', '--port', '5174', '--host', '0.0.0.0'], {
    cwd:   path.resolve(__dirname, '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });

  pipeWithPrefix(ui, '[UI] ');

  ui.on('error', err => console.error(`[UI]  Failed to start Vite: ${err.message}`));
  ui.on('close', code => {
    if (code !== 0 && code !== null)
      console.error(`[UI]  Vite exited (code ${code})`);
  });

  process.on('SIGINT',  () => ui.kill('SIGINT'));
  process.on('SIGTERM', () => ui.kill('SIGTERM'));

  // Keep the launcher alive.
  await new Promise(() => {});
}

main().catch(err => { console.error('[launcher]', err); process.exit(1); });
