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
}

/** Injectable text persistence (file-backed in production). */
export interface TextIO {
  read(): string | null;
  write(text: string): void;
}

const SCHEMA_VERSION = 1;

interface Envelope {
  v: number;
  settings: Settings;
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
    const next: Settings = { ...this.load(), telemetryEnabled: enabled };
    this.cache = next;
    this.persist(next);
    return next;
  }

  private readEnvelope(): Partial<Settings> | null {
    const raw = this.io.read();
    if (!raw) return null;
    try {
      const env = JSON.parse(raw) as Partial<Envelope>;
      if (env.v !== SCHEMA_VERSION || !env.settings) return null;
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
