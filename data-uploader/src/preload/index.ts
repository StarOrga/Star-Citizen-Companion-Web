import { contextBridge, ipcRenderer } from 'electron';
import type { DiscoveredChannel } from '../lib/discovery.js';
import type { PerformanceProfile, ProfileId, ETA } from '../lib/performance.js';
import type { UploadPayload, UploadResult } from '../lib/uploader.js';
import type { UploadJobState, JobNat, RehydrateResult } from '../lib/upload-job.js';
import type { JobView } from '../main/upload-session.js';
import type { ThrottleView, ThrottleSetResult } from '../main/throttle.js';
import type { LiveProfileId } from '../lib/throttle-control.js';
import type { AutoRunDecision } from '../lib/auto-run.js';

/** The settings subset the UI is allowed to see (no installId). */
export interface PublicSettings {
  telemetryEnabled: boolean;
  minimizeToTray: boolean;
  autoStart: boolean;
  autoRunOnNewVersion: boolean;
  shutdownAfterUpload: boolean;
  updateChannel: 'alpha' | 'beta' | 'stable';
}

/** Tray strings resolved from the renderer's i18n dictionary. */
export interface TrayLabelPush {
  open?: string;
  quit?: string;
  pauseUpload?: string;
  resumeUpload?: string;
  hiddenHint?: string;
  idle?: string;
  extract?: string;
  upload?: string;
  done?: string;
  error?: string;
  paused?: string;
}

interface ToolEnv {
  toolVersion: string;
  apiBase: string;
  webBase: string;
  releaseTokenFingerprint: string;
  platform: string;
  /** True only for the unattended `--hidden` autostart launch. */
  startedHidden: boolean;
}

interface AuthResult {
  ok: boolean;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  userEmail?: string;
  error?: string;
}

interface SessionStatus {
  connected: boolean;
  email: string | null;
  expiresAt: number | null;
  canPersist: boolean;
  needsReconnect: boolean;
}

interface TokenResult {
  token: string | null;
  email: string | null;
  reconnect: boolean;
}

interface ChannelState {
  channel: string;
  patchVersion: string;
  buildNumber: string;
  qualityScore: number | null;
  entityTotal: number;
  bundleId: string;
  createdAt: string;
}

interface CatalogSnapshot {
  syncedAt: number;
  channels: ChannelState[];
  bundleCount: number;
}

interface SyncProgress {
  phase: 'connecting' | 'fetching' | 'processing' | 'saving' | 'done' | 'error';
  pct: number;
  message?: string;
  channel?: string;
}

interface SyncResult {
  ok: boolean;
  snapshot?: CatalogSnapshot;
  error?: string;
}

type UpdateEvent =
  | { type: 'checking' }
  | { type: 'available'; version: string; releaseDate?: string; notes?: string | null }
  | { type: 'not-available'; currentVersion: string }
  | { type: 'progress'; pct: number; bytesPerSecond?: number; transferred?: number; total?: number }
  | { type: 'downloaded'; version: string }
  | { type: 'manual'; currentVersion: string; latestVersion: string }
  | { type: 'error'; message: string };

interface ExtractRequest {
  p4kPath: string;
  outDir: string;
  channel: 'LIVE' | 'PTU' | 'EPTU' | 'TECH-PREVIEW';
  patchVersion: string;
  buildNumber: string;
  scope: { hdIcons: boolean; renderPngs: boolean; componentTree: boolean };
  toolVersion: string;
}
interface ExtractResultPayload {
  channel: string;
  patch_version: string;
  build_number: string;
  schema_version: number;
  quality_score: number;
  entity_counts: Record<string, number>;
  manifest_path: string;
  output_dir: string;
  tool_version: string;
}
interface ExtractFinal {
  ok: boolean;
  result?: ExtractResultPayload;
  error?: string;
}
interface ExtractEvent {
  jobId: string;
  type: 'phase' | 'progress' | 'file' | 'count' | 'log' | 'warning' | 'done' | 'error';
  phase?: string;
  pct?: number;
  // 'progress' event fields (see python-bridge.ts PythonExtractEvent).
  stage?: string;
  current?: number;
  total?: number;
  detail?: string;
  fileName?: string;
  bytesProcessed?: number;
  bytesTotal?: number;
  counter?: { key: string; value: number };
  level?: 'info' | 'warn' | 'error';
  message?: string;
  result?: ExtractResultPayload;
  error_type?: string;
}

interface SkinExportRequest {
  p4kPath: string;
  outDir: string;
  ships?: string[];
  manifest?: string;
  skipExisting?: boolean;
  textureSize?: number;
  maxModelMb?: number;
  limitSkins?: number;
}
interface SkinEntry {
  skin_id: string;
  name: string;
  description: string;
  source: string;
  name_verified: boolean;
  has_model: boolean;
  has_icon: boolean;
  model_bytes: number | null;
}
interface SkinShipResult {
  ship_id: string;
  export_dir: string;
  skins: SkinEntry[];
  cached?: boolean;
}
interface SkinExportFinal {
  ok: boolean;
  ships?: SkinShipResult[];
  error?: string;
}
interface SkinUploadResult {
  ok: boolean;
  ship_id: string;
  uploaded?: number;
  committed?: number;
  error?: string;
  cached?: boolean;
  /** Ship built no livery model — a successful no-op, not a failure. */
  empty?: boolean;
}

export const api = {
  env: (): Promise<ToolEnv> => ipcRenderer.invoke('sc:env'),
  discover: (): Promise<DiscoveredChannel[]> => ipcRenderer.invoke('sc:discover'),
  discoverManual: (path: string): Promise<DiscoveredChannel | null> =>
    ipcRenderer.invoke('sc:discoverManual', path),
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('sc:pickFolder'),
  profiles: (): Promise<{ profiles: Record<string, PerformanceProfile>; default: ProfileId }> =>
    ipcRenderer.invoke('sc:profiles'),
  estimate: (profileId: ProfileId, sizeBytes: number): Promise<ETA> =>
    ipcRenderer.invoke('sc:estimate', profileId, sizeBytes),
  /**
   * The LIVE performance profile. Separate from `profiles()` (which only lists
   * the definitions) because this one is mutable while a job runs: main owns
   * the current value and pushes it to the running sidecars.
   */
  perf: {
    get: (): Promise<ThrottleView> => ipcRenderer.invoke('sc:perf:get'),
    set: (profileId: LiveProfileId): Promise<ThrottleSetResult> =>
      ipcRenderer.invoke('sc:perf:set', profileId),
    onChanged: (cb: (v: ThrottleSetResult) => void): (() => void) => {
      const listener = (_e: unknown, payload: ThrottleSetResult): void => cb(payload);
      ipcRenderer.on('sc:perf:changed', listener);
      return () => ipcRenderer.removeListener('sc:perf:changed', listener);
    },
  },
  authenticate: (): Promise<AuthResult> => ipcRenderer.invoke('sc:authenticate'),
  upload: (payload: UploadPayload): Promise<UploadResult> =>
    ipcRenderer.invoke('sc:upload', payload),
  /**
   * Durable upload job — pause/resume that survives closing or killing the app.
   * State lives in the main process (on disk), so the renderer only asks.
   */
  uploadJob: {
    get: (): Promise<JobView> => ipcRenderer.invoke('sc:upload:job'),
    begin: (outDir: string, nat: JobNat): Promise<UploadJobState> =>
      ipcRenderer.invoke('sc:upload:begin', outDir, nat),
    pause: (): Promise<JobView> => ipcRenderer.invoke('sc:upload:pause'),
    resume: (): Promise<JobView> => ipcRenderer.invoke('sc:upload:resume'),
    /**
     * The extraction result a resume drives on, rebuilt from the stored job +
     * manifest — the renderer's own copy does not survive a restart.
     */
    rehydrate: (): Promise<RehydrateResult> => ipcRenderer.invoke('sc:upload:rehydrate'),
    cancel: (): Promise<JobView> => ipcRenderer.invoke('sc:upload:cancel'),
    finish: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('sc:upload:finish'),
    /** Mark the run failed but KEEP it resumable (unlike `finish`, which deletes it). */
    fail: (error: string): Promise<JobView> => ipcRenderer.invoke('sc:upload:fail', error),
    onPaused: (cb: (v: JobView) => void): (() => void) => {
      const listener = (_e: unknown, payload: JobView): void => cb(payload);
      ipcRenderer.on('sc:upload:paused', listener);
      return () => ipcRenderer.removeListener('sc:upload:paused', listener);
    },
  },
  session: {
    status: (): Promise<SessionStatus> => ipcRenderer.invoke('sc:session:status'),
    token: (): Promise<TokenResult> => ipcRenderer.invoke('sc:session:token'),
    signOut: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('sc:session:signOut'),
    /** The signed-in user's role — gates the update-channel picker. */
    role: (): Promise<'admin' | 'collaborator' | 'viewer'> =>
      ipcRenderer.invoke('sc:session:role'),
  },
  sync: {
    cached: (): Promise<CatalogSnapshot | null> => ipcRenderer.invoke('sc:sync:cached'),
    start: (): Promise<SyncResult> => ipcRenderer.invoke('sc:sync:start'),
    onEvent: (cb: (ev: SyncProgress) => void): (() => void) => {
      const listener = (_e: unknown, payload: SyncProgress): void => cb(payload);
      ipcRenderer.on('sc:sync:event', listener);
      return () => ipcRenderer.removeListener('sc:sync:event', listener);
    },
  },
  clipboard: {
    writeText: (text: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('sc:clipboard:write', text),
  },
  settings: {
    get: (): Promise<PublicSettings> => ipcRenderer.invoke('sc:settings:get'),
    setTelemetry: (enabled: boolean): Promise<PublicSettings> =>
      ipcRenderer.invoke('sc:settings:setTelemetry', enabled),
    patch: (partial: Partial<Omit<PublicSettings, 'telemetryEnabled'>>): Promise<PublicSettings> =>
      ipcRenderer.invoke('sc:settings:patch', partial),
  },
  tray: {
    /** Push resolved i18n strings to main (the tray lives there). */
    setLabels: (labels: TrayLabelPush): void => ipcRenderer.send('sc:tray:labels', labels),
  },
  system: {
    /**
     * Schedule an OS shutdown `delaySeconds` from now (default 60), leaving a
     * grace window the operator can cancel. Best-effort: a locked-down box that
     * denies the command just reports `ok:false`.
     */
    shutdown: (delaySeconds?: number): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('sc:system:shutdown', delaySeconds),
    /** Abort a shutdown scheduled by `shutdown()`. */
    abortShutdown: (): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('sc:system:abortShutdown'),
  },
  autoRun: {
    /** Ask main whether an unattended run should start now. */
    decide: (signedIn: boolean): Promise<AutoRunDecision> =>
      ipcRenderer.invoke('sc:autorun:decide', signedIn),
    /** The tray's Resume item asks the renderer to re-drive the stages. */
    onResumeRequested: (cb: () => void): (() => void) => {
      const listener = (): void => cb();
      ipcRenderer.on('sc:upload:resumeRequested', listener);
      return () => ipcRenderer.removeListener('sc:upload:resumeRequested', listener);
    },
  },
  log: {
    // Structured log line into the shared main.log file.
    write: (level: 'info' | 'warn' | 'error' | 'debug', message: string): void =>
      ipcRenderer.send('sc:log:write', level, message),
    // Forward a renderer crash → logged + reported to crash telemetry.
    crash: (payload: { name?: string; message?: string; stack?: string | null }): void =>
      ipcRenderer.send('sc:log:crash', payload),
  },
  update: {
    status: (): Promise<UpdateEvent> => ipcRenderer.invoke('sc:update:status'),
    // Fire-and-forget silent check; outcome arrives via onEvent, not a return.
    // Update checks are automatic now (startup, navigation, periodic poll) —
    // there is no manual "check" entry point.
    checkSilent: (): void => ipcRenderer.send('sc:update:check-silent'),
    install: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('sc:update:install'),
    onEvent: (cb: (ev: UpdateEvent) => void): (() => void) => {
      const listener = (_e: unknown, payload: UpdateEvent): void => cb(payload);
      ipcRenderer.on('sc:update:event', listener);
      return () => ipcRenderer.removeListener('sc:update:event', listener);
    },
  },
  cleanup: {
    extractDir: (
      outDir: string,
      info: { bundleId?: string; channel?: string; version?: string },
    ): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('sc:cleanup:extractDir', outDir, info),
  },
  catalog: {
    // Promote a just-uploaded extract into the public Codex (codex_* tables).
    upload: (
      accessToken: string,
      outDir: string,
    ): Promise<{
      ok: boolean;
      buildId?: string;
      counts?: Record<string, number>;
      /** Raw technical text (logs / collapsed details), never a headline. */
      error?: string;
      /** Coarse failure class — see `CatalogErrorCode` in main/catalog-bridge. */
      errorCode?: string;
      /** Publish phase that failed, so the UI can name where it stopped. */
      errorPhase?: string;
    }> => ipcRenderer.invoke('sc:catalog:upload', accessToken, outDir),
    onEvent: (
      cb: (ev: { phase: string; current: number; total: number; phaseIndex?: number; phaseTotal?: number }) => void,
    ): (() => void) => {
      const listener = (
        _e: unknown,
        payload: { phase: string; current: number; total: number; phaseIndex?: number; phaseTotal?: number },
      ): void => cb(payload);
      ipcRenderer.on('sc:catalog:event', listener);
      return () => ipcRenderer.removeListener('sc:catalog:event', listener);
    },
  },
  extract: {
    env: (): Promise<{ interpreter: string; cwd: string; source: 'env' | 'packaged' | 'dev-path' }> =>
      ipcRenderer.invoke('sc:extract:env'),
    start: (req: ExtractRequest): Promise<ExtractFinal> =>
      ipcRenderer.invoke('sc:extract:start', req),
    cancel: (jobId: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('sc:extract:cancel', jobId),
    onEvent: (cb: (ev: ExtractEvent) => void): (() => void) => {
      const listener = (_e: unknown, payload: ExtractEvent): void => cb(payload);
      ipcRenderer.on('sc:extract:event', listener);
      return () => ipcRenderer.removeListener('sc:extract:event', listener);
    },
  },
  skin: {
    ensureTools: (): Promise<{ ok: boolean; path?: string; error?: string }> =>
      ipcRenderer.invoke('sc:skin:ensureTools'),
    onToolProgress: (cb: (pct: number) => void): (() => void) => {
      const listener = (_e: unknown, payload: { pct: number }): void => cb(payload.pct);
      ipcRenderer.on('sc:skin:toolProgress', listener);
      return () => ipcRenderer.removeListener('sc:skin:toolProgress', listener);
    },
    start: (req: SkinExportRequest): Promise<SkinExportFinal> =>
      ipcRenderer.invoke('sc:skin:start', req),
    cancel: (jobId: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('sc:skin:cancel', jobId),
    upload: (accessToken: string, ships: { shipId: string; dir: string }[]): Promise<SkinUploadResult[]> =>
      ipcRenderer.invoke('sc:skin:upload', accessToken, ships),
    onEvent: (cb: (ev: ExtractEvent) => void): (() => void) => {
      const listener = (_e: unknown, payload: ExtractEvent): void => cb(payload);
      ipcRenderer.on('sc:skin:event', listener);
      return () => ipcRenderer.removeListener('sc:skin:event', listener);
    },
  },
};

contextBridge.exposeInMainWorld('sc', api);

declare global {
  interface Window {
    sc: typeof api;
  }
}
