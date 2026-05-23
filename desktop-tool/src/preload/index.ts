import { contextBridge, ipcRenderer } from 'electron';
import type { DiscoveredChannel } from '../lib/discovery.js';
import type { PerformanceProfile, ProfileId, ETA } from '../lib/performance.js';
import type { UploadPayload, UploadResult } from '../lib/uploader.js';

interface ToolEnv {
  toolVersion: string;
  apiBase: string;
  releaseTokenFingerprint: string;
  platform: string;
}

interface AuthResult {
  ok: boolean;
  accessToken?: string;
  userEmail?: string;
  error?: string;
}

type UpdateEvent =
  | { type: 'checking' }
  | { type: 'available'; version: string; releaseDate?: string; notes?: string | null }
  | { type: 'not-available'; currentVersion: string }
  | { type: 'progress'; pct: number; bytesPerSecond?: number; transferred?: number; total?: number }
  | { type: 'downloaded'; version: string }
  | { type: 'error'; message: string };

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
};

contextBridge.exposeInMainWorld('sc', api);

declare global {
  interface Window {
    sc: typeof api;
  }
}
