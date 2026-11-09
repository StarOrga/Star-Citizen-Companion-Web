import { Injectable } from '@angular/core';

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'LINK', 'TEMPLATE', 'NOSCRIPT', 'META']);

/** Live regions keep announcing (toasts, status) even while a modal is open. */
function isLiveRegion(el: Element): boolean {
  if (el.hasAttribute('aria-live')) return true;
  const role = el.getAttribute('role');
  return role === 'status' || role === 'alert' || role === 'log';
}

/**
 * Makes everything outside the topmost open modal dialog `inert` (no focus, no
 * pointer, hidden from assistive tech) — the shell, its floating buttons and
 * the feedback launchers included. `[scDialog]` registers a modal on open and
 * unregisters it on destroy, so a route change that tears the dialog down
 * restores the page too.
 *
 * Instead of marking fixed regions, the service walks from the dialog up to
 * `<body>` and marks every sibling off that path. That works the same for a
 * dialog inside the shell and for one in a CDK overlay container, and it never
 * marks an ancestor of the dialog (which would make the dialog itself inert).
 * With nested modals only the topmost one is live: the stack is recomputed on
 * every change. Elements that were already `inert` are left as they were, and
 * elements added later (select lists, tooltips) are not touched.
 */
@Injectable({ providedIn: 'root' })
export class ModalInertService {
  private readonly stack: HTMLElement[] = [];
  private marked: Element[] = [];

  register(host: HTMLElement): void {
    if (this.stack.includes(host)) return;
    this.stack.push(host);
    this.apply();
  }

  unregister(host: HTMLElement): void {
    const at = this.stack.indexOf(host);
    if (at < 0) return;
    this.stack.splice(at, 1);
    this.apply();
  }

  /** Number of open modal dialogs (for tests). */
  get depth(): number {
    return this.stack.length;
  }

  private apply(): void {
    for (const el of this.marked) el.removeAttribute('inert');
    this.marked = [];
    // Drop hosts that left the DOM without a destroy hook.
    const top = [...this.stack].reverse().find((h) => h.isConnected);
    if (!top) return;
    let node: HTMLElement = top;
    while (node.parentElement) {
      const parent: HTMLElement = node.parentElement;
      for (const sib of Array.from(parent.children)) {
        if (sib === node || sib.classList.contains('cdk-focus-trap-anchor') || SKIP_TAGS.has(sib.tagName) || isLiveRegion(sib)) continue;
        if (sib.hasAttribute('inert')) continue;
        sib.setAttribute('inert', '');
        this.marked.push(sib);
      }
      node = parent;
    }
  }
}
