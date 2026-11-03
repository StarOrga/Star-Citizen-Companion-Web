/**
 * Install-click state machine for the staged auto-update, kept free of Electron
 * so every state is unit-testable. The main process (updater.ts) owns the
 * mutable state and feeds it in here; the renderer maps the resulting states to
 * banner text via `bannerModel`.
 *
 * Rule: every click answers at once and visibly. Waiting is allowed, silence is
 * not — each state has a banner text, and only `preparing`/`closing` lock the
 * button (they end on their own within seconds).
 */

export type InstallPhase = 'idle' | 'preparing' | 'waiting' | 'closing';

/** What the renderer is told about an install request. */
export type InstallReply = { ok: boolean; state: InstallPhase | 'none' };

export type InstallStep =
  /** Nothing staged — nothing to install. */
  | 'none'
  /** The feed has a newer release than the staged one: fetch that first. */
  | 'refetch'
  /** Work is running: keep the request standing and retry when it ends or pauses. */
  | 'wait'
  /** Show the closing notice, then quit and install. */
  | 'go';

export interface InstallInputs {
  staged: string | null;
  /** The feed's newest version, null while unknown/unreachable. */
  feedVersion: string | null;
  superseded: boolean;
  /** Extraction/skin/silhouette child running, or an upload run in flight. */
  workBusy: boolean;
}

export function nextInstallStep(i: InstallInputs): InstallStep {
  if (!i.staged) return 'none';
  if (i.superseded) return 'refetch';
  if (i.workBusy) return 'wait';
  return 'go';
}

/**
 * What a background event becomes on its way to the banner. The main process is
 * the one owner of "something is staged": a running install request keeps its
 * notice, and a re-check keeps the staged install button.
 */
export function effectiveUpdateEventType(
  type: string,
  phase: InstallPhase,
  staged: string | null,
): 'install-state' | 'downloaded' | 'unchanged' {
  if (!staged) return 'unchanged';
  if (phase !== 'idle' && ['checking', 'not-available', 'downloaded'].includes(type)) return 'install-state';
  if (type === 'checking' || type === 'not-available') return 'downloaded';
  return 'unchanged';
}

/** The install notice stays up this long before the app quits, so it can be read. */
export const CLOSING_NOTICE_MS = 4000;
/** Renderer gives up on the install IPC after this long and re-enables the button. */
export const INSTALL_REPLY_TIMEOUT_MS = 20_000;

export type InstallNoticeState = 'preparing' | 'waiting' | 'closing' | 'failed';

export interface BannerInput {
  /** The raw update event type, or the install notice. */
  type:
    | 'checking'
    | 'not-available'
    | 'manual'
    | 'available'
    | 'progress'
    | 'downloaded'
    | 'error'
    | 'install-state';
  version?: string;
  pct?: number;
  supersedes?: string;
  message?: string;
  state?: InstallNoticeState;
}

export interface BannerModel {
  visible: boolean;
  textKey: string;
  params: Record<string, string>;
  tone: 'normal' | 'error';
  button: null | { labelKey: string; disabled: boolean; action: 'install' | 'cancel' };
}

const HIDDEN: BannerModel = { visible: false, textKey: '', params: {}, tone: 'normal', button: null };

/**
 * Banner for an update event. A 'checking' / 'not-available' that arrives here
 * means nothing is staged: the main process turns them into 'downloaded' otherwise
 * (`effectiveUpdateEventType`).
 */
export function bannerModel(ev: BannerInput): BannerModel {
  const installBtn = { labelKey: 'update.install', disabled: false, action: 'install' as const };
  switch (ev.type) {
    case 'checking':
    case 'not-available':
    case 'manual':
      return HIDDEN;
    case 'available':
      if (ev.supersedes) {
        return {
          visible: true,
          textKey: 'update.supersedes',
          params: { version: ev.version ?? '', old: ev.supersedes },
          tone: 'normal',
          button: null,
        };
      }
      return { visible: true, textKey: 'update.available', params: { version: ev.version ?? '' }, tone: 'normal', button: null };
    case 'progress':
      return { visible: true, textKey: 'update.progress', params: { pct: String(ev.pct ?? 0) }, tone: 'normal', button: null };
    case 'downloaded':
      return {
        visible: true,
        textKey: 'update.downloaded',
        params: { version: ev.version ?? '' },
        tone: 'normal',
        button: installBtn,
      };
    case 'error':
      return { visible: true, textKey: 'update.error', params: { message: ev.message ?? '' }, tone: 'error', button: null };
    case 'install-state': {
      const params = { version: ev.version ?? '' };
      switch (ev.state) {
        case 'preparing':
          return {
            visible: true,
            textKey: 'update.preparing',
            params,
            tone: 'normal',
            button: { labelKey: 'update.installPreparing', disabled: true, action: 'install' },
          };
        case 'waiting':
          return {
            visible: true,
            textKey: 'update.waiting',
            params,
            tone: 'normal',
            button: { labelKey: 'update.installCancel', disabled: false, action: 'cancel' },
          };
        case 'closing':
          return {
            visible: true,
            textKey: 'update.closing',
            params,
            tone: 'normal',
            button: { labelKey: 'update.installClosing', disabled: true, action: 'install' },
          };
        default:
          return { visible: true, textKey: 'update.installFailed', params, tone: 'error', button: installBtn };
      }
    }
  }
}
