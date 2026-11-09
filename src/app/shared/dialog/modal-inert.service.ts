import { Injectable } from '@angular/core';

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'LINK', 'TEMPLATE', 'NOSCRIPT', 'META']);

/** Live regions keep announcing (toasts, status) even while a modal is open. */
const LIVE_SELECTOR = '[aria-live], [role="status"], [role="alert"], [role="log"]';

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
    // Up to <body>, not past it: <head> is no content and stays untouched.
    while (node.parentElement && node !== node.ownerDocument.body) {
      const parent: HTMLElement = node.parentElement;
      for (const sib of Array.from(parent.children)) {
        if (sib === node || sib.classList.contains('cdk-focus-trap-anchor')) continue;
        this.markOutside(sib);
      }
      node = parent;
    }
  }

  /**
   * Marks one element outside the dialog inert — unless it is, or holds, a live
   * region: an inert ancestor would silence a toast or status line nested in
   * it, so such an element is not marked itself, only its children (recursively).
   */
  private markOutside(el: Element): void {
    if (SKIP_TAGS.has(el.tagName) || isLiveRegion(el) || el.hasAttribute('inert')) return;
    if (el.querySelector(LIVE_SELECTOR)) {
      for (const child of Array.from(el.children)) this.markOutside(child);
      return;
    }
    el.setAttribute('inert', '');
    this.marked.push(el);
  }
}
