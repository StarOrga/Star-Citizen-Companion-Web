// Keybinding presentation helpers — pure, framework-free.
// -----------------------------------------------------------------------------
// `codex_keybinds` stores the raw action profile: an action is identified by its
// programmatic key (`v_strafe_up`, `spectate_enterpuremode`, `ui_back`) and
// carries a `@`-key that resolves to a localized name via `codex_locale_strings`.
//
// Reality of the live build (4.x, 1103 actions): only ~62 % of actions resolve to
// an English label and ~55 % to a German one — 753 actions carry a `UILabel`
// key at all, and 67 of those point at keys the shipped `global.ini` does not
// define. The remaining ~38 % therefore have to be *derived* from the raw key,
// and that derivation used to leak the programmatic form verbatim
// ("v ads hold", "spectate enterpuremode").
//
// This module owns that derivation:
//   * the leading token is matched against a data-driven prefix table (built
//     from the actual prefix distribution in `codex_keybinds`),
//   * a prefix that carries CONTEXT (vehicle / spectator / interface / …) is
//     lifted out of the name into a separate context chip instead of being
//     dropped — no information is lost, it just stops polluting the label,
//   * the remainder is un-snake/camel-cased and title-cased.
//
// The raw key is always returned alongside so the UI can keep it discoverable.

/**
 * The context a stripped action-name prefix carries. Rendered as a chip next to
 * the action (or hoisted onto the group header when a whole group shares it),
 * so the prefix's information survives being taken out of the label.
 */
export type KeybindContext =
  | 'vehicle'
  | 'spectator'
  | 'interface'
  | 'interaction'
  | 'emote'
  | 'camera'
  | 'character'
  | 'turret'
  | 'eva'
  | 'hacking'
  | 'remote'
  | 'tractor'
  | 'melee'
  | 'hmd'
  | 'visor'
  | 'headtracking'
  | 'shop'
  | 'debug';

// Leading action-name token → the context it denotes. Derived from the prefix
// distribution of the live build's 1103 actions; every entry here covers a real
// family (counts in comments are "actions whose key starts with this token").
//
// Tokens that are VERBS or NOUNS of the action itself (`toggle_`, `select_`,
// `weapon_`, `jump_`, `zoom_`, `use_`, `pan_`, `mov_`) are deliberately absent —
// stripping them would destroy meaning rather than remove noise.
const CONTEXT_PREFIXES: Record<string, KeybindContext> = {
  v: 'vehicle', // 513 — every in-seat vehicle action
  flymode: 'vehicle', // 5
  ui: 'interface', // 89
  mapui: 'interface', // 19
  flashui: 'interface', // 13
  pc: 'interaction', // 52 — player-choice / conversation
  emote: 'emote', // 40
  view: 'camera', // 32
  flycam: 'camera', // 19
  spectate: 'spectator', // 30
  character: 'character', // 28 — character customizer
  turret: 'turret', // 26
  eva: 'eva', // 23
  zgt: 'eva', // 4 — zero-g traversal
  hacking: 'hacking', // 22
  remote: 'remote', // 17
  tractor: 'tractor', // 12
  melee: 'melee', // 9
  hmd: 'hmd', // 7
  visor: 'visor', // 5
  headtrack: 'headtracking', // 4
  shop: 'shop', // 4
  debug: 'debug', // 4
};

// Tokens that must stay upper-cased in a derived label. Keybinding-specific —
// deliberately separate from the codex stat acronyms so neither list has to
// compromise for the other.
const ACRONYMS = new Set([
  'UI', 'HUD', 'MFD', 'MFDS', 'IFCS', 'VTOL', 'ADS', 'EVA', 'ATC', 'QT', 'QD',
  'SCM', 'FOIP', 'VOIP', 'HMD', 'AR', 'PIP', 'ESP', 'FPS', 'AI', 'ID', 'PU',
  'NAV', 'ETA', 'IR', 'EM', 'CM', 'G',
]);

/** Title-case one already-split word, keeping known acronyms upper-cased. */
function titleCaseToken(word: string): string {
  const up = word.toUpperCase();
  if (ACRONYMS.has(up)) return up;
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * Un-snake/camel-case an engine identifier into spaced, title-cased words —
 * WITHOUT stripping any prefix. `strafe_up` → `Strafe Up`,
 * `useAttachmentTop` → `Use Attachment Top`,
 * `conversation_option1` → `Conversation Option 1`,
 * `IFCS_controls` → `IFCS Controls`.
 *
 * Used directly for actionmap (category) titles, where the leading token is
 * part of the category's identity and must not be lifted out.
 */
export function humanizeKeybindName(raw: string): string {
  return raw
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    .split(/\s+/)
    .filter(Boolean)
    .map(titleCaseToken)
    .join(' ');
}

/** A programmatic action key split into a readable label and its context. */
export interface DerivedActionName {
  /** Human label with the context prefix removed and title-cased. */
  label: string;
  /** Context the removed prefix carried, or null when no prefix was removed. */
  context: KeybindContext | null;
  /** The untouched programmatic key — kept so the UI can still surface it. */
  raw: string;
}

/**
 * Derive a readable action name from a raw keybinding key.
 *
 * Only the FIRST token is considered for stripping, and only when it is a known
 * context family AND something is left over: `v_view_yaw_absolute` becomes
 * "View Yaw Absolute" + `vehicle` (not "Yaw Absolute" + `camera`), and a bare
 * `v` stays `V` rather than collapsing to an empty label.
 */
export function deriveActionName(actionName: string | null | undefined): DerivedActionName {
  const raw = (actionName ?? '').trim();
  if (!raw) return { label: '', context: null, raw: '' };

  const sep = raw.indexOf('_');
  if (sep > 0) {
    const head = raw.slice(0, sep).toLowerCase();
    const rest = raw.slice(sep + 1);
    const context = CONTEXT_PREFIXES[head];
    if (context && rest) {
      return { label: humanizeKeybindName(rest) || rest, context, raw };
    }
  }
  return { label: humanizeKeybindName(raw) || raw, context: null, raw };
}

/** Where a rendered keybinding label came from. */
export type KeybindLabelSource = 'localized' | 'english' | 'derived';

export interface KeybindLabelInput {
  actionName: string;
  /** Localized value for the active UI language (already looked up), if any. */
  localized?: string | null;
  /** English value for the same key — the fallback before we derive. */
  english?: string | null;
}

export interface KeybindLabel {
  text: string;
  source: KeybindLabelSource;
  context: KeybindContext | null;
  raw: string;
}

/**
 * A display value is usable when it is non-empty and not an unresolved
 * global.ini key (the extractor stores `@`-keys verbatim, and `gettext` echoes
 * the key back when a language has no entry for it).
 */
function usable(v: string | null | undefined): string | null {
  const s = (v ?? '').trim();
  if (!s || s.startsWith('@')) return null;
  // A "translation" that is itself an engine id (`v_toggle_guns_mode`) is a
  // raw key echoed back, not a name — derive instead (audit L18).
  if (/^[a-z0-9]+(?:_[a-z0-9]+)+$/i.test(s)) return null;
  return s;
}

/**
 * Resolve the label to show for one action: the active language's translation
 * first, then the English original (the canonical source string — better a
 * readable foreign name than a programmatic key), then a derived name.
 *
 * The context chip is derived from the raw key in ALL cases, so grouping stays
 * consistent whether or not a translation happened to exist.
 */
export function resolveKeybindLabel(input: KeybindLabelInput): KeybindLabel {
  const derived = deriveActionName(input.actionName);
  const localized = usable(input.localized);
  if (localized) {
    return { text: localized, source: 'localized', context: derived.context, raw: derived.raw };
  }
  const english = usable(input.english);
  if (english) {
    return { text: english, source: 'english', context: derived.context, raw: derived.raw };
  }
  return { text: derived.label, source: 'derived', context: derived.context, raw: derived.raw };
}

/**
 * The context a whole group can display on its header instead of repeating a
 * chip on every row: the single context shared by EVERY row. Returns null as
 * soon as one row has a different context or none at all — hoisting then would
 * over-claim, so those groups keep per-row chips.
 */
export function sharedContext(
  contexts: readonly (KeybindContext | null)[],
): KeybindContext | null {
  if (contexts.length === 0) return null;
  const first = contexts[0];
  if (!first) return null;
  return contexts.every((c) => c === first) ? first : null;
}

// ── key tokens ───────────────────────────────────────────────────────────────

/** Modifier tokens, in the order a combo reads them (audit L18). */
const MODIFIER_ORDER = ['lctrl', 'rctrl', 'lshift', 'rshift', 'lalt', 'ralt'] as const;

/**
 * Looks up the readable name of one key token. `key` is the token-relative
 * i18n key (`lshift`, `mouseN`, …); returns null when there is none, so the
 * formatter can fall back.
 */
export type KeyTokenTranslate = (key: string, params?: Record<string, string>) => string | null;

/** One raw key token (`lshift`, `mouse1`, `np_2`, `n`, `f5`) → a readable name. */
export function formatKeyToken(raw: string, tr: KeyTokenTranslate): string {
  const token = raw.trim().toLowerCase();
  if (!token) return '';
  const named = tr(token);
  if (named) return named;
  const mouse = /^mouse(\d+)$/.exec(token);
  if (mouse) return tr('mouseN', { n: mouse[1] }) ?? raw;
  const numpad = /^np_(.+)$/.exec(token);
  if (numpad) {
    const inner = tr(numpad[1]) ?? numpad[1].toUpperCase();
    return tr('numpad', { key: inner }) ?? raw;
  }
  if (/^f\d{1,2}$/.test(token)) return token.toUpperCase();
  if (token.length === 1) return token.toUpperCase();
  return humanizeKeybindName(raw.trim());
}

/**
 * A raw binding (`u+lshift`, `lalt+n`, `mouse1`) → "Left Shift + U". Modifiers
 * lead in a fixed order whatever order the profile stored them in; the rest
 * keep theirs. Empty input → ''.
 */
export function formatKeyCombo(raw: string | null | undefined, tr: KeyTokenTranslate): string {
  const tokens = (raw ?? '').split('+').map((t) => t.trim()).filter(Boolean);
  if (tokens.length === 0) return '';
  const rank = (t: string) => {
    const i = (MODIFIER_ORDER as readonly string[]).indexOf(t.toLowerCase());
    return i < 0 ? MODIFIER_ORDER.length : i;
  };
  return tokens
    .map((t, i) => ({ t, i }))
    .sort((a, b) => rank(a.t) - rank(b.t) || a.i - b.i)
    .map(({ t }) => formatKeyToken(t, tr))
    .join(' + ');
}
