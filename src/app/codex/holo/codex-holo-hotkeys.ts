// Holodeck letter hotkeys (#644). One letter per action of the table's tool
// row and its top bar — the key is the first letter of the English word, and
// the trigger shows it as a discreet <kbd> (hidden on touch).
//
// Coexistence with the Codex type-to-search (`isTypeToSearchKey`, quick-search
// component): on the holodeck these four letters belong to the holodeck when
// no text field is focused. The stage listens in the CAPTURE phase and calls
// preventDefault(); type-to-search ignores a defaultPrevented key. Every other
// letter still starts a search, digits stay the pin keys (1–9, 0 = 10), Esc
// stays "close". Typing inside the search field (or any input) never reaches
// the holodeck: an editable target is ignored here.
import { isEditableTarget } from '../search/codex-search-hub.service';

export type HoloHotkeyAction = 'copyLink' | 'patch' | 'view' | 'share';

/** action → key (lower case). The kbd badges and aria-keyshortcuts read this. */
export const HOLO_HOTKEYS: Readonly<Record<HoloHotkeyAction, string>> = {
  copyLink: 'l',
  patch: 'p',
  view: 'v',
  share: 's',
};

const BY_KEY = new Map<string, HoloHotkeyAction>(
  (Object.entries(HOLO_HOTKEYS) as [HoloHotkeyAction, string][]).map(([action, key]) => [key, action]),
);

/** The badge text for an action ("L"). */
export function holoHotkeyLabel(action: HoloHotkeyAction): string {
  return HOLO_HOTKEYS[action].toUpperCase();
}

/**
 * The holodeck action a key event asks for, or null when it is not one of
 * ours or must be left alone: a chord (Ctrl/⌘/Alt), IME composition, a key
 * typed into a text field / select / contenteditable, or any open dialog
 * that is not the stage's own popover (`ownRoot` — the patch chooser is a
 * `role="dialog"` inside the stage and must still close with its key).
 */
export function holoHotkeyFor(ev: KeyboardEvent, ownRoot: Element | null): HoloHotkeyAction | null {
  if (ev.defaultPrevented || ev.isComposing) return null;
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return null;
  if (ev.key.length !== 1) return null;
  const action = BY_KEY.get(ev.key.toLowerCase());
  if (!action) return null;
  if (isEditableTarget(ev.target)) return null;
  if (typeof document !== 'undefined') {
    const dialogs = document.querySelectorAll('[role="dialog"], dialog[open], [aria-modal="true"]');
    for (const d of Array.from(dialogs)) {
      if (!ownRoot || !ownRoot.contains(d)) return null;
    }
  }
  return action;
}

export type HoloViewMode = 'holo' | '3d' | 'schema';

/** V: holo → 3D → schema → holo, skipping a view the hull cannot show. */
export function nextHoloView(current: HoloViewMode, has3d: boolean, schema: boolean): HoloViewMode {
  const order: HoloViewMode[] = ['holo', ...(has3d ? (['3d'] as const) : []), ...(schema ? (['schema'] as const) : [])];
  const at = order.indexOf(current);
  return order[(at + 1) % order.length] ?? 'holo';
}
