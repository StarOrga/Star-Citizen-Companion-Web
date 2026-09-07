/**
 * Counting frames the way the eye does — the measurement behind admin feedback
 * ae072e63 ("schau mal wie viele Randverschachtelungen wir haben! 4 Stück im
 * Feedback Panel mit der Außenwand, ich finde 3 maximal, wenn nicht sogar nur 2
 * maximal").
 *
 * Both feedback panels are embedded in a wall drawn OUTSIDE their component —
 * the admin FAB panel, the user FAB panel — so the admin's ceiling of three
 * frames on screen is a ceiling of **two** boxes nested inside the component
 * itself. The innermost of those two is normally the field, whose border is the
 * one down there that says something ("you can type here").
 *
 * A **box** is what reads as a frame: all four sides drawn. A single top,
 * bottom or inline-start rule — a sheet's parting line, a list separator, the
 * band heads, a thread's "who wrote this" rule — groups without boxing and
 * deliberately does not count.
 */

/** Does this element draw a frame on all four sides? */
export function drawsBox(el: Element): boolean {
  const cs = getComputedStyle(el);
  return (['top', 'right', 'bottom', 'left'] as const).every((side) => {
    const width = parseFloat(cs.getPropertyValue(`border-${side}-width`));
    const style = cs.getPropertyValue(`border-${side}-style`);
    const color = cs.getPropertyValue(`border-${side}-color`);
    return (
      width >= 1 &&
      style !== 'none' &&
      style !== 'hidden' &&
      color !== 'rgba(0, 0, 0, 0)' &&
      color !== 'transparent'
    );
  });
}

/** `div.card.lead`-style label, so a failure names the chain it found. */
function label(el: Element): string {
  return el.tagName.toLowerCase() + (el.classList.length ? `.${Array.from(el.classList).join('.')}` : '');
}

/** The deepest run of boxes inside boxes under `root`, with the path to it. */
export function deepestBoxNesting(root: HTMLElement): { depth: number; path: string } {
  let worst = { depth: 0, path: '' };
  const walk = (el: Element, depth: number, path: string): void => {
    let d = depth;
    let p = path;
    if (drawsBox(el)) {
      d += 1;
      p = p ? `${p} > ${label(el)}` : label(el);
      if (d > worst.depth) worst = { depth: d, path: p };
    }
    for (const child of Array.from(el.children)) walk(child, d, p);
  };
  for (const child of Array.from(root.children)) walk(child, 0, '');
  return worst;
}
