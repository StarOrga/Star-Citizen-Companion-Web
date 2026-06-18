import { contextBridge, ipcRenderer } from 'electron';
import type { DiscoveredChannel } from '../lib/discovery.js';
import type { PerformanceProfile, ProfileId, ETA } from '../lib/performance.js';
import type { UploadPayload, UploadResult } from '../lib/uploader.js';

interface ToolEnv {
  toolVersion: string;
  apiBase: string;
  webBase: string;
  releaseTokenFingerprint: string;
  platform: string;
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
  ships: string[];
  textureSize?: number;
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
  authenticate: (): Promise<AuthResult> => ipcRenderer.invoke('sc:authenticate'),
  upload: (payload: UploadPayload): Promise<UploadResult> =>
    ipcRenderer.invoke('sc:upload', payload),
  session: {
    status: (): Promise<SessionStatus> => ipcRenderer.invoke('sc:session:status'),
    token: (): Promise<TokenResult> => ipcRenderer.invoke('sc:session:token'),
    signOut: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('sc:session:signOut'),
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
  update: {
    status: (): Promise<UpdateEvent> => ipcRenderer.invoke('sc:update:status'),
    check: (): Promise<UpdateEvent> => ipcRenderer.invoke('sc:update:check'),
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
