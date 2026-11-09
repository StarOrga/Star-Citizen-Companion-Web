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
