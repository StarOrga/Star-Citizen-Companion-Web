import { DOCUMENT, Injector } from '@angular/core';
import { FeedbackMotionService, LEAVE_MS } from './feedback-motion.service';

/**
 * The fold-out behind "das issue dort sich weg animieren" (admin feedback
 * cf74472a): a row collapses to nothing and closes the gap under it, a
 * reduced-motion viewer gets the end state at once, and a failed write can
 * put the row back.
 */
describe('FeedbackMotionService', () => {
  let host: HTMLElement;

  function mountList(): { list: HTMLElement; row: HTMLElement; below: HTMLElement } {
    host = document.createElement('div');
    host.innerHTML = `
      <div class="list" style="display:flex;flex-direction:column;gap:12px;width:300px">
        <div class="row" style="height:40px;padding:8px;border:1px solid #000;box-sizing:content-box"></div>
        <div class="below" style="height:10px"></div>
      </div>`;
    document.body.appendChild(host);
    return {
      list: host.querySelector<HTMLElement>('.list')!,
      row: host.querySelector<HTMLElement>('.row')!,
      below: host.querySelector<HTMLElement>('.below')!,
    };
  }

  afterEach(() => host?.remove());

  /** A plain injector (no TestBed): the document's window answers the media query as told. */
  function service(reduced: boolean): FeedbackMotionService {
    const win = {
      matchMedia: (q: string) => ({ matches: reduced && q.includes('reduce') }),
      getComputedStyle: (el: Element) => window.getComputedStyle(el),
    };
    const doc = Object.defineProperty(Object.create(document), 'defaultView', { value: win });
    const injector = Injector.create({
      providers: [
        { provide: DOCUMENT, useValue: doc },
        { provide: FeedbackMotionService, useClass: FeedbackMotionService },
      ],
    });
    return injector.get(FeedbackMotionService);
  }

  it('folds the row shut and closes the gap under it', async () => {
    const { row, below } = mountList();
    const svc = service(false);
    const topBefore = below.getBoundingClientRect().top;
    const started = performance.now();

    await svc.collapse(row);

    expect(performance.now() - started).withContext('waits for the fold').toBeGreaterThanOrEqual(LEAVE_MS - 40);
    expect(row.getBoundingClientRect().height).toBeLessThan(1);
    expect(getComputedStyle(row).opacity).toBe('0');
    // The list gap is animated away too: what was below moved up by the row
    // AND the gap, so no hole is left where the row stood.
    expect(below.getBoundingClientRect().top).toBeLessThan(topBefore - 40);
    expect(row.style.pointerEvents).toBe('none');
  });

  it('gives a reduced-motion viewer the end state at once', async () => {
    const { row } = mountList();
    const svc = service(true);
    const started = performance.now();
    await svc.collapse(row);
    expect(performance.now() - started).toBeLessThan(LEAVE_MS / 2);
    expect(row.style.visibility).toBe('hidden');
  });

  it('restore puts a folded row back', async () => {
    const { row } = mountList();
    const svc = service(false);
    const heightBefore = row.getBoundingClientRect().height;
    await svc.collapse(row);
    svc.restore(row);
    expect(row.getBoundingClientRect().height).toBe(heightBefore);
    expect(row.style.pointerEvents).toBe('');
    expect(row.style.overflow).toBe('');
  });

  it('is a no-op for nothing and for a detached node', async () => {
    const svc = service(false);
    await expectAsync(svc.collapse(null)).toBeResolved();
    await expectAsync(svc.collapse(document.createElement('div'))).toBeResolved();
    expect(() => svc.restore(null)).not.toThrow();
    expect(() => svc.reveal(null)).not.toThrow();
  });
});
