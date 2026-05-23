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
};

contextBridge.exposeInMainWorld('sc', api);

declare global {
  interface Window {
    sc: typeof api;
  }
}
