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
  /** Launch with Windows (registered via Electron's login-item API). Default OFF. */
  autoStart: boolean;
  /**
   * On launch, compare the local data.p4k against what's already uploaded and
   * run the whole pipeline unattended when it differs. Default OFF — it starts
   * hours of CPU work, so it must be a deliberate opt-in.
   */
  autoRunOnNewVersion: boolean;
  /**
   * After an UNATTENDED launch (the `--hidden` autostart login item), close the
   * program again once there is nothing left for it to do: immediately when the
   * auto-run decided the server already holds this build, and right after a
   * fully-confirmed upload. Default ON — an autostart that leaves a tray icon
   * sitting there forever is the thing nobody asked for; a foreground start the
   * operator opened themselves is never touched by this.
   */
  quitAfterAutoRun: boolean;
  /**
   * What happens after an UNATTENDED run that uploaded successfully. Replaces
   * the old boolean `shutdownAfterUpload` (removed in schema v2) — a foreground
   * run's "when done" choice lives only in renderer memory and is never
   * persisted here. Default 'quit'.
   */
  afterAutoRun: 'keep' | 'quit' | 'shutdown';
  /**
   * How much of the game data an extraction run pulls. Default 'standard'.
   */
  extractScope: 'minimal' | 'standard' | 'maximum';
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
}

/** Injectable text persistence (file-backed in production). */
export interface TextIO {
  read(): string | null;
  write(text: string): void;
}

const SCHEMA_VERSION = 2;

/**
 * Envelope versions this store can still read. v1 predates `afterAutoRun` /
 * `extractScope` and carried a `shutdownAfterUpload` boolean instead — that key
 * is dropped silently on load (never migrated into `afterAutoRun`) and every new
 * field falls back to its default. The retired `uploadAfterExtract` toggle (a
 * signed-in run now always uploads after a successful extraction) is dropped
 * the same way. Any other
 * version is treated as unreadable and resets to defaults entirely.
 */
const READABLE_VERSIONS = new Set([1, SCHEMA_VERSION]);

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
      autoStart: typeof parsed?.autoStart === 'boolean' ? parsed.autoStart : false,
      autoRunOnNewVersion:
        typeof parsed?.autoRunOnNewVersion === 'boolean' ? parsed.autoRunOnNewVersion : false,
      // Default ON (unlike the row above): this one only ever ENDS a process
      // nobody is looking at, so the safe direction is to do it.
      quitAfterAutoRun:
        typeof parsed?.quitAfterAutoRun === 'boolean' ? parsed.quitAfterAutoRun : true,
      afterAutoRun:
        parsed?.afterAutoRun === 'keep' ||
        parsed?.afterAutoRun === 'quit' ||
        parsed?.afterAutoRun === 'shutdown'
          ? parsed.afterAutoRun
          : 'quit',
      extractScope:
        parsed?.extractScope === 'minimal' ||
        parsed?.extractScope === 'standard' ||
        parsed?.extractScope === 'maximum'
          ? parsed.extractScope
          : 'standard',
      updateChannel:
        parsed?.updateChannel === 'alpha' || parsed?.updateChannel === 'beta'
          ? parsed.updateChannel
          : 'stable',
      ...(typeof parsed?.language === 'string' && parsed.language.length > 0
        ? { language: parsed.language }
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
