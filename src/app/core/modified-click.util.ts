/**
 * Click classification for anchors whose *left* click is intercepted by the app.
 *
 * Everything that is really a navigation should be a real `<a href>` so the
 * browser's own affordances work: middle click / ⌘+click / Ctrl+click open a new
 * tab, Shift+click a new window, the context menu offers "Open link in new tab",
 * and the status bar previews the target (admin feedback d2171662). Where the
 * plain left click must instead stay in the app (detail overlay, lightbox), the
 * handler has to bow out for every other kind of activation.
 *
 * Note: browsers dispatch `auxclick`, not `click`, for the middle button, so a
 * `(click)` handler normally never sees one. The button check is a guard for
 * synthetic events and for browsers that still emit a middle `click`.
 */
export function isPlainLeftClick(ev: MouseEvent): boolean {
  if (ev.button !== 0) return false;
  return !(ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.altKey);
}

/** True for a middle-button activation — the "open in a new tab" gesture. */
export function isMiddleClick(ev: MouseEvent): boolean {
  return ev.button === 1;
}
