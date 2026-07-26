import { Injectable, signal } from '@angular/core';

/** localStorage key holding the Enter-key mapping (`'1'` = send, `'0'` = newline). */
const SEND_ON_ENTER_KEY = 'sc.composer.sendOnEnter';

/**
 * Per-user keyboard preference for every message composer (feedback aa8d5b18).
 *
 * Enter-sends is the chat convention and stays the default, but which key sends
 * is a matter of taste — so it is a setting each user owns instead of a fixed
 * mapping (`Einstellungen → Eingabe`). Two mappings, mirror images of each
 * other; `Ctrl/Cmd+Enter` sends in both so the muscle memory never breaks:
 *
 * | `sendOnEnter` | Enter    | Shift+Enter | Ctrl/Cmd+Enter |
 * |---------------|----------|-------------|----------------|
 * | `true` (default) | send  | new line    | send           |
 * | `false`       | new line | new line    | send           |
 *
 * The choice is persisted **unconditionally**, like `sc.lang` and unlike the
 * opt-in preference category: it stores no personal data, and a setting the
 * user explicitly changed that silently forgets itself on the next reload is
 * simply broken. It is therefore an essential-category functional preference
 * (see `ConsentService`).
 */
@Injectable({ providedIn: 'root' })
export class ComposerPrefsService {
  private readonly sendOnEnterState = signal(readSendOnEnter());

  /** `true` (default) → Enter sends; `false` → Enter inserts a newline. */
  readonly sendOnEnter = this.sendOnEnterState.asReadonly();

  setSendOnEnter(value: boolean): void {
    this.sendOnEnterState.set(value);
    try {
      localStorage.setItem(SEND_ON_ENTER_KEY, value ? '1' : '0');
    } catch {
      /* private mode / quota — the in-memory signal still applies this session */
    }
  }
}

function readSendOnEnter(): boolean {
  if (typeof localStorage === 'undefined') return true;
  try {
    return localStorage.getItem(SEND_ON_ENTER_KEY) !== '0';
  } catch {
    return true;
  }
}
