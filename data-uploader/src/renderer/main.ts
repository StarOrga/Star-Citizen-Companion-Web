/**
 * Renderer entry — Phase 1 shell.
 *
 * Three views: Discover → Configure → Run. View routing is a simple state
 * machine — no framework yet (keep the bundle tiny). Phase 2 may bring in
 * Lit or Preact if the UI grows.
 */

import { load as loadI18n, getLocale, t } from '../lib/i18n.js';
import { shouldQuitAfterAutoRun } from '../lib/auto-run.js';
import { tallySkinUpload, skinUploadFrame, skinUploadStatus } from '../lib/skin-upload-summary.js';
import { buildRunPlan, type RunPlan, type WhenDone } from '../lib/run-plan.js';
import { openSettingsDialog, closeSettingsDialogIfOpen } from './settings-dialog.js';
import { $, escapeHtml } from './dom.js';
import { paintStepRail, type StepKey } from './shell/step-rail.js';
import { setStatus as setBottomStatus, showSnackbar } from './shell/bottom-strip.js';
import { wireChevrons, paintChevrons } from './shell/chevrons.js';
import { toggleConnectionPopover, isConnectionPopoverOpen, closeConnectionPopover } from './connection-popover.js';
import { installKeymap } from './keymap.js';
import { closeOptionsSheetIfOpen } from './options-sheet.js';
import { closeLogDrawer } from './log-drawer.js';
import * as InstallStep from './steps/install.js';
import * as SetupStep from './steps/setup.js';
import * as DoneStep from './steps/done.js';
import { throttleChipHtml, wireThrottleChip } from './throttle-chip.js';
import { resetLog, appendLog as drawerAppendLog, wireLogDrawer } from './log-drawer.js';
import { updateCategoryBars, categoryBarsHtml, resetCategoryBars, markCategoriesComplete } from './steps/category-bars.js';
// Local mirrors of the shapes the preload bridge hands us, following this
// file's existing convention (see `ToolEnv` / `ConnSnapshot` below). The
// renderer's tsconfig project only spans `src/renderer/**` + i18n, so importing
// these from `src/main` / `src/preload` would drag Node/Electron-only modules
// into a DOM-only program.
interface ResumeSummaryLike {
  stages: { stage: 'bundle' | 'catalog' | 'skins'; state: 'done' | 'active' | 'pending' }[];
  activeStage: 'bundle' | 'catalog' | 'skins' | null;
  macroStep: number | null;
  macroTotal: number;
  catalog?: { step: number; total: number; phase: string };
  skinsDone?: number;
}

interface JobViewLike {
  resumable: boolean;
  resumeHint: string | null;
  resumeSummary: ResumeSummaryLike | null;
  state: { status: string } | null;
}

/** Mirror of `main/catalog-bridge.ts:CatalogUploadResult` (see the note above). */
interface CatalogUploadResult {
  ok: boolean;
  buildId?: string;
  counts?: Record<string, number>;
  error?: string;
  errorCode?: string;
  errorPhase?: string;
}

/** Performance profiles the operator can pick — mirrors `lib/performance.ts`. */
type LiveProfile = 'minimal' | 'standard' | 'maximum' | 'auto';

/** Mirror of the `PerformanceProfile` shape the bridge hands back. */
interface ProfileDefLike {
  id: string;
  label: { en: string };
  description: { en: string };
}

/** Mirror of `main/throttle.ts:ThrottleSetResult`. */
interface ThrottleViewLike {
  profile: LiveProfile;
  liveJobs: number;
  supported: boolean;
  changed?: boolean;
  applied?: number;
}

export interface PublicSettings {
  telemetryEnabled: boolean;
  minimizeToTray: boolean;
  autoStart: boolean;
  autoRunOnNewVersion: boolean;
  quitAfterAutoRun: boolean;
  /** What happens after an UNATTENDED run that uploaded. Default 'quit'. */
  afterAutoRun: 'keep' | 'quit' | 'shutdown';
  /** Start the upload step automatically once extraction finishes. Default true. */
  uploadAfterExtract: boolean;
  /** How much of the game data an extraction run pulls. Default 'standard'. */
  extractScope: 'minimal' | 'standard' | 'maximum';
  updateChannel: 'alpha' | 'beta' | 'stable';
  /** Persisted UI locale; undefined = renderer's own detection/fallback. */
  language?: string;
}
import {
  progressCardHtml,
  mountProgress,
  type ProgressController,
  type ProgressStep,
  type ProgressLabels,
} from './progress.js';

interface ToolEnv {
  toolVersion: string;
  apiBase: string;
  webBase: string;
  releaseTokenFingerprint: string;
  platform: string;
  startedHidden: boolean;
}

// Funnel renderer-side failures into the same main.log + crash telemetry as the
// main process. Installed synchronously at module load — before init() runs —
// so an error during startup is still captured. Best-effort: window.sc may be
// briefly undefined only if the preload failed entirely (itself logged there).
function installRendererCrashCapture(): void {
  window.addEventListener('error', (ev) => {
    const err = ev.error instanceof Error ? ev.error : null;
    window.sc?.log?.crash({
      name: err?.name ?? 'Error',
      message: err?.message ?? String(ev.message ?? 'unknown renderer error'),
      stack: err?.stack ?? null,
    });
  });
  window.addEventListener('unhandledrejection', (ev) => {
    const reason = ev.reason;
    const err = reason instanceof Error ? reason : null;
    window.sc?.log?.crash({
      name: err?.name ?? 'UnhandledRejection',
      message: err?.message ?? String(reason),
      stack: err?.stack ?? null,
    });
  });
}
installRendererCrashCapture();

// Internal view names kept from the original 4-view routing (discover →
// configure → run → auth-upload) — the one-screen shell maps each onto a
// step-rail node (see `viewToStep` below) without renaming the state field
// everywhere it's referenced. 'done' is new: the post-upload summary/countdown.
type ViewName = 'discover' | 'configure' | 'run' | 'auth-upload' | 'done';
type LogLevel = 'info' | 'success' | 'warn' | 'error';

function viewToStep(v: ViewName): StepKey {
  switch (v) {
    case 'discover':
      return 'install';
    case 'configure':
      return 'setup';
    case 'run':
      return 'extract';
    case 'auth-upload':
      return 'upload';
    case 'done':
      return 'done';
  }
}

interface SkinShipResult {
  ship_id: string;
  export_dir: string;
  skins: { skin_id: string; name: string; has_model: boolean; has_icon: boolean }[];
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

// Logical display order for entity counters (run view + upload summary).
// Reference data first (strings, manufacturers), then the ship → component →
// weapon → ammunition → blueprint chain, with the records_total meta count last.
// Keys not listed fall to the end alphabetically, so a future extractor counter
// still shows up (just unsorted) instead of silently vanishing.
const COUNTER_ORDER = [
  'strings',
  'manufacturers',
  'ships',
  'vehicles',
  'skins',
  'components',
  'items',
  'weapons',
  'ammunition',
  'blueprints',
  'records_total',
] as const;

export function orderedCounts(counts: Record<string, number>): [string, number][] {
  const rank = (k: string): number => {
    const i = (COUNTER_ORDER as readonly string[]).indexOf(k);
    return i === -1 ? COUNTER_ORDER.length : i;
  };
  return Object.entries(counts).sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b));
}

// `t()` returns the key itself when a string is missing — so for the dynamic
// extractor keys (phase / stage / counter names that the Python side invents)
// fall back to the bare key instead of leaking "run.counter.foo" into the UI.
function tOr(key: string, fallback: string, params: Record<string, string | number> = {}): string {
  const v = t(key, params);
  return v === key ? fallback : v;
}
const phaseLabel = (p: string): string => tOr(`run.phase.${p}`, p);
const stageLabel = (s: string): string => tOr(`run.stage.${s}`, s);
const counterLabel = (k: string): string => tOr(`run.counter.${k}`, k);

function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export const state = {
  view: 'discover' as ViewName,
  // Auto-scan runs once on app start; returning to the Discover view keeps the
  // prior results (and any manually-added folders) instead of re-scanning.
  scanning: false,
  scanned: false,
  channels: [] as Array<{
    channel: string;
    installPath: string;
    dataP4kPath: string;
    version: string | null;
    sizeBytes: number;
    source: string;
    selected: boolean;
  }>,
  // Display mirror of the profile MAIN holds. Main owns it because it is live:
  // switching mid-run has to reach the already-spawned sidecar, whose pid only
  // main knows. Never write this directly — go through `applyProfile()`.
  profile: 'standard' as LiveProfile,
  /** False on a platform with no live priority control — the UI must not imply one. */
  throttleSupported: true,
  // Per-run "when done" pick (nothing / quit / shutdown) — renderer memory
  // only, never persisted. Reset to 'nothing' at the start of every run.
  whenDone: 'nothing' as WhenDone,
  // The plan the currently active (or last) run was started from — built by
  // `buildRunPlan()` at the single `startRun()` entry point. Drives
  // `maybeShutdownAfterUpload` / `maybeQuitAfterUpload` and the armed chip.
  runPlan: null as RunPlan | null,
  lastResult: null as ExtractResultPayload | null,
  // Flips true the moment the extract finishes OK — drives the clear
  // "Bundle fertig, du kannst hochladen" affordance on the Run screen.
  extractDone: false,
  authToken: null as string | null,
  // 3D-livery build result from the upload step (skins ride along the normal
  // extract → upload flow — no separate view).
  skinResult: null as SkinShipResult[] | null,
  /** Warn-level outcome of the last skin upload (failed ships) — survives the cleanup status line. */
  skinUploadStatus: null as string | null,
  // Portable-only "a newer version is available" hint, shown on the Discover
  // (first) screen only and dismissible for the session.
  manualUpdate: null as { currentVersion: string; latestVersion: string } | null,
  manualUpdateDismissed: false,
  // Mirrors the durable upload job owned by the main process. Only a display
  // cache — the file under userData is the source of truth, which is what lets
  // an upload resume after the app is closed or killed.
  uploadPaused: false,
  resumableJob: null as JobViewLike | null,
  // Persisted prefs owned by main (tray / autostart / auto-run). Cached here
  // only so the Configure view can render the checkboxes synchronously.
  settings: null as PublicSettings | null,
  // The signed-in user's role — gates the update-channel picker (viewer: hidden).
  role: null as 'admin' | 'collaborator' | 'viewer' | null,
};

async function init(): Promise<void> {
  await loadI18n();
  applyBranding();
  const env = await window.sc.env();
  paintEnv(env);

  // "Require a login every time the app is opened": a normal (foreground) launch
  // must not silently reuse the persisted session — the operator signs in fresh,
  // which also mints a token good for the whole run. The unattended `--hidden`
  // autostart is exempt: it has no one to click "connect", so it keeps using the
  // stored session to drive the auto-run.
  requireFreshLogin = !env.startedHidden;
  startedHidden = env.startedHidden;

  // Language now lives in the ⚙ Settings dialog (settings-dialog.ts), which
  // calls `setLocale` + repaints directly — no topbar select to wire here.
  const gear = $('#btn-settings-gear') as HTMLButtonElement | null;
  if (gear) {
    const label = `${t('settings.title')} (Ctrl+,)`;
    gear.title = label;
    gear.setAttribute('aria-label', label);
    gear.addEventListener('click', () => openAppSettingsDialog());
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === ',' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      openAppSettingsDialog();
      return;
    }
    if (e.key === 'Escape') closeSettingsDialogIfOpen();
  });

  // The tray is built before the renderer exists, so it starts on English
  // defaults; hand it the real strings as soon as i18n is up.
  pushTrayLabels();

  // Cache the persisted prefs so the Configure view can render its checkboxes.
  try {
    state.settings = await window.sc.settings.get();
  } catch {
    state.settings = null;
  }

  // Adopt the profile MAIN currently holds (it may already be steering an
  // auto-run that started before this window existed), and follow every later
  // switch — including ones made from another view or another window.
  await refreshProfileFromMain();
  window.sc.perf.onChanged((v: ThrottleViewLike) => adoptThrottle(v));

  // Connection chip (top strip) → popover with today's connection-tile content.
  $('#connection-chip')?.addEventListener('click', () => toggleConnectionPopover(paintConnection));

  wireChevrons({
    goPrev: () => {
      if (state.view === 'configure') {
        state.view = 'discover';
        render();
      }
    },
    goNext: () => {
      if (state.view === 'discover') goToSetup();
    },
  });

  installKeymap({
    isTextInputFocused: () => {
      const el = document.activeElement;
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA');
    },
    escHandlers: [
      closeOptionsSheetIfOpen,
      closeSettingsDialogIfOpen,
      () => {
        if (!isConnectionPopoverOpen()) return false;
        closeConnectionPopover();
        return true;
      },
      closeLogDrawer,
      () => (state.view === 'done' ? DoneStep.cancelCountdown() : false),
    ],
    onEnter: () => {
      if (state.view === 'discover') InstallStep.primaryAction();
      else if (state.view === 'configure') SetupStep.primaryAction();
      else if (state.view === 'done') DoneStep.primaryAction();
    },
    onSpace: () => toggleUploadPauseResume(),
  });

  // Role decides whether the Configure view shows the update-channel picker.
  try {
    state.role = await window.sc.session.role();
  } catch {
    state.role = 'viewer';
  }

  // The tray's Resume item can only signal intent — the renderer sequences the
  // upload stages, so it has to do the actual resuming.
  window.sc.autoRun.onResumeRequested(() => {
    state.view = 'auth-upload';
    render();
    // Same restart caveat as the in-window button: the tray is typically used
    // on a long-running instance, but nothing guarantees an extraction result
    // is still in memory.
    void ensureResultForResume().then((ok) => {
      if (ok) void doStartUpload();
    });
  });

  // Auto-update banner — subscribe + paint last known status (no-op on dev).
  window.sc.update.onEvent(onUpdateEvent);
  void window.sc.update.status().then(onUpdateEvent);

  // Web-connection tile — auto-connect (persisted session) + auto-sync.
  void initConnectionTile();

  // Re-validate the session whenever the operator returns to the window — the
  // web app may have been redeployed in the background, invalidating the login.
  // `force` bypasses the throttle since a focus event is a deliberate return.
  window.addEventListener('focus', () => void revalidateSession(true));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void revalidateSession(true);
  });

  render();

  // Unattended "new data.p4k → run everything" check. Last, so a decision that
  // starts a run does so against a fully wired UI. Never awaited by init.
  void maybeAutoRun();
}

// ============= Auto-run (new data.p4k → full pipeline, unattended) =============

/** Hand the tray its strings, resolved from the renderer's dictionary. */
function pushTrayLabels(): void {
  window.sc.tray.setLabels({
    open: t('tray.open', {}) || 'Fenster öffnen',
    quit: t('tray.quit', {}) || 'Beenden',
    pauseUpload: t('upload.job.pause', {}) || 'Pause',
    resumeUpload: t('upload.job.resumeAction', {}) || 'Upload fortsetzen',
    hiddenHint: t('tray.hiddenHint', {}) || 'Läuft im Tray weiter.',
    idle: t('tray.idle', {}) || 'Bereit',
    extract: t('tray.extract', {}) || 'Extraktion',
    upload: t('tray.upload', {}) || 'Upload',
    done: t('tray.done', {}) || 'fertig',
    error: t('tray.error', {}) || 'fehlgeschlagen',
    paused: t('upload.job.pauseShort', {}) || 'pausiert',
  });
}

/**
 * Ask main whether the local data.p4k is newer than what the server holds and,
 * if so, drive the whole pipeline: select the channel → extract → upload.
 *
 * Deliberately reuses the existing manual path (`buildRunPlan` + the Run view)
 * rather than a parallel "unattended" pipeline — one code path means the
 * automated run cannot silently diverge from the one that gets exercised daily.
 */
async function maybeAutoRun(): Promise<void> {
  // A job left over from a kill outranks starting a brand-new extraction: it is
  // already paid for, and re-running would duplicate the work.
  await refreshJobView();
  if (state.resumableJob?.resumable) {
    setStatus(t('autorun.resumeFirst', {}) || 'Unterbrochener Upload gefunden — Auto-Lauf übersprungen.');
    state.view = 'auth-upload';
    render();
    return;
  }

  let decision: Awaited<ReturnType<typeof window.sc.autoRun.decide>>;
  try {
    decision = await window.sc.autoRun.decide(Boolean(state.authToken));
  } catch {
    return;
  }
  if (!decision.run || !decision.channel) {
    // Nothing to upload and nobody watching → close again instead of leaving a
    // tray icon behind for the rest of the day (feedback 71b1e402). Only for the
    // one skip reason that actually means "the server already has this build";
    // every other reason is something the operator should still be able to see.
    if (
      shouldQuitAfterAutoRun({
        startedHidden,
        enabled: Boolean(state.settings?.quitAfterAutoRun),
        reason: decision.reason,
      })
    ) {
      await window.sc.system.quit();
    }
    return;
  }

  // Adopt the decided channel as the selection the run operates on.
  state.channels = [
    {
      channel: decision.channel.channel,
      installPath: decision.channel.installPath,
      dataP4kPath: decision.channel.dataP4kPath,
      version: decision.channel.version,
      sizeBytes: decision.channel.sizeBytes,
      source: decision.channel.source,
      selected: true,
    },
  ];
  state.scanned = true;
  if (!state.settings) return;
  setStatus(
    t('autorun.starting', {
      channel: decision.channel.channel,
      local: decision.localVersion ?? '?',
      server: decision.serverVersion ?? '—',
    }),
  );
  // The unattended plan always rolls the extraction straight into the upload
  // (when signed in) — see `buildRunPlan`. `startRun` is the single entry
  // point into a run for both this (unattended) and the manual Setup path.
  await startRun(
    buildRunPlan({
      unattended: true,
      channel: decision.channel.channel,
      settings: state.settings,
      signedIn: Boolean(state.authToken),
    }),
  );
}

// ============= Web-connection tile (persistent across all views) =============

export interface ConnChannelState {
  channel: string;
  patchVersion: string;
  buildNumber: string;
  qualityScore: number | null;
  entityTotal: number;
  bundleId: string;
  createdAt: string;
}
interface ConnSnapshot { syncedAt: number; channels: ConnChannelState[]; bundleCount: number }
interface ConnSyncProgress { phase: string; pct: number; message?: string; channel?: string }
interface ConnStatus {
  connected: boolean;
  email: string | null;
  expiresAt: number | null;
  canPersist: boolean;
  needsReconnect: boolean;
}

const conn = {
  status: null as ConnStatus | null,
  snapshot: null as ConnSnapshot | null,
  syncing: false,
  syncPct: 0,
  syncPhase: '',
  error: null as string | null,
  resolved: false,
};

// Set true on a foreground launch (see init): the operator must sign in fresh
// this session before any silent/persisted token is used. Cleared the moment an
// interactive login succeeds.
let requireFreshLogin = false;
/**
 * True only for the `--hidden` autostart launch. It gates every "close yourself
 * again" path (feedback 71b1e402): a window the operator opened themselves is
 * never closed out from under them.
 */
let startedHidden = false;

async function initConnectionTile(): Promise<void> {
  // 1. Instant paint from the remembered snapshot — no network ("Fortschritt gemerkt").
  try {
    conn.snapshot = (await window.sc.sync.cached()) as ConnSnapshot | null;
  } catch {
    /* cache optional */
  }
  paintConnection();

  // 2. Live sync-progress subscription — parts build up on the tile.
  window.sc.sync.onEvent((ev: ConnSyncProgress) => {
    conn.syncing = ev.phase !== 'done' && ev.phase !== 'error';
    conn.syncPct = ev.pct;
    conn.syncPhase = ev.phase;
    if (ev.phase === 'error') conn.error = ev.message ?? 'sync_failed';
    paintConnection();
  });

  // 3. A foreground launch requires a fresh login: DON'T auto-connect from the
  // persisted session — show the disconnected tile so the operator signs in
  // deliberately. (`connectNow`/`ensureUploadToken` then run the interactive
  // browser flow.) The unattended `--hidden` autostart still auto-connects.
  if (requireFreshLogin) {
    conn.status = { connected: false, email: null, expiresAt: null, canPersist: true, needsReconnect: false };
    conn.resolved = true;
    paintConnection();
    return;
  }

  // 4. Unattended: resolve session + auto-connect/sync without user interaction.
  await refreshConnection();
}

async function refreshConnection(): Promise<void> {
  try {
    conn.status = (await window.sc.session.status()) as ConnStatus;
  } catch {
    conn.status = { connected: false, email: null, expiresAt: null, canPersist: true, needsReconnect: false };
  }
  conn.resolved = true;
  paintConnection();
  if (conn.status?.connected) {
    // Mirror the token into the upload/skin flows so they skip the re-login.
    try {
      const tok = await window.sc.session.token();
      if (tok.token) state.authToken = tok.token;
    } catch {
      /* ignore */
    }
    // Re-resolve the role now that a session actually exists. init()'s early
    // fetch can land BEFORE the persisted session is restored — then it returns
    // 'viewer', which pins an admin/collaborator to the no-picker default for
    // the whole run (the ring picker in the connection bar stays hidden). Only
    // UPGRADE here: main's fetchUserRole() collapses any transient failure to
    // 'viewer', so applying that blindly could re-hide the picker on a flaky
    // re-check. A real downgrade (sign-out) goes through the disconnected path.
    try {
      const role = await window.sc.session.role();
      if (role !== 'viewer' && role !== state.role) {
        state.role = role;
        paintConnection(); // ring-picker visibility depends on role
      }
    } catch {
      /* keep the last known role */
    }
    void autoSync();
  }
}

async function autoSync(): Promise<void> {
  if (conn.syncing) return;
  conn.syncing = true;
  conn.error = null;
  paintConnection();
  try {
    const r = await window.sc.sync.start();
    if (r.ok && r.snapshot) conn.snapshot = r.snapshot as ConnSnapshot;
    else if (!r.ok) conn.error = r.error ?? 'sync_failed';
  } catch (e) {
    conn.error = (e as Error).message;
  } finally {
    conn.syncing = false;
    paintConnection();
  }
}

// Lightweight session re-check — detects a session that went stale WHILE the
// app was open (e.g. the web app was redeployed and the operator must
// re-authorise) so the "Sitzung abgelaufen" pill appears proactively, instead
// of the failure only surfacing as an error the moment Upload is pressed.
// Unlike refreshConnection() this NEVER kicks off a full catalog sync — it only
// refreshes the connection pill. Throttled so focus/navigation churn is cheap.
const SESSION_REVALIDATE_THROTTLE_MS = 30_000;
let lastSessionRevalidateAt = 0;

async function revalidateSession(force = false): Promise<void> {
  if (!conn.resolved) return; // initial resolve owns the first status fetch
  // While a fresh login is still required (foreground launch, not signed in
  // yet), don't probe the persisted session — that would silently flip the pill
  // to "connected" and undermine the sign-in-on-every-start guarantee.
  if (requireFreshLogin) return;
  const now = Date.now();
  if (!force && now - lastSessionRevalidateAt < SESSION_REVALIDATE_THROTTLE_MS) return;
  lastSessionRevalidateAt = now;
  let next: ConnStatus;
  try {
    next = (await window.sc.session.status()) as ConnStatus;
  } catch {
    return; // transient failure — keep the last known pill rather than flapping
  }
  const was = conn.status?.connected ?? false;
  conn.status = next;
  if (!next.connected) state.authToken = null; // force a fresh token on next upload
  paintConnection();
  // Only just discovered the session died → also refresh the auth-upload
  // warning if that view is currently showing.
  if (was && !next.connected && state.view === 'auth-upload') paintReconnectNotice();
}

export async function connectNow(): Promise<void> {
  conn.error = null;
  setConnBusy(true);
  try {
    const r = await window.sc.authenticate();
    if (r.ok && r.accessToken) {
      state.authToken = r.accessToken;
      requireFreshLogin = false; // signed in this session
      await refreshConnection();
    } else {
      conn.error = r.error ?? (t('session.connectFailed', {}) || 'Anmeldung fehlgeschlagen');
      paintConnection();
    }
  } finally {
    setConnBusy(false);
  }
}

async function signOutNow(): Promise<void> {
  try {
    await window.sc.session.signOut();
  } catch {
    /* ignore */
  }
  state.authToken = null;
  conn.status = {
    connected: false,
    email: null,
    expiresAt: null,
    canPersist: conn.status?.canPersist ?? true,
    needsReconnect: false,
  };
  paintConnection();
}

// Prefer the persisted/refreshed session token (no re-login); fall back to an
// interactive browser login only when there is no usable session.
//
// Exception: on a foreground launch (`requireFreshLogin`) the operator has not
// yet signed in THIS session, so skip the silent/persisted token entirely and go
// straight to the interactive browser login — otherwise "log in on every start"
// would be silently defeated by the stored session.
async function ensureUploadToken(): Promise<string | null> {
  if (!requireFreshLogin) {
    try {
      const tok = await window.sc.session.token();
      if (tok.token) {
        state.authToken = tok.token;
        return tok.token;
      }
    } catch {
      /* fall through to interactive login */
    }
  }
  const r = await window.sc.authenticate();
  if (r.ok && r.accessToken) {
    state.authToken = r.accessToken;
    requireFreshLogin = false; // signed in this session
    void refreshConnection();
    return r.accessToken;
  }
  return null;
}

function setConnBusy(busy: boolean): void {
  const btn = $('#conn-connect') as HTMLButtonElement | null;
  if (btn) btn.disabled = busy;
}

function relTime(unixSeconds: number): string {
  const deltaSec = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds);
  if (deltaSec < 60) return t('sync.justNow', {}) || 'gerade eben';
  const mins = Math.floor(deltaSec / 60);
  if (mins < 60) return t('sync.minutesAgo', { n: String(mins) }) || `vor ${mins} Min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t('sync.hoursAgo', { n: String(hours) }) || `vor ${hours} Std`;
  const days = Math.floor(hours / 24);
  return t('sync.daysAgo', { n: String(days) }) || `vor ${days} Tg`;
}

function connErrorText(code: string): string {
  if (code === 'reconnect') return t('session.expiredHint', {}) || 'Sitzung abgelaufen — bitte neu verbinden.';
  if (code === 'not_connected') return t('session.offline', {}) || 'Nicht verbunden.';
  if (code === 'sync_failed') return t('sync.failed', {}) || 'Sync fehlgeschlagen.';
  return code;
}

// Inline line icons (Tabler set, MIT). The renderer CSP blocks CDN webfonts,
// so icons ship as inline SVG — they inherit `currentColor` + size from CSS.
const IC_CLOUD =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.657 18c-2.572 0 -4.657 -2.007 -4.657 -4.483c0 -2.475 2.085 -4.482 4.657 -4.482c.393 -1.762 1.794 -3.2 3.675 -3.773c1.88 -.572 3.956 -.193 5.444 1c1.488 1.19 2.162 3.007 1.77 4.769h.99c1.913 0 3.464 1.56 3.464 3.483c0 1.921 -1.551 3.481 -3.465 3.481h-11.878"/></svg>';
const IC_REFRESH =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4"/><path d="M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4"/></svg>';
const IC_LOGOUT =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 8v-2a2 2 0 0 0 -2 -2h-7a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h7a2 2 0 0 0 2 -2v-2"/><path d="M9 12h12l-3 -3"/><path d="M18 15l3 -3"/></svg>';
const IC_RING =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 18m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"/><path d="M7 6m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"/><path d="M17 6m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"/><path d="M7 8l0 8"/><path d="M9 18h6a2 2 0 0 0 2 -2v-5"/><path d="M14 14l3 -3l3 3"/></svg>';

/**
 * Compact, single-row web-connection bar. One line carries everything:
 * a live status dot, the identity (email when signed in, a connect CTA
 * otherwise), the server-catalog chips + freshness, and the action cluster
 * (release-ring picker + refresh + sign-out as icon buttons). A running sync
 * swaps the middle for a thin progress bar; persist/error notes stack below.
 *
 * The ring picker used to live buried on the Configure view — it now rides
 * here so it is reachable on every screen (role-gated: admin→3, collab→2 rings).
 */
function paintConnection(): void {
  const s = conn.status;
  const snap = conn.snapshot;

  let pillCls = 'offline';
  let pillText = t('session.offline', {}) || 'Nicht verbunden';
  if (!conn.resolved) {
    pillCls = 'pending';
    pillText = t('session.checking', {}) || 'Prüfe…';
  } else if (s?.connected) {
    pillCls = 'online';
    pillText = t('session.connected', {}) || 'Verbunden';
  } else if (s?.needsReconnect) {
    pillCls = 'warn';
    pillText = t('session.expired', {}) || 'Sitzung abgelaufen';
  }

  // Compact top-strip chip: dot + short identity + first server chip. Always
  // painted, independent of whether the detail popover is open.
  const chip = $('#connection-chip');
  if (chip) {
    const who = s?.connected ? escapeHtml(s.email ?? '') : pillText;
    const serverBit = snap?.channels[0]
      ? ` · ${escapeHtml(snap.channels[0].channel.toUpperCase())} v${escapeHtml(snap.channels[0].patchVersion)}`
      : '';
    chip.innerHTML = `<span class="conn-dot conn-dot--${pillCls}"></span> ${who}${serverBit}`;
  }

  // Detail body only exists while the popover is open (see connection-popover.ts).
  const mount = document.getElementById('connection-popover-body');
  if (!mount) return;

  // Left cluster: email when signed in, otherwise a short state + connect CTA.
  let idBlock: string;
  if (s?.connected) {
    idBlock = `<span class="conn-email" title="${escapeHtml(s.email ?? '')}">${escapeHtml(s.email ?? '')}</span>`;
  } else if (conn.resolved) {
    const label = s?.needsReconnect
      ? t('session.reconnect', {}) || 'Neu verbinden'
      : t('session.connect', {}) || 'Mit Web verbinden';
    idBlock = `<span class="conn-state">${pillText}</span>
        <button id="conn-connect" type="button" class="btn btn-primary btn-sm">${label}</button>`;
  } else {
    idBlock = `<span class="conn-state">${pillText}</span>`;
  }

  // Middle: server-catalog chips + freshness (only when connected + not syncing).
  let serverBlock = '';
  if (s?.connected && !conn.syncing) {
    if (snap) {
      const chips = snap.channels
        .map(
          (c) =>
            `<span class="conn-chip ${escapeHtml(c.channel)}"><strong>${escapeHtml(c.channel.toUpperCase())}</strong> v${escapeHtml(c.patchVersion)} · ${c.entityTotal.toLocaleString()}</span>`,
        )
        .join('');
      serverBlock = `
        <span class="conn-div" aria-hidden="true"></span>
        <span class="conn-srv-ico" aria-hidden="true">${IC_CLOUD}</span>
        <div class="conn-chips">${chips || `<span class="conn-empty">${t('sync.empty', {}) || 'Noch keine Bundles auf dem Server.'}</span>`}</div>
        <span class="conn-fresh">· ${t('sync.lastSynced', { when: relTime(snap.syncedAt) }) || `aktualisiert ${relTime(snap.syncedAt)}`}</span>`;
    } else {
      serverBlock = `
        <span class="conn-div" aria-hidden="true"></span>
        <span class="conn-fresh">${t('sync.idle', {}) || 'Bereit zu synchronisieren.'}</span>`;
    }
  }

  // Right cluster: refresh + sign-out icon buttons. The update-ring picker
  // moved into the ⚙ Settings dialog (role-gated there, --sc-accent-hot).
  let actions = '';
  if (s?.connected) {
    actions = `
      <button id="conn-sync" type="button" class="conn-icon-btn" title="${t('sync.refresh', {}) || 'Aktualisieren'}" aria-label="${t('sync.refresh', {}) || 'Aktualisieren'}">${IC_REFRESH}</button>
      <button id="conn-signout" type="button" class="conn-icon-btn" title="${t('session.signOut', {}) || 'Abmelden'}" aria-label="${t('session.signOut', {}) || 'Abmelden'}">${IC_LOGOUT}</button>`;
  }

  // A running sync replaces the middle with a thin labelled progress bar.
  const syncBar = conn.syncing
    ? `<div class="conn-syncbar">
        <div class="conn-syncbar-head"><span>${t('sync.syncing', {}) || 'Synchronisiere Server-Stand…'}</span><span class="conn-pct">${conn.syncPct}%</span></div>
        <div class="progress-bar"><span style="width:${conn.syncPct}%"></span></div>
      </div>`
    : '';

  const persistNote =
    s && !s.canPersist
      ? `<div class="conn-persist-note">${t('session.noPersist', {}) || 'Hinweis: Kein OS-Schlüsselspeicher — Sitzung gilt nur bis zum Schließen.'}</div>`
      : '';
  const errorRow = conn.error ? `<div class="conn-error">${escapeHtml(connErrorText(conn.error))}</div>` : '';

  mount.innerHTML = `
    <div class="conn-card conn-card--${pillCls}">
      <div class="conn-bar">
        <span class="conn-dot conn-dot--${pillCls}" title="${escapeHtml(pillText)}"></span>
        <div class="conn-idwrap">${idBlock}</div>
        ${serverBlock}
        <span class="conn-spacer"></span>
        <div class="conn-actions">${actions}</div>
      </div>
      ${syncBar}
      ${persistNote}
      ${errorRow}
    </div>
  `;

  $('#conn-connect')?.addEventListener('click', () => void connectNow());
  $('#conn-signout')?.addEventListener('click', () => void signOutNow());
  $('#conn-sync')?.addEventListener('click', () => void autoSync());
}

type UpdateEvent =
  | { type: 'checking' }
  | { type: 'available'; version: string; releaseDate?: string; notes?: string | null }
  | { type: 'not-available'; currentVersion: string }
  | { type: 'progress'; pct: number; bytesPerSecond?: number; transferred?: number; total?: number }
  | { type: 'downloaded'; version: string }
  | { type: 'manual'; currentVersion: string; latestVersion: string }
  | { type: 'error'; message: string };

// Public download page — opened for portable builds that can't self-update.
// window.open is intercepted by the main process' setWindowOpenHandler and
// routed through shell.openExternal (opens in the default browser, no in-app window).
const DOWNLOAD_PAGE_URL = 'https://sc-companion.vercel.app/desktop';

// Update checks ride on navigation instead of a manual button: every view
// transition (opening the uploader, moving to the next step, …) triggers a
// silent check via render() → maybeAutoCheckUpdate(). No user interaction, no
// error banner — outcomes surface through the auto-update banner / manual hint.
const AUTO_UPDATE_CHECK_THROTTLE_MS = 2 * 60 * 1000;
let lastAutoUpdateCheckAt = 0;
// Mirrors the last event type seen via onUpdateEvent, so navigation checks can
// skip while an update is already checking/downloading/staged.
let lastUpdateType: UpdateEvent['type'] | null = null;

function maybeAutoCheckUpdate(): void {
  if (lastUpdateType === 'checking' || isUpdateBusyType(lastUpdateType)) return;
  const now = Date.now();
  if (now - lastAutoUpdateCheckAt < AUTO_UPDATE_CHECK_THROTTLE_MS) return;
  lastAutoUpdateCheckAt = now;
  window.sc.update.checkSilent();
}

function isUpdateBusyType(type: UpdateEvent['type'] | null): boolean {
  return type === 'available' || type === 'progress' || type === 'downloaded';
}

// Routes update events: the portable 'manual' hint lives on the Discover
// (first) screen only (state + paintManualBanner); every other state uses the
// persistent shell banner.
function onUpdateEvent(ev: UpdateEvent): void {
  lastUpdateType = ev.type;
  if (ev.type === 'manual') {
    state.manualUpdate = { currentVersion: ev.currentVersion, latestVersion: ev.latestVersion };
    state.manualUpdateDismissed = false; // a freshly-published newer version re-shows the hint
    paintManualBanner();
    return;
  }
  paintUpdateBanner(ev);
}

// Markup for the dismissible "new version available" banner on the Discover
// screen. Caller decides whether to render it (state.manualUpdate set + not
// dismissed).
export function renderDiscoverUpdateBanner(): string {
  const u = state.manualUpdate;
  if (!u) return '';
  const msg =
    t('update.manual', { version: u.latestVersion }) ||
    `Neue Version v${u.latestVersion} verfügbar — Portable kann sich nicht selbst updaten, bitte manuell laden.`;
  return `
    <div class="discover-update" id="discover-update">
      <span class="discover-update-text">${escapeHtml(msg)}</span>
      <button id="du-download" type="button" class="btn btn-sm">${t('update.openDownload', {}) || 'Download-Seite öffnen'}</button>
      <button id="du-dismiss" type="button" class="discover-update-close" aria-label="${t('common.dismiss', {}) || 'Schließen'}">✕</button>
    </div>`;
}

export function wireDiscoverUpdateBanner(): void {
  $('#du-download')?.addEventListener('click', () => void window.open(DOWNLOAD_PAGE_URL));
  $('#du-dismiss')?.addEventListener('click', () => {
    state.manualUpdateDismissed = true;
    $('#discover-update')?.remove();
  });
}

// Inject/remove the Discover banner in place (the manual event usually arrives
// a few seconds after launch, once the user is already on the first screen).
function paintManualBanner(): void {
  const existing = $('#discover-update');
  const show = state.view === 'discover' && !!state.manualUpdate && !state.manualUpdateDismissed;
  if (!show) {
    existing?.remove();
    return;
  }
  if (existing) return; // already visible
  const view = document.querySelector('#app .view');
  if (!view) return;
  view.insertAdjacentHTML('afterbegin', renderDiscoverUpdateBanner());
  wireDiscoverUpdateBanner();
}

function paintUpdateBanner(ev: UpdateEvent): void {
  const banner = $('#update-banner');
  const text = $('#update-banner-text');
  const action = $('#update-banner-action') as HTMLButtonElement | null;
  if (!banner || !text || !action) return;
  banner.classList.remove('update-banner-error');
  action.style.display = 'none';
  action.onclick = null;

  switch (ev.type) {
    case 'checking':
    case 'not-available':
    // 'manual' is handled outside the shell banner — it renders on the Discover
    // (first) screen only, via paintManualBanner / renderDiscover.
    case 'manual':
      banner.classList.add('hidden');
      return;
    case 'available':
      text.textContent =
        (t('update.available', { version: ev.version }) || `Update verfügbar: v${ev.version} — wird im Hintergrund geladen…`);
      banner.classList.remove('hidden');
      return;
    case 'progress':
      text.textContent =
        (t('update.progress', { pct: String(ev.pct) }) || `Update wird geladen: ${ev.pct}%`);
      banner.classList.remove('hidden');
      return;
    case 'downloaded':
      text.textContent =
        (t('update.downloaded', { version: ev.version }) || `Update v${ev.version} bereit — bitte App neu starten.`);
      action.textContent = t('update.install', {}) || 'Jetzt installieren';
      action.style.display = 'inline-flex';
      action.onclick = () => void window.sc.update.install();
      banner.classList.remove('hidden');
      return;
    case 'error':
      text.textContent = (t('update.error', { message: ev.message }) || `Update-Fehler: ${ev.message}`);
      banner.classList.remove('hidden');
      banner.classList.add('update-banner-error');
      return;
  }
}

// Derive the favicon from the single inline header logo so the SCC monogram is
// defined in exactly one place (index.html). Electron windows have no tab strip,
// so this is mostly cosmetic — but it guarantees favicon and header logo can
// never drift apart, and keeps the renderer free of a second logo copy.
function applyBranding(): void {
  const logo = document.querySelector('svg.logo');
  if (!logo) return;
  const svg = new XMLSerializer().serializeToString(logo);
  const href = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  let link = document.querySelector('link[rel="icon"]') as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.type = 'image/svg+xml';
  link.href = href;
}

function paintEnv(env: ToolEnv): void {
  const vtag = $('#version-tag');
  if (vtag) vtag.textContent = `v${env.toolVersion}`;
  const env_line = $('#env-line');
  if (env_line) env_line.textContent = `${env.platform} · ${env.releaseTokenFingerprint}`;
}

export function setStatus(msg: string): void {
  setBottomStatus(msg);
}

/** True once a run (extract or upload) is live — gates the chevrons + Back. */
function runIsLive(): boolean {
  return state.view === 'run' || state.view === 'auth-upload' || state.view === 'done';
}

function render(): void {
  const app = $('#app');
  if (!app) return;
  // Every navigation is a natural moment to check for updates + re-validate the
  // session (both throttled), so a stale login is caught before the user acts.
  maybeAutoCheckUpdate();
  void revalidateSession();

  const step = viewToStep(state.view);
  paintStepRail({ current: step, activePct: lastOverallPct });
  paintChevrons(step, runIsLive());
  paintConnection();

  switch (state.view) {
    case 'discover':
      app.innerHTML = InstallStep.renderInstall();
      InstallStep.wireInstall();
      break;
    case 'configure':
      app.innerHTML = SetupStep.renderSetup();
      SetupStep.wireSetup();
      break;
    case 'run':
      app.innerHTML = renderRun();
      wireRun();
      break;
    case 'auth-upload':
      app.innerHTML = renderAuthUpload();
      wireAuthUpload();
      break;
    case 'done':
      app.innerHTML = DoneStep.renderDone();
      DoneStep.wireDone();
      break;
  }
}

/** Overall extract/upload percentage, mirrored for the step-rail's fill segment. */
let lastOverallPct = 0;

/**
 * The ONLY entry point into a run — called by the Setup step's Start button
 * AND by `maybeAutoRun`. Never a side effect of rendering: `render()` just
 * mounts the Extract card; the actual sidecar spawn happens right after, once
 * the DOM it paints into exists.
 */
export async function startRun(plan: RunPlan): Promise<void> {
  state.runPlan = plan;
  state.whenDone = plan.whenDone;
  state.view = 'run';
  render();
  await runRealExtract();
}

/** Done step's "Neuen Lauf starten" — back to Install with run state reset. */
export function resetForNewRun(): void {
  state.lastResult = null;
  state.extractDone = false;
  state.skinResult = null;
  state.skinUploadStatus = null;
  state.runPlan = null;
  state.whenDone = 'nothing';
  state.view = 'discover';
  render();
}

// ============= Install/Setup step helpers (used by steps/install.ts + steps/setup.ts) =============

/** Navigate to the Setup step — the Install step's primary/secondary CTA. */
export function goToSetup(): void {
  state.view = 'configure';
  render();
}

export function isConnected(): boolean {
  return Boolean(conn.status?.connected);
}

export function connSnapshotFor(channel: string): ConnChannelState | null {
  const tag = channel.toLowerCase();
  return conn.snapshot?.channels.find((c) => c.channel.toLowerCase() === tag) ?? null;
}

/** The Install step's "Fortsetzen" resumable-job action — jumps into Upload. */
export async function jumpToResumeUpload(): Promise<void> {
  state.view = 'auth-upload';
  render();
  if (await ensureResultForResume()) void doResumeUpload();
}

// ============= View: Configure =============

/** Channels the current role may pick (highest first). Empty = no picker. */
export function allowedChannels(): Array<'alpha' | 'beta' | 'stable'> {
  switch (state.role) {
    case 'admin':
      return ['alpha', 'beta', 'stable'];
    case 'collaborator':
      return ['beta', 'stable'];
    default:
      return [];
  }
}

// The update-channel picker moved out of Configure into the always-visible
// connection bar (see paintConnection). `allowedChannels()` above is shared.

/** Small "armed" chip shown on Setup/Run/Upload while a when-done choice is live. */
export function armedChipHtml(): string {
  const wd = state.runPlan?.whenDone ?? state.whenDone;
  if (wd === 'nothing') return '';
  return `
    <span class="armed-chip" id="armed-chip" title="${t('run.whenDone.' + wd)}">
      ⏻ ${t('run.whenDone.' + wd)}
      <button type="button" id="armed-chip-disarm" aria-label="${t('run.whenDone.disarm')}" title="${t('run.whenDone.disarm')}">✕</button>
    </span>`;
}

export function wireArmedChip(): void {
  $('#armed-chip-disarm')?.addEventListener('click', () => {
    state.whenDone = 'nothing';
    if (state.runPlan) state.runPlan = { ...state.runPlan, whenDone: 'nothing' };
    $('#armed-chip')?.remove();
  });
}

/** Wraps `openSettingsDialog` with the renderer's live context. */
export function openAppSettingsDialog(): void {
  openSettingsDialog({
    getSettings: () => state.settings,
    patch: (partial) => window.sc.settings.patch(partial),
    setTelemetry: (enabled) => window.sc.settings.setTelemetry(enabled),
    getRole: () => state.role,
    allowedChannels,
    onSettingsChanged: (next) => {
      state.settings = next;
    },
    onLocaleChanged: () => {
      render();
      paintConnection();
      pushTrayLabels();
    },
  });
}

// ============= Live performance switch =============
//
// The profile is deliberately NOT a start-time snapshot: the operator's case is
// "I'm about to play — throttle down" / "I'm away for half an hour — throttle
// up", and cancelling a multi-hour extract to change a setting is no answer.
// So the same picker is mounted on Configure (large) and on the Run + Upload
// views (compact), all writing through `applyProfile`, and main pushes the new
// profile into the running sidecar.

/**
 * The single write path for the profile — main is the source of truth.
 * Returns a human status message (applied / armed / unsupported) for the
 * caller (the throttle chip) to route to the bottom-strip snackbar — never
 * paints a DOM status line itself, unlike the old per-view pickers.
 */
export async function applyProfile(next: LiveProfile): Promise<{ message: string } | null> {
  let result: ThrottleViewLike;
  try {
    result = await window.sc.perf.set(next);
  } catch {
    // A failed switch must not leave the UI showing a mode that is not in
    // effect — re-read main's truth.
    await refreshProfileFromMain();
    return null;
  }
  adoptThrottle(result);
  return { message: throttleStatusMessage(result) };
}

/**
 * Tell the operator what the switch actually did. Deliberately three different
 * answers: a switch that reached a running sidecar, a switch that only arms the
 * next run, and a platform where we cannot re-prioritise at all — collapsing
 * them into one cheerful "saved" would be the failure mode where they trust a
 * throttle that never happened and go play anyway.
 */
export function throttleStatusMessage(v: ThrottleViewLike): string {
  if (!v.supported) return t('configure.speed.unsupported');
  if ((v.applied ?? 0) > 0) return t('configure.speed.applied');
  if (v.liveJobs > 0) return t('configure.speed.appliedPartly');
  return t('configure.speed.armed');
}

function adoptThrottle(v: ThrottleViewLike): void {
  state.profile = v.profile;
  state.throttleSupported = v.supported;
}

export async function refreshProfileFromMain(): Promise<void> {
  try {
    adoptThrottle(await window.sc.perf.get());
  } catch {
    /* keep the last known mirror — the chip still works, it just may lag */
  }
}

// ============= View: Run (Phase 1 stub UI) =============

function renderRun(): string {
  return `
    <div class="view step-run">
      <section class="card run-card">
        <div class="run-card-head">
          <h1>${t('run.title')} ${armedChipHtml()}</h1>
          ${throttleChipHtml(state.profile === 'auto' ? 'standard' : state.profile)}
        </div>
        ${progressCardHtml('run-progress', runSteps())}
        ${categoryBarsHtml()}
        <div class="log-line-row">
          <div class="log-lastline" id="log-lastline"></div>
          <button type="button" id="log-drawer-toggle" class="btn-link" title="${t('run.logTitle')} (Ctrl+L)">${t('run.logTitle')} <kbd class="sc-kbd">Ctrl+L</kbd></button>
        </div>
        <div class="log-drawer" id="log-drawer" hidden>
          <div class="log-drawer-head">
            <span class="log-title">${t('run.logTitle')}</span>
            <button id="log-drawer-copy" type="button" class="btn btn-copy">${t('run.copyLog')}</button>
          </div>
          <div class="log-stream" id="log-drawer-body"></div>
        </div>
      </section>
      <p id="run-ready-note" class="run-ready-note" style="display:none;"></p>
      <div class="btn-row view-footer">
        <button id="btn-cancel-extract" class="btn btn-danger-ghost">${t('run.cancel')}</button>
        <button id="btn-to-upload" class="btn btn-primary" disabled>${t('run.next')}</button>
      </div>
    </div>
  `;
}

// Flip the Run footer into a clear "bundle is ready — upload now" state once the
// extraction succeeds, so the affordance reads as a positive call-to-action
// rather than a button that silently un-disables.
function markBundleReady(): void {
  const btn = $('#btn-to-upload') as HTMLButtonElement | null;
  if (btn) {
    btn.removeAttribute('disabled');
    btn.classList.add('btn-ready');
    btn.textContent = `✓ ${t('run.bundleReadyCta')}`;
  }
  const note = $('#run-ready-note');
  if (note) {
    note.textContent = t('run.bundleReady');
    note.style.display = 'block';
  }
  markCategoriesComplete();
}

function wireRun(): void {
  wireArmedChip();
  wireLogDrawer();
  wireThrottleChip({
    getProfile: () => state.profile,
    getLocale: () => getLocale(),
    applyProfile: (next) => applyProfile(next),
    onMessage: (msg) => showSnackbar(msg),
  });
  $('#btn-cancel-extract')?.addEventListener('click', () => {
    void (async () => {
      const ok = await confirmLeave(extractRunning, 'confirm.leave.extract', '');
      if (!ok) return;
      if (currentExtractJobId) {
        try {
          await window.sc.extract.cancel(currentExtractJobId);
        } catch {
          /* best-effort */
        }
      }
      state.view = 'configure';
      render();
    })();
  });
  $('#btn-to-upload')?.addEventListener('click', () => {
    state.view = 'auth-upload';
    render();
  });
}

async function runRealExtract(): Promise<void> {
  const progress = mountProgress('run-progress', {
    counterLabel,
    steps: runSteps(),
    labels: progressLabels(),
    stepLabel: stepCounterLabel,
  });
  const appendLog = (msg: string, level: LogLevel = 'info') => drawerAppendLog(msg, level);
  const countMap: Record<string, number> = {};

  progress.start();
  resetLog();
  resetCategoryBars();
  lastOverallPct = 0;

  const channel = state.channels.find((c) => c.selected);
  if (!channel) {
    appendLog('Kein Channel ausgewählt — zurück zum Setup.', 'error');
    return;
  }

  // Per-tool extract-output dir — Electron's app.getPath('userData') would
  // be cleaner; for now use a sibling of the install path.
  const outDir = `${channel.installPath}/.sc-companion-extracts/${channel.channel}-${channel.version ?? 'unknown'}`;

  appendLog(`extracting ${channel.dataP4kPath}`);
  appendLog(`output → ${outDir}`);

  const unsubscribe = window.sc.extract.onEvent((ev) => {
    currentExtractJobId = ev.jobId; // stable for the run; lets "abort" cancel it
    switch (ev.type) {
      case 'phase': {
        const label = phaseLabel(ev.phase ?? 'unknown');
        const si = RUN_STEP_INDEX[ev.phase ?? ''];
        if (si !== undefined) progress.setStep(si);
        progress.update({ phaseLabel: label, overallPct: ev.pct });
        if (typeof ev.pct === 'number') lastOverallPct = ev.pct;
        if (ev.phase === 'validate' || ev.phase === 'bundle') markCategoriesComplete();
        appendLog(`▶ ${label}`);
        return;
      }
      case 'progress': {
        // Name the two long opaque stages so a multi-minute wait is explained
        // rather than looking hung (they emit pct but no current/total).
        const hint =
          ev.stage === 'open'
            ? t('run.hint.open')
            : ev.stage === 'datacore'
              ? t('run.hint.datacore')
              : '';
        progress.update({
          overallPct: ev.pct,
          stageLabel: stageLabel(ev.stage ?? ''),
          current: ev.current,
          total: ev.total,
          detail: ev.detail,
          hint,
        });
        if (typeof ev.pct === 'number') lastOverallPct = ev.pct;
        return;
      }
      case 'file':
        progress.update({ overallPct: ev.pct });
        if (typeof ev.pct === 'number') lastOverallPct = ev.pct;
        return;
      case 'count':
        if (ev.counter) {
          countMap[ev.counter.key] = ev.counter.value;
          const ordered: Record<string, number> = {};
          for (const [k, v] of orderedCounts(countMap)) ordered[k] = v;
          progress.update({ counters: ordered });
          updateCategoryBars(countMap);
        }
        return;
      case 'log':
        appendLog(ev.message ?? '', ev.level ?? 'info');
        return;
      case 'warning':
        appendLog(ev.message ?? 'warning', 'warn');
        return;
      case 'done':
        progress.setStep(5); // past the last phase → all step chips 'done'
        progress.update({ overallPct: 100, phaseLabel: phaseLabel('done'), stageLabel: '', detail: '', indeterminate: false, hint: '' });
        lastOverallPct = 100;
        markCategoriesComplete();
        return;
      case 'error':
        progress.update({ indeterminate: false });
        appendLog(ev.message ?? 'extraction error', 'error');
        return;
    }
  });

  extractRunning = true;
  try {
    const final = await window.sc.extract.start({
      p4kPath: channel.dataP4kPath,
      outDir,
      channel: channel.channel as 'LIVE' | 'PTU' | 'EPTU' | 'TECH-PREVIEW',
      patchVersion: channel.version ?? 'unknown',
      buildNumber: '', // unknown from disk; server will treat empty as missing
      scope: {
        hdIcons: state.runPlan?.scope !== 'minimal',
        renderPngs: state.runPlan?.scope === 'maximum',
        componentTree: state.runPlan?.scope !== 'minimal',
      },
      toolVersion: (await window.sc.env()).toolVersion,
    });

    if (final.ok && final.result) {
      state.lastResult = final.result;
      state.extractDone = true;
      const totalEntities = Object.values(final.result.entity_counts)
        .reduce((a, b) => a + b, 0)
        .toLocaleString();
      const elapsed = fmtElapsed(progress.elapsedMs());
      appendLog(
        tOr(
          'run.doneSummary',
          `done — quality ${final.result.quality_score.toFixed(0)}/100, ${totalEntities} entities in ${elapsed}`,
          {
            score: final.result.quality_score.toFixed(0),
            entities: totalEntities,
            time: elapsed,
          },
        ),
        'success',
      );
      markBundleReady();
      // Auto-upload only when the run plan asked for it AND a session is
      // already live — never trigger an interactive browser login unattended.
      if (state.runPlan?.uploadAfter && state.authToken) {
        appendLog(t('run.autoUploading'), 'info');
        state.view = 'auth-upload';
        render();
        void doStartUpload();
      }
    } else {
      appendLog(final.error ?? 'unknown extraction failure', 'error');
    }
  } finally {
    extractRunning = false;
    currentExtractJobId = null;
    unsubscribe();
    progress.stop();
    progress.update({ indeterminate: false });
  }
}

// ============= View: Auth-Upload =============

// The 3 sub-flows of one upload run, in the order they actually execute
// (see doUploadAfterAuth) — surfaced as a small stepper on the shared
// progress card so the upload flow reads as a sibling of the Run view.
function uploadSteps(): ProgressStep[] {
  return [
    { key: 'bundle', label: t('upload.steps.bundle', {}) || 'Bundle' },
    { key: 'codex', label: t('upload.steps.codex', {}) || 'Codex' },
    { key: 'skins', label: t('upload.steps.skins', {}) || '3D-Skins' },
  ];
}

// The extract pipeline's fixed phases, surfaced as the same step-chip journey
// the upload flow uses — so both views read as siblings. `phaseLabel` reuses
// the existing run.phase.* i18n keys.
function runSteps(): ProgressStep[] {
  return [
    { key: 'discover', label: phaseLabel('discover') },
    { key: 'plan', label: phaseLabel('plan') },
    { key: 'extract', label: phaseLabel('extract') },
    { key: 'validate', label: phaseLabel('validate') },
    { key: 'bundle', label: phaseLabel('bundle') },
  ];
}
const RUN_STEP_INDEX: Record<string, number> = { discover: 0, plan: 1, extract: 2, validate: 3, bundle: 4 };

// Localized labels for the shared progress meta line (throughput / ETA / stall).
function progressLabels(): Partial<ProgressLabels> {
  return {
    still: t('progress.still', {}) || 'arbeitet noch',
    eta: t('progress.eta', {}) || 'Rest',
    perSec: t('progress.perSec', {}) || '/s',
  };
}

// The always-visible macro position ("Schritt 2/3") the operator asked for.
// Fallback carries the numbers inline since tOr does not interpolate fallbacks.
function stepCounterLabel(step: number, total: number): string {
  return tOr('progress.step', `Schritt ${step}/${total}`, { n: step, total });
}

function renderAuthUpload(): string {
  const result = state.lastResult;
  const hasResult = result !== null;
  const counts = hasResult
    ? orderedCounts(result!.entity_counts)
        .map(([k, v]) => `<li><strong>${k}:</strong> ${v.toLocaleString()}</li>`)
        .join('')
    : '<li><em>no extraction yet</em></li>';
  return `
    <div class="view step-upload">
      <section class="card upload-card">
        <div class="upload-card-head">
          <h1>⇡ ${t('upload.title')} — ${t('upload.codexTitle')} ${armedChipHtml()}</h1>
          <span class="upload-target-chip">→ sc-companion · ${result?.channel ?? '—'}</span>
          <span class="upload-throughput" id="upload-throughput"></span>
        </div>
        <p>${t('upload.intro')}</p>
        <div id="reconnect-notice" class="reconnect-notice" style="display:none;"></div>
        <div id="resume-notice" class="reconnect-notice" style="display:none;"></div>
        <div class="btn-row">
          <button id="btn-start-upload" class="btn btn-primary" ${hasResult ? '' : 'disabled'}>${t('upload.start')}</button>
          <button id="btn-discard-upload" class="btn" style="display:none;">${t('upload.job.discard')}</button>
        </div>
        ${progressCardHtml('upload-progress', uploadSteps())}
        <div id="auth-status" class="upload-status" hidden></div>
        <div id="upload-result" style="margin-top: 14px;"></div>
      </section>
      <details class="upload-bundle-details">
        <summary>${t('upload.bundle')}</summary>
        ${hasResult
          ? `
          <ul class="bundle-meta">
            <li><strong>channel:</strong> ${result!.channel}</li>
            <li><strong>patch:</strong> ${result!.patch_version}</li>
            <li><strong>build:</strong> ${result!.build_number || '<em>n/a</em>'}</li>
            <li><strong>quality:</strong> ${result!.quality_score.toFixed(0)}/100</li>
          </ul>
          <ul class="entity-strip">${counts}</ul>
        `
          : '<p class="warn">No extraction result yet.</p>'}
      </details>
      <button type="button" id="btn-pause-upload" class="fab" style="display:none;" title="${t('upload.job.pause')} (Space)" aria-label="${t('upload.job.pause')}">⏸</button>
      <button type="button" id="btn-resume-upload" class="fab fab-primary" style="display:none;" title="${t('upload.job.resumeAction')} (Space)" aria-label="${t('upload.job.resumeAction')}">▶</button>
    </div>
  `;
}

// Progress-card controller for the currently-mounted upload view — created
// fresh on every `wireAuthUpload()` (i.e. every time the view is (re)rendered),
// read by the upload sub-flow functions below.
let uploadProgress: ProgressController | null = null;

function wireAuthUpload(): void {
  wireArmedChip();
  uploadProgress = mountProgress('upload-progress', {
    counterLabel,
    steps: uploadSteps(),
    labels: progressLabels(),
    stepLabel: stepCounterLabel,
  });
  $('#btn-start-upload')?.addEventListener('click', () => void doStartUpload());
  $('#btn-pause-upload')?.addEventListener('click', () => void doPauseUpload());
  $('#btn-resume-upload')?.addEventListener('click', () => void doResumeUpload());
  $('#btn-discard-upload')?.addEventListener('click', () => void doDiscardUpload());
  // Force a fresh session check on entry so a "re-authorise needed" hint shows
  // up-front here, not only after the upload attempt fails.
  paintReconnectNotice();
  void revalidateSession(true).then(paintReconnectNotice);
  // Surface an upload the last session left unfinished (paused, or killed
  // mid-run) so the operator can continue it instead of starting over.
  void refreshJobView();
}

/** Space shortcut while the Upload step is mounted — pause/resume, no-op otherwise. */
export function toggleUploadPauseResume(): void {
  if (state.view !== 'auth-upload') return;
  if (uploadRunning) void doPauseUpload();
  else if (state.resumableJob?.resumable) void doResumeUpload();
}

// ============= Durable upload job (pause / resume / kill-recovery) =============

/** Pull the main process's job view and repaint the pause/resume affordances. */
async function refreshJobView(): Promise<void> {
  try {
    state.resumableJob = await window.sc.uploadJob.get();
  } catch {
    state.resumableJob = null;
  }
  state.uploadPaused = state.resumableJob?.state?.status === 'paused';
  paintJobNotice();
}

// Turn the structured resume summary into a human, localized banner — e.g.
// "Unterbrochener Upload · Schritt 2/3: Bundle ✓ · Codex (Schritt 3/15) ·
//  3D-Skins offen — fortsetzen?" — so the operator sees exactly what is done and
// what a resume picks up, instead of the raw `catalog:codex_ships@1200` hint.
function formatResumeBanner(sum: ResumeSummaryLike): string {
  const stageName = (st: 'bundle' | 'catalog' | 'skins'): string =>
    st === 'bundle'
      ? tOr('upload.steps.bundle', 'Bundle')
      : st === 'catalog'
        ? tOr('upload.steps.codex', 'Codex')
        : tOr('upload.steps.skins', '3D-Skins');

  const parts = sum.stages.map((s) => {
    const name = stageName(s.stage);
    if (s.state === 'done') return `${name} ✓`;
    if (s.state === 'pending') return `${name} ${tOr('upload.job.stagePending', 'offen')}`;
    // Active stage — append the sub-position we have for the long stages.
    if (s.stage === 'catalog' && sum.catalog) {
      return `${name} (${stepCounterLabel(sum.catalog.step, sum.catalog.total)})`;
    }
    if (s.stage === 'skins' && typeof sum.skinsDone === 'number') {
      return `${name} (${tOr('upload.job.stageSkinsDone', `${sum.skinsDone} Schiffe fertig`, {
        count: sum.skinsDone,
      })})`;
    }
    return `${name} …`;
  });

  const macro = sum.macroStep != null ? stepCounterLabel(sum.macroStep, sum.macroTotal) : '';
  return tOr(
    'upload.job.resumeBannerRich',
    `Unterbrochener Upload · ${macro}: ${parts.join(' · ')} — fortsetzen?`,
    { macro, stages: parts.join(' · ') },
  );
}

/**
 * Paint the resume banner + button visibility from the job view.
 * Three mutually-exclusive shapes: idle (nothing), running (Pause offered),
 * resumable (banner + Resume/Discard).
 */
function paintJobNotice(): void {
  const notice = $('#resume-notice');
  const startBtn = $('#btn-start-upload') as HTMLButtonElement | null;
  const pauseBtn = $('#btn-pause-upload') as HTMLButtonElement | null;
  const resumeBtn = $('#btn-resume-upload') as HTMLButtonElement | null;
  const discardBtn = $('#btn-discard-upload') as HTMLButtonElement | null;
  if (!notice || !startBtn || !pauseBtn || !resumeBtn || !discardBtn) return;

  const job = state.resumableJob;
  const resumable = Boolean(job?.resumable);
  const running = uploadRunning;

  pauseBtn.style.display = running ? '' : 'none';
  // A finished/paused run re-arms the button for the next one.
  if (!running) {
    pauseBtn.disabled = false;
    pauseBtn.textContent = tOr('upload.job.pause', 'Pause');
  }
  resumeBtn.style.display = !running && resumable ? '' : 'none';
  discardBtn.style.display = !running && resumable ? '' : 'none';
  // A resumable job makes "start over" the wrong default — hide it so the
  // operator resumes rather than silently re-uploading everything.
  startBtn.style.display = !running && resumable ? 'none' : '';

  if (!running && resumable && job?.resumeSummary) {
    notice.textContent = formatResumeBanner(job.resumeSummary);
    notice.style.display = 'block';
  } else if (!running && resumable && job?.resumeHint) {
    // Fallback for an older main process that predates the structured summary.
    notice.textContent =
      t('upload.job.resumeBanner', { hint: job.resumeHint }) ||
      `Unterbrochener Upload gefunden (${job.resumeHint}) — fortsetzen?`;
    notice.style.display = 'block';
  } else {
    notice.style.display = 'none';
  }
}

/** True while this renderer is actively driving the stages. */
let uploadRunning = false;

/** True while a local P4K extraction is in flight (Run view). */
let extractRunning = false;
/** Job id of the in-flight extraction, so "back" can actually abort it. */
let currentExtractJobId: string | null = null;

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
}

/**
 * SCC-styled confirmation overlay. Resolves true if the operator confirms the
 * (destructive) action, false on cancel / Escape / backdrop click. Used to guard
 * a "back" navigation that would throw away a running extraction or upload
 * progress. Dynamic text is set via textContent (never innerHTML) so a channel
 * name or filename can't inject markup.
 */
function confirmDiscard(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    document.getElementById('sc-modal-overlay')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'sc-modal-overlay';
    overlay.className = 'sc-modal-overlay';
    overlay.innerHTML = `
      <div class="sc-modal" role="alertdialog" aria-modal="true" aria-labelledby="sc-modal-title" aria-describedby="sc-modal-msg">
        <h2 class="sc-modal-title" id="sc-modal-title"></h2>
        <p class="sc-modal-msg" id="sc-modal-msg"></p>
        <div class="sc-modal-actions">
          <button type="button" class="btn sc-modal-cancel"></button>
          <button type="button" class="btn btn-danger sc-modal-confirm"></button>
        </div>
      </div>`;
    const q = <T extends HTMLElement>(sel: string): T => overlay.querySelector(sel) as T;
    q('#sc-modal-title').textContent = opts.title;
    q('#sc-modal-msg').textContent = opts.message;
    const cancelBtn = q<HTMLButtonElement>('.sc-modal-cancel');
    const confirmBtn = q<HTMLButtonElement>('.sc-modal-confirm');
    cancelBtn.textContent = opts.cancelLabel;
    confirmBtn.textContent = opts.confirmLabel;

    const close = (result: boolean): void => {
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      resolve(result);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close(false);
      }
    };
    document.addEventListener('keydown', onKey, true);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(false);
    });
    cancelBtn.addEventListener('click', () => close(false));
    confirmBtn.addEventListener('click', () => close(true));

    document.body.appendChild(overlay);
    // Focus the SAFE default (cancel), so a stray Enter doesn't discard work.
    cancelBtn.focus();
  });
}

/**
 * Guard a "back" navigation. When leaving the view would forfeit in-flight work,
 * ask first via the SCC overlay; otherwise navigate straight away. `risk` is the
 * caller's judgement of whether anything is actually at stake.
 */
async function confirmLeave(risk: boolean, messageKey: string, fallbackMsg: string): Promise<boolean> {
  if (!risk) return true;
  return confirmDiscard({
    title: t('confirm.leave.title', {}) || 'Fortschritt verwerfen?',
    message: t(messageKey, {}) || fallbackMsg,
    confirmLabel: t('confirm.leave.confirm', {}) || 'Verwerfen & zurück',
    cancelLabel: t('confirm.leave.cancel', {}) || 'Weiter hier bleiben',
  });
}

async function doPauseUpload(): Promise<void> {
  // Feedback FIRST, before awaiting the IPC. A pause can only take effect at the
  // next safe boundary, so the button has to say "heard you" immediately —
  // otherwise the operator clicks it, sees a card that keeps ticking, and
  // concludes it is broken.
  const btn = $('#btn-pause-upload') as HTMLButtonElement | null;
  if (btn) {
    btn.disabled = true;
    btn.textContent = tOr('upload.job.pausingShort', 'Pausiere…');
  }
  const pausing = tOr('upload.job.pausing', 'Pausiere nach dem aktuellen Schritt…');
  setAuthStatus(pausing, 'warn');
  // Also on the progress card: that is where the operator's eyes are while a
  // long stage runs, and it is the surface that otherwise keeps counting up.
  uploadProgress?.update({ hint: pausing });
  state.resumableJob = await window.sc.uploadJob.pause();
}

/**
 * Make sure the upload flow has an extraction result to drive. `state.lastResult`
 * is only ever set by a finished extraction, so after the app was closed (or
 * updated, or killed) a resume had none — and `doStartUpload` returned before
 * doing anything, leaving the operator with a "Fortsetzen" button that did
 * nothing. Rebuild it from the durable job instead; when the extract itself is
 * gone, say so, because that is the one case a resume cannot recover from.
 */
async function ensureResultForResume(): Promise<boolean> {
  if (state.lastResult) return true;
  const r = await window.sc.uploadJob.rehydrate();
  if (r.ok) {
    state.lastResult = r.result;
    return true;
  }
  if (r.error === 'no_job') return false;
  setAuthStatus(
    tOr(
      'upload.job.resumeLost',
      'Der Upload kann nicht fortgesetzt werden — die extrahierten Daten sind nicht mehr vorhanden.',
    ),
    'error',
    {
      hint: tOr(
        'upload.job.resumeLostHint',
        'Bitte den Upload verwerfen und die Extraktion erneut ausführen.',
      ),
      detail: r.error,
    },
  );
  return false;
}

async function doResumeUpload(): Promise<void> {
  if (!(await ensureResultForResume())) return;
  await window.sc.uploadJob.resume();
  setAuthStatus(t('upload.job.resumed', {}) || 'Upload wird fortgesetzt…', 'ok');
  await doStartUpload();
}

async function doDiscardUpload(): Promise<void> {
  state.resumableJob = await window.sc.uploadJob.cancel();
  state.uploadPaused = false;
  setAuthStatus(t('upload.job.cancelled', {}) || 'Upload verworfen — der Fortschritt wurde gelöscht.', 'warn');
  paintJobNotice();
}

// Show/hide the "your login expired — reconnect first" hint on the upload view,
// reflecting the current connection status. Safe to call when the view isn't
// mounted (the element lookup simply misses).
function paintReconnectNotice(): void {
  const el = $('#reconnect-notice');
  if (!el) return;
  const needsReconnect = conn.status ? !conn.status.connected : false;
  if (needsReconnect) {
    const msg = conn.status?.needsReconnect
      ? t('upload.reconnectExpired', {}) || 'Deine Sitzung ist abgelaufen — melde dich beim Upload-Start neu an.'
      : t('upload.reconnectOffline', {}) || 'Nicht mit dem Web verbunden — der Upload-Start meldet dich an.';
    el.textContent = msg;
    el.style.display = 'block';
  } else {
    el.style.display = 'none';
  }
}

// One-shot flow: trigger browser login if needed, then immediately upload.
// Keeps the loopback OAuth server open only for the few seconds between
// "open browser" and "fetch back the token" — no idle window where the
// user could close the tool and break the handoff.
async function doStartUpload(): Promise<void> {
  if (!state.lastResult) return;
  const btn = $('#btn-start-upload') as HTMLButtonElement | null;
  if (btn) btn.disabled = true;
  uploadRunning = true;
  // Fresh attempt: drop any stale status/diff from a previous attempt so a landed
  // bundle's "first upload" message can't coexist with a new "duplicate" error.
  clearUploadFeedback();
  lastCatalogFailure = null;
  paintJobNotice();
  uploadProgress?.start();
  uploadProgress?.setStep(0);
  try {
    if (!state.authToken) {
      uploadProgress?.update({
        phaseLabel: t('upload.signingIn', {}) || 'Im Browser anmelden…',
        indeterminate: true,
        detail: '',
      });
      const token = await ensureUploadToken();
      if (!token) {
        uploadProgress?.update({ indeterminate: false });
        uploadProgress?.stop();
        setAuthStatus(t('upload.signInFailed', {}) || 'Anmeldung fehlgeschlagen', 'error');
        return;
      }
    }
    await doUploadAfterAuth();
  } finally {
    if (btn) btn.disabled = false;
    uploadRunning = false;
    // Re-read the durable job: it decides whether we now offer Resume (paused
    // or interrupted) or nothing at all (finished).
    await refreshJobView();
  }
}

// Server-side error codes the ingest-bundle edge function can return. Anything
// NOT in this set is a transport-layer message (network down, timeout, …).
const KNOWN_UPLOAD_ERRORS = new Set([
  'unauthorized', 'forbidden', 'missing_release_token', 'unknown_release_token',
  'release_token_revoked', 'duplicate', 'ingest_failed', 'invalid_body',
  'invalid_json', 'server_misconfigured', 'method_not_allowed',
]);

// Turn a raw upload failure (server error code + optional server `message`, or
// a network/timeout message) into a sentence a non-technical operator can act
// on, while still surfacing the technical detail for support.
function friendlyUploadError(r: { error?: string; details?: unknown }): string {
  const code = r.error ?? 'unknown';
  const serverMsg =
    r.details && typeof r.details === 'object'
      ? (r.details as { message?: unknown }).message
      : undefined;

  let friendly: string;
  switch (code) {
    case 'unauthorized':
      friendly = t('upload.err.unauthorized'); break;
    case 'forbidden':
      friendly = t('upload.err.forbidden'); break;
    case 'missing_release_token':
    case 'unknown_release_token':
    case 'release_token_revoked':
      friendly = t('upload.err.releaseToken'); break;
    case 'duplicate':
      friendly = t('upload.err.duplicate'); break;
    case 'ingest_failed':
      friendly = t('upload.err.ingestFailed'); break;
    case 'invalid_body':
    case 'invalid_json':
      friendly = t('upload.err.invalidBody'); break;
    case 'server_misconfigured':
      friendly = t('upload.err.serverMisconfigured'); break;
    case 'timeout':
      friendly = t('upload.err.timeout'); break;
    default:
      // Unknown code === a raw fetch/timeout message from the transport layer.
      friendly = KNOWN_UPLOAD_ERRORS.has(code) ? t('upload.err.generic') : t('upload.err.network');
  }

  const detail =
    (typeof serverMsg === 'string' && serverMsg) ||
    (KNOWN_UPLOAD_ERRORS.has(code) ? code : r.error);
  return detail && detail !== friendly
    ? t('upload.err.withDetail', { friendly, detail })
    : friendly;
}

async function doUploadAfterAuth(): Promise<void> {
  if (!state.authToken || !state.lastResult) return;
  const result = state.lastResult;
  // Register (or adopt) the durable job BEFORE any network call, so even a kill
  // during the very first request leaves a resumable record behind. Adopting an
  // existing job for the same out_dir is what turns "reopen the app" into
  // "continue where we stopped".
  const job = await window.sc.uploadJob.begin(result.output_dir, {
    channel: result.channel,
    patchVersion: result.patch_version,
    buildNumber: result.build_number,
  });
  // On a resume whose bundle already landed, the bundle POST returns instantly
  // from the main process — so skip the bundle spinner and open the card
  // straight on the catalog stage (macro 2/3), where the work actually resumes,
  // instead of flashing "1/3 · Bundle" then jumping.
  const resumingPastBundle = job?.bundle?.status === 'done';
  uploadProgress?.setStep(resumingPastBundle ? 1 : 0);
  uploadProgress?.update({
    phaseLabel: resumingPastBundle
      ? t('catalog.publishing', {}) || 'Codex wird veröffentlicht'
      : t('upload.bundleUploading', {}) || 'Bundle-Metadaten werden hochgeladen…',
    indeterminate: true,
    detail: '',
  });
  const ch = result.channel as 'LIVE' | 'PTU' | 'EPTU' | 'TECH-PREVIEW';
  const r = await window.sc.upload({
    accessToken: state.authToken,
    channel: ch,
    patchVersion: result.patch_version,
    buildNumber: result.build_number,
    schemaVersion: result.schema_version,
    qualityScore: result.quality_score,
    entityCounts: result.entity_counts,
    manifest: {},
    manifestPath: result.manifest_path,
  });
  if (!r.ok) {
    uploadProgress?.update({ indeterminate: false });
    uploadProgress?.stop();
    setAuthStatus(friendlyUploadError(r), 'error');
    return;
  }
  // Only claim the bundle step as 100% on a fresh run; on a resume the card is
  // already on the catalog stage and promoteToCodex owns the bar from here.
  if (!resumingPastBundle) uploadProgress?.update({ indeterminate: false, overallPct: 100 });
  setAuthStatus(
    `${t('upload.uploadOk', {}) || 'Upload OK'} · bundle_id ${r.bundleId ?? '—'}`,
    'ok',
  );
  paintDiffSummary(r.diffSummary);

  // Promote the extract into the public Codex (codex_* tables) BEFORE cleanup,
  // so the out_dir still exists. Non-fatal: the bundle upload already succeeded;
  // a codex failure only means the public catalog isn't refreshed this run.
  uploadProgress?.setStep(1);
  const codex = await promoteToCodex(result.output_dir, uploadProgress);
  // Stop the whole run on a pause. Falling through would upload skins and —
  // worse — reach the cleanup below, deleting the out_dir that a resume needs.
  if (codex === 'paused') {
    setAuthStatus(tOr('upload.job.paused', 'Upload pausiert — der Fortschritt ist gespeichert.'), 'warn');
    return;
  }

  // Build + upload the 3D liveries as part of the SAME upload — skins are a
  // sub-property of every ship, not a separate step. Reads the extract's build
  // manifest, cached per patch version. Runs BEFORE cleanup (manifest lives in
  // out_dir). Fully non-fatal: the bundle is already confirmed.
  uploadProgress?.setStep(2);
  try {
    await buildAndUploadSkins(result, uploadProgress);
  } catch (err) {
    uploadProgress?.update({ indeterminate: false });
    setAuthStatus(
      `${t('skins.buildFailed', {}) || '3D-Skins übersprungen (Bundle ist hochgeladen)'}: ${(err as Error).message}`,
      'warn',
    );
  }
  uploadProgress?.stop();

  // Paused during the skin stage — same reasoning as the codex stage above:
  // never clean up an out_dir a resume still needs.
  const jobAfterSkins = await window.sc.uploadJob.get();
  if (jobAfterSkins.state?.status === 'paused') {
    setAuthStatus(t('upload.job.paused', {}) || 'Upload pausiert — der Fortschritt ist gespeichert.', 'warn');
    return;
  }

  // A failed codex stage is NOT "every stage confirmed". Falling through here
  // used to delete the job file and then purge the out_dir, so a single
  // transient database timeout silently destroyed both the catalog progress and
  // the extract needed to retry it — turning a 30-second retry into a full
  // re-extraction. Keep the job resumable and stop; the message from
  // `promoteToCodex` already tells the operator to continue.
  if (codex === 'failed') {
    // The skin stage's own status line has since overwritten ours — put the
    // thing the operator actually has to act on back on screen.
    paintCatalogFailure();
    await window.sc.uploadJob.fail('catalog_failed');
    await refreshJobView();
    return;
  }

  // Every stage confirmed — drop the job file so the next launch doesn't offer
  // to resume an upload that already finished.
  await window.sc.uploadJob.finish();

  // Upload confirmed — reclaim the run's extracted files so they don't fill
  // the disk. Best-effort: the main process guards + swallows failures.
  const outDir = state.lastResult?.output_dir;
  if (outDir) {
    const cleaned = await window.sc.cleanup.extractDir(outDir, {
      bundleId: r.bundleId,
      channel: result.channel,
      version: result.patch_version,
    });
    if (cleaned.ok) {
      // A skin stage that lost ships must not be papered over by "Upload OK":
      // the bundle IS confirmed, but the operator still has to act on the
      // failed liveries, so that verdict stays on screen — as a warning.
      const skinsWarn = state.skinUploadStatus;
      setAuthStatus(
        `${t('upload.uploadOk', {}) || 'Upload OK'} · bundle_id ${r.bundleId ?? '—'} · ` +
          (t('upload.cleaned', {}) || 'Extrahierte Dateien aufgeräumt (Upload bestätigt)') +
          (skinsWarn ? ` · ${skinsWarn}` : ''),
        skinsWarn ? 'warn' : 'ok',
      );
    }
  }

  // Every stage confirmed and cleaned up — hand off to the Done step, which
  // owns the summary and (when armed) the shutdown/quit countdown.
  state.view = 'done';
  render();
  await maybeShutdownAfterUpload();
  await maybeQuitAfterUpload();
}

/**
 * The second half of "close yourself when you are done" (feedback 71b1e402):
 * the unattended launch had work, did it, and now goes away again.
 *
 * Skipped when a shutdown is already scheduled — that path paints a 60-second
 * cancel button, and quitting the app would take the cancel button with it.
 */
async function maybeQuitAfterUpload(): Promise<void> {
  // Reads the per-run choice for a manual run and `settings.afterAutoRun`
  // (mapped by `buildRunPlan`) for an unattended one — one field, one path.
  if (state.runPlan?.whenDone !== 'quit') return;
  await window.sc.system.quit();
}

/**
 * Turn a catalog-stage failure into an operator-readable notice.
 *
 * `errorCode` is the coarse class `catalog-bridge` assigns; `error` stays the
 * raw technical text and is only ever shown folded away. The hint is the piece
 * that was missing entirely before: every one of these failures leaves the run
 * resumable, and saying so is the difference between "2 hours wasted" and "hit
 * continue".
 */
function catalogFailureNotice(res: CatalogUploadResult): { msg: string; hint: string; detail: string } {
  const code = res.errorCode ?? 'unknown';
  const msg =
    code === 'timeout'
      ? tOr(
          'catalog.err.timeout',
          'Die Datenbank hat einen Schreibvorgang abgebrochen (Zeitlimit) — der Codex ist unverändert geblieben.',
        )
      : code === 'network'
        ? tOr('catalog.err.network', 'Der Server war nicht erreichbar — der Codex ist unverändert geblieben.')
        : code === 'unauthorized'
          ? tOr('catalog.err.unauthorized', 'Deine Sitzung ist abgelaufen — der Codex wurde nicht aktualisiert.')
          : code === 'forbidden'
            ? tOr('catalog.err.forbidden', 'Deinem Konto fehlt die Berechtigung, den Codex zu aktualisieren.')
            : code === 'empty_catalog'
              ? tOr(
                  'catalog.err.empty',
                  'Die Extraktion enthält keine Schiffe oder Hersteller — der bisherige Codex bleibt aktiv.',
                )
              : code === 'out_dir_missing' || code === 'manifest_missing'
                ? tOr('catalog.err.missingData', 'Die extrahierten Daten sind nicht mehr vorhanden.')
                : tOr('catalog.err.server', 'Der Server konnte den Codex nicht aktualisieren.');

  // Only the classes a retry can actually fix get the "continue" promise.
  const resumable = code !== 'empty_catalog' && code !== 'out_dir_missing' && code !== 'manifest_missing';
  const hint = resumable
    ? tOr(
        'catalog.err.resumeHint',
        'Nichts ist verloren — der Fortschritt ist gespeichert. „Upload fortsetzen“ macht genau an dieser Stelle weiter.',
      )
    : tOr('catalog.err.reextractHint', 'Bitte die Extraktion erneut ausführen.');

  const where = res.errorPhase
    ? tOr('catalog.err.atPhase', `Abgebrochen bei: ${res.errorPhase}`, { phase: res.errorPhase })
    : '';
  const detail = [where, res.error].filter(Boolean).join(' · ');
  return { msg, hint, detail };
}

/**
 * The last codex failure of this run, so it can be re-asserted after the skin
 * stage. Skins run on regardless (the bundle already landed), and their own
 * success line would otherwise overwrite the codex error — leaving the operator
 * with a cheerful "3D-Skins fertig" and no idea the catalog never updated.
 */
let lastCatalogFailure: { msg: string; hint: string; detail: string } | null = null;

function paintCatalogFailure(): void {
  if (!lastCatalogFailure) return;
  setAuthStatus(
    `${tOr('catalog.failed', 'Codex-Veröffentlichung fehlgeschlagen')} — ${lastCatalogFailure.msg}`,
    'error',
    { hint: lastCatalogFailure.hint, detail: lastCatalogFailure.detail },
  );
}

// Drive the codex promotion with a live per-table progress line. Non-fatal:
// any failure is surfaced as a warning but never blocks the confirmed upload.
// `progress` is optional so this stays callable without a mounted view (tests).
async function promoteToCodex(
  outDir: string | undefined,
  progress?: ProgressController | null,
): Promise<'ok' | 'failed' | 'paused'> {
  if (!outDir || !state.authToken) return 'failed';
  const label = t('catalog.publishing', {}) || 'Codex wird veröffentlicht';
  progress?.update({ phaseLabel: label, indeterminate: true, detail: '' });
  const unsub = window.sc.catalog.onEvent((ev) => {
    // phaseIndex/phaseTotal are additive fields (catalog-bridge.ts) — an
    // overall two-tier bar: which of the ~14 fixed publish steps we're on,
    // refined by how far the CURRENT step's own current/total has gotten.
    const stepFrac = ev.total > 0 ? ev.current / ev.total : 0;
    const overallPct =
      typeof ev.phaseIndex === 'number' && typeof ev.phaseTotal === 'number' && ev.phaseTotal > 0
        ? Math.round(((ev.phaseIndex - 1 + stepFrac) / ev.phaseTotal) * 100)
        : undefined;
    const stageLbl =
      typeof ev.phaseIndex === 'number' && typeof ev.phaseTotal === 'number'
        ? t('catalog.step', { current: String(ev.phaseIndex), total: String(ev.phaseTotal) }) ||
          `Step ${ev.phaseIndex}/${ev.phaseTotal}`
        : undefined;
    progress?.update({
      phaseLabel: label,
      stageLabel: stageLbl,
      current: ev.current,
      total: ev.total > 0 ? ev.total : undefined,
      overallPct,
      detail: ev.phase,
      indeterminate: false,
    });
  });
  try {
    const res = await window.sc.catalog.upload(state.authToken, outDir);
    if (res.ok) {
      const ships = res.counts?.['ships'] ?? 0;
      progress?.update({ overallPct: 100, indeterminate: false });
      setAuthStatus(
        `${t('catalog.published', {}) || 'Codex aktualisiert'} · ${ships} ${t('catalog.ships', {}) || 'Schiffe'}`,
        'ok',
      );
      return 'ok';
    }
    // A pause is not a failure — the cursor is safe on disk and the operator
    // asked for this. Say so instead of showing a red "publish failed".
    if (res.error === 'paused' || res.error === 'cancelled') {
      progress?.update({ indeterminate: false });
      progress?.stop();
      return 'paused';
    }
    progress?.update({ indeterminate: false });
    lastCatalogFailure = catalogFailureNotice(res);
    paintCatalogFailure();
    return 'failed';
  } catch (err) {
    progress?.update({ indeterminate: false });
    lastCatalogFailure = catalogFailureNotice({ ok: false, error: (err as Error).message, errorCode: 'unknown' });
    paintCatalogFailure();
    return 'failed';
  } finally {
    unsub();
  }
}

function paintDiffSummary(diff: unknown): void {
  const mount = $('#upload-result');
  if (!mount) return;
  if (!diff) {
    mount.innerHTML = '<p class="ok">Erster Upload für diese Patch-Familie — kein Diff zur Anzeige.</p>';
    return;
  }
  // Server shape (diff_bundle in migration 00005, ingest_bundle_atomic in
  // 00006): { prev_id, new_id, count_diffs: { <entity>: {prev, new, delta} },
  // summary: { entities_added, entities_removed } }
  const d = diff as {
    count_diffs?: Record<string, { prev: number; new: number; delta: number }>;
    summary?: { entities_added: number; entities_removed: number };
  };
  const totalAdded = d.summary?.entities_added ?? 0;
  const totalRemoved = d.summary?.entities_removed ?? 0;
  const rows = d.count_diffs
    ? Object.entries(d.count_diffs)
        .filter(([, v]) => v.delta !== 0)
        .sort(([, a], [, b]) => Math.abs(b.delta) - Math.abs(a.delta))
        .map(
          ([key, v]) => {
            const deltaCls = v.delta > 0 ? 'ok' : v.delta < 0 ? 'error' : '';
            const sign = v.delta > 0 ? '+' : '';
            return `<tr><td>${key}</td><td>${v.prev}</td><td>${v.new}</td><td class="${deltaCls}">${sign}${v.delta}</td></tr>`;
          },
        )
        .join('')
    : '';
  mount.innerHTML = `
    <h3>Diff vs. previous bundle</h3>
    <p>Σ <span class="ok">+${totalAdded.toLocaleString()}</span>
       / <span class="error">−${totalRemoved.toLocaleString()}</span></p>
    <div class="diff-scroll">
      <table class="diff-table">
        <thead><tr><th>entity</th><th>prev</th><th>new</th><th>delta</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="4"><em>no entity changes</em></td></tr>'}</tbody>
      </table>
    </div>
  `;
}

interface StatusExtras {
  /** What the operator should DO next — the part a raw error never answers. */
  hint?: string;
  /** Raw server/transport text, folded away so support can still read it. */
  detail?: string;
}

/**
 * The upload view's single status surface.
 *
 * It used to be one line of whatever string the failing stage happened to hold,
 * which is how an operator ended up staring at
 * `Codex-Veröffentlichung fehlgeschlagen: upsert → HTTP 500 ingest_failed
 * canceling statement due to statement timeout` — every word true, none of it
 * usable, and it hid the only fact that mattered (nothing was lost). So a
 * status is now three separable things: what happened, what to do about it, and
 * the technical text, collapsed.
 */
function setAuthStatus(msg: string, cls: 'ok' | 'warn' | 'error', extras: StatusExtras = {}): void {
  const el = $('#auth-status');
  if (!el) return;
  if (!msg) {
    el.innerHTML = '';
    el.hidden = true;
    el.className = 'upload-status';
    return;
  }
  const hint = extras.hint
    ? `<p class="upload-status-hint">${escapeHtml(extras.hint)}</p>`
    : '';
  const detail = extras.detail
    ? `<details class="upload-status-details"><summary>${escapeHtml(
        tOr('upload.technicalDetails', 'Technische Details'),
      )}</summary><code>${escapeHtml(extras.detail)}</code></details>`
    : '';
  el.innerHTML = `<p class="upload-status-msg">${escapeHtml(msg)}</p>${hint}${detail}`;
  el.className = `upload-status ${cls}`;
  el.hidden = false;
}

// The status line (#auth-status) and the diff/first-upload panel (#upload-result)
// are independent DOM regions. Nothing cleared them between attempts, so a green
// "first upload — no diff" from a landed bundle could linger UNDER a red
// "duplicate" error from a later re-attempt (resume / re-click / auto-run) —
// two contradictory messages at once. Wipe both at the start of every attempt so
// error and success are always mutually exclusive.
function clearUploadFeedback(): void {
  const status = $('#auth-status');
  if (status) {
    status.innerHTML = '';
    status.className = 'upload-status';
    status.hidden = true;
  }
  const result = $('#upload-result');
  if (result) result.innerHTML = '';
}

// After a fully-confirmed upload, honour the operator's "shut down when done"
// per-run choice (manual) / `afterAutoRun` (unattended), both folded into
// `state.runPlan.whenDone` by `buildRunPlan`. The OS gets a 60 s countdown
// (cancelable via the button we paint here or the native dialog), so an
// accidental tick or a "wait, one more thing" is always recoverable.
export const SHUTDOWN_DELAY_SECS = 60;
export async function maybeShutdownAfterUpload(): Promise<void> {
  if (state.runPlan?.whenDone !== 'shutdown') return;
  const notice = $('#done-shutdown-notice');
  const res = await window.sc.system.shutdown(SHUTDOWN_DELAY_SECS);
  if (!notice) return;
  if (!res.ok) {
    notice.textContent = t('upload.shutdownFailed') + (res.error ? `: ${res.error}` : '');
    notice.style.display = 'block';
    return;
  }
  notice.innerHTML = `
    <span>${t('upload.shutdownScheduled', { secs: String(SHUTDOWN_DELAY_SECS) })}</span>
    <button id="btn-abort-shutdown" class="btn">${t('upload.shutdownCancel')}</button>
  `;
  notice.style.display = 'flex';
  $('#btn-abort-shutdown')?.addEventListener('click', () => {
    void window.sc.system.abortShutdown().then((r) => {
      notice.textContent = r.ok
        ? t('upload.shutdownCancelled')
        : t('upload.shutdownAbortFailed');
      notice.style.display = 'block';
    });
  });
}

// ============= 3D liveries (built + uploaded inside the normal upload) =======

// Build + upload every ship's 3D liveries as part of the confirmed bundle
// upload — skins are a sub-property of each ship, not a separate view. Driven
// by the extract's skins/_build_manifest.json and cached per patch version:
// the first run of a patch is long (builds all glbs), re-runs skip ships that
// are already built + uploaded. Entirely non-fatal — the bundle upload has
// already succeeded, so any skin failure only means liveries aren't refreshed.
/** True once the operator asked to pause/cancel — checked at stage boundaries. */
async function pauseRequested(): Promise<boolean> {
  try {
    return (await window.sc.uploadJob.get()).signal !== 'running';
  } catch {
    return false;
  }
}

async function buildAndUploadSkins(
  result: ExtractResultPayload,
  progress?: ProgressController | null,
): Promise<void> {
  state.skinUploadStatus = null;
  if (!state.authToken) return;
  const ch = state.channels.find((c) => c.selected) ?? state.channels[0];
  if (!ch) return;

  const manifest = `${result.output_dir}/skins/_build_manifest.json`;
  const skinsOut = `${ch.installPath}/.sc-companion-extracts/skins-${result.patch_version}`;
  const label = t('skins.building', {}) || '3D-Skins werden gebaut';

  // 1. ensure cgf-converter (first-use download ~117 MB).
  const toolsLabel = t('skins.stepTools', {}) || 'Build-Tools werden geladen';
  progress?.update({ phaseLabel: toolsLabel, indeterminate: true, detail: '' });
  const unsubTools = window.sc.skin.onToolProgress((pct) =>
    progress?.update({ phaseLabel: toolsLabel, current: pct, total: 100, overallPct: pct, indeterminate: false }),
  );
  const tools = await window.sc.skin.ensureTools();
  unsubTools();
  // The tool download is a single long fetch with no checkpoint of its own, so
  // honour a pause that arrived while it ran instead of starting a multi-hour
  // build the operator just asked us to stop.
  if (await pauseRequested()) return;
  if (!tools.ok) {
    progress?.update({ indeterminate: false });
    setAuthStatus(
      `${t('skins.toolsFailed', {}) || '3D-Tools nicht verfügbar — Skins übersprungen'}: ${tools.error ?? '—'}`,
      'warn',
    );
    return;
  }

  // 2. build glbs (streams; first run per patch is long, cached runs are quick).
  // Reads ev.pct (phase events) AND ev.current/ev.total (ships progress
  // events, see skin_export_app.py) so the card shows "ship X / Y" plus a
  // moving overall bar instead of just a static phase word.
  progress?.update({
    phaseLabel: label,
    indeterminate: true,
    detail: '',
    hint: t('skins.hintBuild', {}) || 'Erst-Build baut jedes Schiff einzeln — kann pro Schiff einige Minuten dauern.',
  });
  const skinCounters: Record<string, number> = {};
  const unsub = window.sc.skin.onEvent((ev) => {
    if (ev.type === 'phase' && ev.phase) {
      progress?.update({ phaseLabel: `${label}: ${ev.phase}`, overallPct: ev.pct });
    } else if (ev.type === 'progress') {
      progress?.update({
        stageLabel:
          t('skins.shipProgress', { current: String(ev.current ?? 0), total: String(ev.total ?? 0) }) ||
          `Ship ${ev.current}/${ev.total}`,
        current: ev.current,
        total: ev.total,
        overallPct: ev.pct,
        detail: ev.detail,
      });
    } else if (ev.type === 'count' && ev.counter) {
      skinCounters[ev.counter.key] = ev.counter.value;
      progress?.update({ counters: skinCounters });
    } else if (ev.type === 'log' && ev.level === 'error') {
      progress?.update({ detail: ev.message ?? '' });
    }
  });
  const built = await window.sc.skin
    .start({ p4kPath: ch.dataP4kPath, outDir: skinsOut, manifest, skipExisting: true })
    .finally(unsub);
  // `paused` / `cancelled` come back when the operator stopped the build (main
  // kills the Python child on pause — see `interruptLocalSkinBuild`). That is
  // control flow, not a failure: the caller reads the job state and reports it.
  if (!built.ok && (built.error === 'paused' || built.error === 'cancelled')) {
    progress?.update({ indeterminate: false });
    progress?.stop();
    return;
  }
  if (!built.ok || !built.ships) {
    progress?.update({ indeterminate: false });
    setAuthStatus(
      tOr('skins.buildFailed', '3D-Skins-Build fehlgeschlagen (Bundle ist hochgeladen)'),
      'warn',
      { detail: built.error ?? undefined },
    );
    return;
  }
  state.skinResult = built.ships;
  if (built.ships.length === 0) {
    progress?.update({ indeterminate: false });
    setAuthStatus(t('skins.none', {}) || 'Keine baubaren 3D-Skins gefunden.', 'ok');
    return;
  }

  // 3. upload (upload-cache skips ships already shipped in a prior run).
  // Determinate from the first frame: main streams a `progress` event per ship
  // (see skin-ingest `onProgress`). Without it this stage was a single opaque
  // await — the card kept the build stage's numbers, the bar never moved, and a
  // finished run was indistinguishable from a hung one.
  const uploadLabel = tOr('skins.stepUpload', 'Liveries werden hochgeladen');
  progress?.update({
    phaseLabel: uploadLabel,
    indeterminate: false,
    current: 0,
    total: built.ships.length,
    overallPct: 0,
    detail: '',
    hint: tOr('skins.hintUpload', 'Große Livery-Dateien werden übertragen — je nach Größe dauert das.'),
  });
  const unsubUpload = window.sc.skin.onEvent((ev) => {
    if (ev.type === 'progress') {
      const total = ev.total ?? built.ships.length;
      progress?.update({
        current: ev.current,
        total,
        overallPct: total > 0 ? ((ev.current ?? 0) / total) * 100 : undefined,
        detail: ev.detail ?? '',
      });
    } else if (ev.type === 'log' && (ev.level === 'warn' || ev.level === 'error')) {
      progress?.update({ detail: ev.message ?? '' });
    }
  });
  const results = await window.sc.skin
    .upload(
      state.authToken,
      built.ships.map((s) => ({ shipId: s.ship_id, dir: s.export_dir })),
    )
    .finally(unsubUpload);
  // One tally feeds the card AND the status line (lib/skin-upload-summary):
  // `current / total` is live / attempted, the percentage is that same
  // fraction, and skipped (no livery model) or failed ships are named in the
  // detail line. The old frame painted live over ships.length with a
  // hard-coded 100 % — "251 / 276 (100 %)" — and the status line that
  // explained the gap was overwritten by the cleanup message moments later.
  const tally = tallySkinUpload(results);
  // Repaint into a terminal state BEFORE the caller stops the clock: the card
  // freezes on whatever this last frame says, so it must not still read
  // "uploading" with a phantom ETA.
  progress?.update({
    ...skinUploadFrame(tally, t),
    indeterminate: false,
    hint: '',
  });
  const status = skinUploadStatus(tally, t);
  state.skinUploadStatus = status.level === 'warn' ? status.message : null;
  setAuthStatus(status.message, status.level);
}

void init();
