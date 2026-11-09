/**
 * Sets a custom property on <html> only when its value changes. A write on the root
 * invalidates the style of the whole document; the height publishers (header, fusion bar)
 * are driven by ResizeObservers that fire during every morph and scroll-linked frame,
 * mostly with the value they already published.
 */
export function setRootVar(name: string, value: string): void {
  if (typeof document === 'undefined') return;
  const style = document.documentElement.style;
  if (style.getPropertyValue(name) !== value) style.setProperty(name, value);
}

/** Per attribute: every owner's current value, in claim order (the newest claim wins). */
const claims = new Map<string, Map<object, string>>();

/**
 * Mirrors a component's state onto an attribute of <html>, so global rules can read it as
 * `html[data-x]` instead of `html:has(sc-x[...]) …`. A `:has()` on the root in front of a
 * descendant selector makes every DOM insertion or removal anywhere in the page restyle the
 * whole document (Blink cannot rule the argument out and invalidates all descendants — the
 * 25–90 ms frames of the Kamera-Welt scroll, perf-report "Wave 2c root cause"); an attribute
 * restyles only when the state really flips. `value === null` releases the owner's claim;
 * the attribute stays while any other owner still claims it (two layouts overlap for a
 * frame during a route swap). Writes only on change.
 */
export function claimRootAttr(name: string, owner: object, value: string | null): void {
  if (typeof document === 'undefined') return;
  let byOwner = claims.get(name);
  if (!byOwner) claims.set(name, (byOwner = new Map()));
  byOwner.delete(owner);
  if (value !== null) byOwner.set(owner, value);
  const root = document.documentElement;
  const values = [...byOwner.values()];
  const next = values.length ? values[values.length - 1] : null;
  if (next === null) {
    if (root.hasAttribute(name)) root.removeAttribute(name);
  } else if (root.getAttribute(name) !== next) {
    root.setAttribute(name, next);
  }
}
