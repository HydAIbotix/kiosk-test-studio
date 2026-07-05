const BASE = '/api';

async function req<T = void>(
  path: string,
  opts?: RequestInit & { _signal?: AbortSignal },
  timeoutMs = 10_000,
): Promise<T> {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  // Allow caller to also abort via their own signal
  const callerSignal = opts?._signal;
  if (callerSignal) {
    callerSignal.addEventListener('abort', () => ctrl.abort(), { once: true });
  }

  const { _signal, ...fetchOpts } = opts ?? {};
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { 'Content-Type': 'application/json', ...fetchOpts.headers },
      ...fetchOpts,
      signal: ctrl.signal,
    });
    if (!res.ok) {
      let msg = `${res.status} ${res.statusText}`;
      try { const body = await res.json(); if (body?.detail) msg = String(body.detail); } catch {}
      throw new Error(msg);
    }
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      throw new Error(callerSignal?.aborted ? 'Request cancelled' : `Request timed out (${timeoutMs / 1000}s)`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  health:      ()                  => req<{status:string}>('/health'),
  getRuns:     ()                  => req<Run[]>('/runs'),
  getRun:      (id: string)        => req<RunDetail>(`/runs/${id}`),
  startRun:    (body: RunRequest)  => req<{run_id:string}>('/runs', {method:'POST',body:JSON.stringify(body)}),
  getTestCases:()                  => req<TestCase[]>('/test-cases'),
  uploadTestCases: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return req<{imported:number;new:number}>('/test-cases/upload', { method: 'POST', body: form, headers: {} }, 30_000);
  },
  getConfig:     ()                    => req<Config>('/config'),
  setRobotConn:  (body: {robot_backend: string; robot_ip?: string; robot_port?: number}) =>
    req<{status:string; robot_backend:string; robot_ip:string; robot_port:number; robot_url:string; persisted:boolean; restart_required:boolean}>('/config/robot', {method:'PATCH', body:JSON.stringify(body)}),
  upsertKiosk:   (k: KioskConfig)      => req('/config/kiosk', {method:'PUT',body:JSON.stringify(k)}),
  getDevices:    ()                    => req<DeviceConfig[]>('/config/devices'),
  upsertDevice:  (d: DeviceConfig)     => req('/config/device', {method:'PUT',body:JSON.stringify(d)}),
  deleteDevice:  (alias: string)       => req(`/config/device/${encodeURIComponent(alias)}`, {method:'DELETE'}),
  getRobots:   ()                  => req<{mode:string;robots:Robot[]}>('/robots'),
  getRobotHealth: (capture = true) => req<RobotHealth>(`/robot/health?capture=${capture}`, undefined, 40_000),
  robotTestCall:  (payload: {method: string; path: string; body?: unknown; timeout?: number}) =>
    req<RobotTestResult>('/robot/test-call', {method: 'POST', body: JSON.stringify(payload)}, 45_000),
  getAppMap:   ()                  => req<AppMap>('/app-map'),
  clearAppMap: ()                  => req('/app-map', {method:'DELETE'}),
  resetAll:    (signal?: AbortSignal) => req<{status:string;message:string}>('/reset', {method:'POST', _signal: signal}, 30_000),
  startExplore:    (kiosk_url:string, kiosk_id?:string) => req<{explore_id:string;status:string}>('/explore', {method:'POST',body:JSON.stringify({kiosk_url, ...(kiosk_id ? {kiosk_id} : {})})}),
  getExploreStatus:(id: string)      => req<{explore_id:string;status:string;message:string}>(`/explore/${id}`),
  getScreenshots:         ()                  => req<string[]>('/screenshots'),
  getAnnotatedScreenshots:()                  => req<Record<string,string[]>>('/screenshots/annotated'),
  getTcPlan:      (body: TcPlanInput)         => req<TcPlan>('/tc-plan', {method:'POST', body:JSON.stringify(body)}, 90_000),
  deleteTcPlan:   (test_id: string)           => req(`/tc-plan/${test_id}`, {method:'DELETE'}),
  getRunDefects:  (run_id: string)            => req<Defect[]>(`/runs/${run_id}/defects`),
  getExploreConfig: ()                       => req<ExploreConfig>('/explore-config'),
  setExploreMode: (mode: string)             => req<{mode:string;status:string}>('/explore-config', {method:'PATCH',body:JSON.stringify({mode})}),
  setCardService: (card_service_url: string) => req<{status:string;card_service_url:string}>('/config/card-service', {method:'PATCH',body:JSON.stringify({card_service_url})}),
  submitVerdict: (run_id: string, test_id: string, verdict: 'passed'|'failed') =>
    req<{status:string;test_id:string;outcome:string}>(`/runs/${run_id}/verdict`, {method:'PATCH',body:JSON.stringify({test_id,verdict})}),
  getTcConfig: (test_id: string)   => JSON.parse(localStorage.getItem(`tc_config_${test_id}`) || 'null') as TcConfig | null,
  saveTcConfig:(test_id: string, cfg: TcConfig) => { localStorage.setItem(`tc_config_${test_id}`, JSON.stringify(cfg)); },
  getSelectedTcs: ()               => JSON.parse(localStorage.getItem('selected_tcs') || '[]') as string[],
  saveSelectedTcs:(ids: string[])  => { localStorage.setItem('selected_tcs', JSON.stringify(ids)); },
};

// ── Types ──────────────────────────────────────────────────────────────────────

export type Run = {
  run_id: string; kiosk_id: string; robot_id: string; mode: string;
  status: 'pending'|'running'|'completed'|'failed';
  total: number; passed: number; failed: number;
  filter_tc: string|null; error?: string|null;
  started_at: string|null; completed_at: string|null; created_at: string;
};

export type StepResult = {
  step: string; success: boolean; method?: string;
  note?: string; expected_screen?: string; actual_screen?: string;
  expected_text?: string; observation?: string;
  screenshot_after?: string;
};

/** Build an <img> URL for a per-run step screenshot from the path stored in the
 *  step result (which may be an absolute server path with / or \ separators). */
export function runScreenshotUrl(runId: string, pathOrName: string): string {
  const name = (pathOrName || '').split(/[/\\]/).pop() || '';
  return `${BASE}/runs/${encodeURIComponent(runId)}/screenshots/${encodeURIComponent(name)}`;
}

export type TestResultDetail = {
  test_id: string; summary: string; outcome: string;
  step_results: StepResult[]; vision_summary: string;
};

export type RunDetail = Run & { results: TestResultDetail[] };

export type RunRequest = {
  robot_id: string; filter_tc?: string; mode?: string;
  kiosk_id?: string; excel_path?: string;
  credentials?: Record<string,unknown>;
};

export type TestCase = {
  test_id: string; kiosk_id: string; summary: string; description: string;
  steps_raw: string; expected_results_raw: string; priority: string; tags: string;
};

export type DeviceConfig = {
  alias: string;        // e.g. "TVM"
  kiosk_id: string;     // linked Kiosk-ID (e.g. "KIOSK-ID-1")
  description: string;  // e.g. "Ticket Vending Machine"
  pos_x: number; pos_y: number; pos_theta: number;
};

export type Config = {
  robot_backend: string; robot_ip: string; robot_port: number; robot_id: string;
  exploration_mode: string;
  card_service_url: string;
  viewport: {width:number;height:number}; camera: {width:number;height:number};
  kiosks: KioskConfig[];
  devices: DeviceConfig[];
};

export type KioskConfig = {
  kiosk_id: string; name: string; url: string; robot_id: string;
  screen_w_m: number; screen_h_m: number; tag_id: number;
  position?: {x:number;y:number;theta:number};
};

export type Robot = {
  robot_id: string; connected: boolean; current_kiosk_id: string;
  arm_state: string; base_pose: Record<string,number>; event_count: number;
};

export type RobotComponent = {
  status: 'ok' | 'error' | 'unknown' | string;
  detail: string;
  [k: string]: unknown;
};

export type RobotHealth = {
  backend: string;
  robot_url: string;
  robot_id: string;
  kiosk_id?: string;
  simulated?: boolean;
  healthy: boolean;
  error?: string;
  components: Record<'robot' | 'base' | 'camera', RobotComponent>;
  checked_at?: number;
};

export type RobotTestResult = {
  ok: boolean; url: string; method: string;
  status_code?: number; elapsed_ms: number;
  response_body?: unknown; error?: string;
};

export type AppMapScreen = {
  description: string; dom_id: string; element_count: number; app_id?: string;
  elements: {id:string;label:string;type:string;center:[number,number]}[];
};

export type AppMapAppInfo = {
  app_id: string; label: string; entry_screen: string; screen_count: number; explored_at: string;
};

export type AppMap = {
  exists: boolean; explored_at: string|null; entry_screen: string;
  apps?: Record<string, AppMapAppInfo>;
  screens: Record<string, AppMapScreen>;
};

export type TcConfig = Record<string, string>; // field_key → value

export type TcPlanStep = {
  action: string; channel: 'robot'|'web'|'db'|'validation';
  device?: string;   // device alias from the device map (e.g. "TVM", "MPOS")
  description: string;
  screen_id?: string; element_id?: string; px?: number; py?: number;
  value?: string; expected_screen?: string; detail?: string;
};
export type TcPlanConfigField = { key: string; label: string; type: string; };
export type TcPlan = {
  test_id: string; credential_scenario: string;
  required_config: TcPlanConfigField[];
  steps: TcPlanStep[];
  generated_at?: string;
};
export type TcPlanInput = {
  test_id: string; summary: string; description?: string;
  steps_raw: string; expected_results_raw?: string; force?: boolean;
};

export type ExploreConfig = {
  mode: string;           // "claude" | "playwright_aria"
  effective_mode: string; // may differ from mode when backend=real
  robot_backend: string;
  locked: boolean;        // true when backend=real (ARIA disabled)
  lock_reason: string | null;
};

export type Defect = {
  id: number; run_id: string; test_id: string;
  title: string; description: string;
  steps_to_reproduce: string; root_cause: string; probable_fix: string;
  severity: 'critical'|'high'|'medium'|'low';
  priority: string; jira_key: string; jira_url: string;
  status: string; evidence: string[];
  created_at: string | null;
};

export function runWs(run_id: string, onEvent: (e: unknown) => void) {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${proto}//${location.host}/api/runs/${run_id}/ws`);
  ws.onmessage = (m) => { try { onEvent(JSON.parse(m.data)); } catch {} };
  return ws;
}
