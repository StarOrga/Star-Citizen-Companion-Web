/**
 * Small persistent settings store for the desktop tool.
 *
 * Holds non-secret operator preferences (currently: telemetry opt-out) plus a
 * stable, opaque per-install id used only to de-duplicate anonymous crash
 * reports server-side (stored there as a salted hash — never raw). Plain JSON
 * under `app.getPath('userData')`; no secrets live here, so no encryption.
 *
 * Pure logic + injected I/O so it is unit-testable without Electron.
 */

export interface Settings {
  /** Crash telemetry is ON by default (opt-out). */
  telemetryEnabled: boolean;
  /** Opaque random id, generated once and reused across launches. */
  installId: string;
  /** Closing the window hides to the tray instead of quitting. Default ON. */
  minimizeToTray: boolean;
  /**
   * Launch with Windows (registered via Electron's login-item API) — the
   * "PC-Start" slot of the ⚙ sentence. Default ON for a new install; an
   * existing install keeps the value it stored.
   *
   * Uploading a new game patch has no switch of its own (the retired
   * `autoRunOnNewVersion`): whenever the uploader runs and a session exists, a
   * new patch is uploaded — unattended right away, on a launch the operator
   * opened after a 120 s countdown. Neither is the retired `quitAfterAutoRun`
   * a setting any more: an unattended launch with nothing new always quits
   * again, unless `afterAutoRun` is 'keep' (`lib/auto-run.ts`).
   */
  autoStart: boolean;
  /**
   * What happens after a run the uploader started itself (unattended launch or
   * the countdown). Replaces the old boolean `shutdownAfterUpload` (removed in
   * schema v2). 'keep' also keeps an unattended launch with nothing new open.
   * Default 'quit'.
   */
  afterAutoRun: 'keep' | 'quit' | 'shutdown';
  /**
   * The resource preset a run the uploader started itself STARTS with — the
   * "mit … Leistung" slot. Applied for that run only (never written over the
   * dock's own persisted limits); the dock can change it while it runs.
   * Default 'balanced': an autostart run usually meets someone who just sat
   * down at the PC, so it neither crawls nor takes the whole machine.
   */
  autoRunPreset: 'gaming' | 'balanced' | 'full';
  /**
   * The ⏻ "when done" choice the operator last picked on a run of their own.
   * 'shutdown' is never stored — it applies to the one run it was picked for.
   * Default 'nothing' ("Offen lassen").
   */
  whenDoneLast: 'nothing' | 'quit';
  /**
   * The speed (load) mode the operator last picked. Main seeds its live throttle from this on launch, so the
   * mode picked once (e.g. "minimal, I want to play") is still the mode when
   * the next run — manual or unattended — starts. Default 'standard'.
   */
  speedProfile: 'minimal' | 'standard' | 'maximum';
  /**
   * The operator's resource limits (CPU / RAM / disk) and the preset they came
   * from — supersedes `speedProfile`, which stays only so the first launch
   * after the change maps the old pick onto the matching preset. Values are
   * clamped to the machine by `main/resources.ts`, not here. Undefined until
   * the operator (or that migration) sets them.
   */
  resourceLimits?: StoredResourceLimits;
  /**
   * LEGACY: the former operator switch "use the GPU". Superseded by the GPU
   * limit `resourceLimits.gpuPct` (sidecar env `SC_USE_GPU` / `SC_GPU_SHARE`
   * follow the limit now). No longer written; only read once by
   * `main/resources.ts` (`migrateLegacyGpu`) to give a custom mix stored
   * without `gpuPct` the old switch's meaning (false → 0, true → 80). Presets
   * carry their own GPU share. Default false.
   */
  useGpu: boolean;
  /**
   * Auto-update ring the operator opted into (role-gated in the UI). Default
   * 'stable'; only admins/collaborators ever see the picker to change it. The
   * renderer maps it onto electron-updater's channel via the main process.
   */
  updateChannel: 'alpha' | 'beta' | 'stable';
  /**
   * Persisted UI locale, set only when the renderer explicitly asks for it via
   * `patch()`. Undefined means "use the renderer's own detection/fallback".
   */
  language?: string;
  /**
   * The Star Citizen channel folder (e.g. `D:\Games\StarCitizen\LIVE`) the
   * operator picked by hand or chose among several installs. Lives in
   * `userData`, so it survives uploader updates; discovery probes it first and
   * falls back to the automatic search when it no longer holds a Data.p4k.
   */
  gamePath?: string;
  /**
   * 3D asset packages beyond the ships (docs/asset-package.md), built in the
   * 3D-model step on top of the always-on ship packages. Off by default: each
   * one adds a long conversion run and R2 storage. FPS weapons (`--fps`).
   */
  pkgFps: boolean;
  /** Standalone ship-item packages — components, ship weapons, missiles (`--items`). */
  pkgItems: boolean;
  /** Armor + clothing packages (`--armor`). */
  pkgArmor: boolean;
}

/** Persisted resource limits — see `lib/resource-limits.ts`. */
export interface StoredResourceLimits {
  preset?: 'gaming' | 'balanced' | 'full' | null;
  cpuPct?: number;
  ramMb?: number;
  readMBs?: number;
  writeMBs?: number;
  iops?: number;
  /** GPU limit 0..100 (0 = GPU off). Absent in files written before it existed → `migrateLegacyGpu`. */
  gpuPct?: number;
}

function readResourceLimits(raw: unknown): StoredResourceLimits | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const out: StoredResourceLimits = {};
  if (r.preset === 'gaming' || r.preset === 'balanced' || r.preset === 'full') out.preset = r.preset;
  else if (r.preset === null) out.preset = null;
  for (const key of ['cpuPct', 'ramMb', 'readMBs', 'writeMBs', 'iops', 'gpuPct'] as const) {
    const v = r[key];
    if (typeof v === 'number' && Number.isFinite(v)) out[key] = v;
  }
  return out;
}

/** Injectable text persistence (file-backed in production). */
export interface TextIO {
  read(): string | null;
  write(text: string): void;
}

const SCHEMA_VERSION = 3;

/**
 * v3 retired `autoRunOnNewVersion` (uploading a new patch is always on) and
 * `quitAfterAutoRun` (a fixed rule now) — both are simply not read, so they
 * vanish on the next save; `autoStart` keeps whatever a v1/v2 install stored.
 *
 * The retired `extractScope` (every run now extracts the full data set — the
 * upload must not depend on which uploader produced it) is dropped the same
 * way: `load()` only carries known keys, so it vanishes on the next save.
 *
 * Envelope versions this store can still read. v1 predates `afterAutoRun` /
 * `extractScope` and carried a `shutdownAfterUpload` boolean instead — that key
 * is dropped silently on load (never migrated into `afterAutoRun`) and every new
 * field falls back to its default. The retired `uploadAfterExtract` toggle (a
 * signed-in run now always uploads after a successful extraction) is dropped
 * the same way. Any other
 * version is treated as unreadable and resets to defaults entirely.
 */
const READABLE_VERSIONS = new Set([1, 2, SCHEMA_VERSION]);

interface Envelope {
  v: number;
  settings: Partial<Settings> & { shutdownAfterUpload?: boolean };
}

export class SettingsStore {
  private cache: Settings | null = null;

  constructor(
    private readonly io: TextIO,
    /** Injected id factory (crypto.randomUUID in production). */
    private readonly makeId: () => string,
  ) {}

  /** Load settings, materialising defaults + a fresh installId on first run. */
  load(): Settings {
    if (this.cache) return this.cache;
    const parsed = this.readEnvelope();
    const settings: Settings = {
      telemetryEnabled:
        typeof parsed?.telemetryEnabled === 'boolean' ? parsed.telemetryEnabled : true,
      installId:
        typeof parsed?.installId === 'string' && parsed.installId.length > 0
          ? parsed.installId
          : this.makeId(),
      minimizeToTray: typeof parsed?.minimizeToTray === 'boolean' ? parsed.minimizeToTray : true,
      // Default ON for a new install (the ⚙ sentence's "mit Windows"); a stored
      // value — including the old default OFF — is kept as it is.
      autoStart: typeof parsed?.autoStart === 'boolean' ? parsed.autoStart : true,
      autoRunPreset:
        parsed?.autoRunPreset === 'gaming' ||
        parsed?.autoRunPreset === 'balanced' ||
        parsed?.autoRunPreset === 'full'
          ? parsed.autoRunPreset
          : 'balanced',
      whenDoneLast: parsed?.whenDoneLast === 'quit' ? 'quit' : 'nothing',
      afterAutoRun:
        parsed?.afterAutoRun === 'keep' ||
        parsed?.afterAutoRun === 'quit' ||
        parsed?.afterAutoRun === 'shutdown'
          ? parsed.afterAutoRun
          : 'quit',
      speedProfile:
        parsed?.speedProfile === 'minimal' ||
        parsed?.speedProfile === 'standard' ||
        parsed?.speedProfile === 'maximum'
          ? parsed.speedProfile
          : 'standard',
      ...(readResourceLimits(parsed?.resourceLimits)
        ? { resourceLimits: readResourceLimits(parsed?.resourceLimits) }
        : {}),
      useGpu: typeof parsed?.useGpu === 'boolean' ? parsed.useGpu : false,
      pkgFps: parsed?.pkgFps === true,
      pkgItems: parsed?.pkgItems === true,
      pkgArmor: parsed?.pkgArmor === true,
      updateChannel:
        parsed?.updateChannel === 'alpha' || parsed?.updateChannel === 'beta'
          ? parsed.updateChannel
          : 'stable',
      ...(typeof parsed?.language === 'string' && parsed.language.length > 0
        ? { language: parsed.language }
        : {}),
      ...(typeof parsed?.gamePath === 'string' && parsed.gamePath.length > 0
        ? { gamePath: parsed.gamePath }
        : {}),
    };
    this.cache = settings;
    // Persist immediately so the freshly-minted installId is stable next launch.
    if (!parsed || parsed.installId !== settings.installId) this.persist(settings);
    return settings;
  }

  isTelemetryEnabled(): boolean {
    return this.load().telemetryEnabled;
  }

  setTelemetryEnabled(enabled: boolean): Settings {
    return this.patch({ telemetryEnabled: enabled });
  }

  /**
   * Merge a partial update. `installId` is deliberately not patchable — it is
   * the stable crash-dedup id and must survive every settings change.
   */
  patch(partial: Partial<Omit<Settings, 'installId'>>): Settings {
    const next: Settings = { ...this.load(), ...partial };
    this.cache = next;
    this.persist(next);
    return next;
  }

  private readEnvelope(): Envelope['settings'] | null {
    const raw = this.io.read();
    if (!raw) return null;
    try {
      const env = JSON.parse(raw) as Partial<Envelope>;
      if (typeof env.v !== 'number' || !READABLE_VERSIONS.has(env.v) || !env.settings) {
        return null;
      }
      // `shutdownAfterUpload` (v1 only) is never read into the typed Settings
      // shape below — dropping it here is enough to keep it from surviving a
      // load or influencing `afterAutoRun`.
      return env.settings;
    } catch {
      return null;
    }
  }

  private persist(settings: Settings): void {
    const env: Envelope = { v: SCHEMA_VERSION, settings };
    try {
      this.io.write(JSON.stringify(env));
    } catch {
      /* best-effort — a read-only profile just loses persistence, not function */
    }
  }
}
