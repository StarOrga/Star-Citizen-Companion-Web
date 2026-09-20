/**
 * Connection popover — click the top-strip connection chip to expand today's
 * connection-tile content (email, server chips + freshness, refresh,
 * sign-out) without the release-ring picker, which now lives in the ⚙
 * Settings dialog. The actual markup/wiring stays in `main.ts`
 * (`paintConnectionDetail`) — this module only owns the floating panel's
 * open/close lifecycle so main.ts doesn't need DOM-positioning code.
 */

let openState = false;

export function isConnectionPopoverOpen(): boolean {
  return openState;
}

export function closeConnectionPopover(): void {
  document.getElementById('connection-popover')?.remove();
  openState = false;
}

/** Toggles the popover; `paintDetail` fills `#connection-popover-body` once mounted. */
export function toggleConnectionPopover(paintDetail: () => void): void {
  if (openState) {
    closeConnectionPopover();
    return;
  }
  const chip = document.getElementById('connection-chip');
  if (!chip) return;
  const panel = document.createElement('div');
  panel.id = 'connection-popover';
  panel.className = 'sc-popover connection-popover';
  panel.innerHTML = '<div id="connection-popover-body"></div>';
  document.body.appendChild(panel);
  const rect = chip.getBoundingClientRect();
  panel.style.top = `${rect.bottom + 6}px`;
  panel.style.right = `${window.innerWidth - rect.right}px`;
  openState = true;
  paintDetail();

  const onDocClick = (e: MouseEvent): void => {
    if (panel.contains(e.target as Node) || chip.contains(e.target as Node)) return;
    closeConnectionPopover();
    document.removeEventListener('mousedown', onDocClick, true);
  };
  document.addEventListener('mousedown', onDocClick, true);
}
