import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { FeedbackWorkflowComponent } from './feedback-workflow.component';
import { CelebrationService } from './celebration.service';
import { FeedbackRow, WorkflowItem } from './feedback.types';

function row(id: string): FeedbackRow {
  return {
    id,
    author_id: 'admin',
    body: `Topic ${id}`,
    status: 'needs_input',
    ship_ref: null,
    processing_note: null,
    created_at: '2026-07-20T10:00:00Z',
    updated_at: '2026-07-20T10:00:00Z',
    shipped_at: null,
    processed_at: null,
    author: null,
  };
}

function item(id: string): WorkflowItem {
  return { row: row(id), replies: [] };
}

describe('FeedbackWorkflowComponent — advancing after "Erledigt"', () => {
  let fixture: ComponentFixture<FeedbackWorkflowComponent>;
  let celebration: { reducedMotion: boolean; burst: jasmine.Spy; burstFrom: jasmine.Spy };

  /**
   * Mounts the mode with `ids` in the queue and wires `markHandled` the way the
   * board does: the ticked-off topic leaves the queue synchronously.
   */
  async function setup(ids: string[], reducedMotion = false) {
    celebration = {
      reducedMotion,
      burst: jasmine.createSpy('burst'),
      burstFrom: jasmine.createSpy('burstFrom'),
    };

    await TestBed.configureTestingModule({
      imports: [FeedbackWorkflowComponent],
      providers: [
        provideTranslateService({ fallbackLang: 'en' }),
        { provide: CelebrationService, useValue: celebration },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FeedbackWorkflowComponent);
    let queue = ids.map(item);
    fixture.componentRef.setInput('queue', queue);
    fixture.componentRef.setInput('reply', () => Promise.resolve(true));
    fixture.componentInstance.markHandled.subscribe((id: string) => {
      queue = queue.filter((q) => q.row.id !== id);
      fixture.componentRef.setInput('queue', queue);
    });
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('reports where the run stands once the finished topic left the queue', async () => {
    const cmp = await setup(['a', 'b', 'c']);
    cmp.finish(cmp.current()!);

    // 'a' is gone, 'b' slid into the same slot — position 1 of the 2 that are left.
    expect(cmp.current()!.row.id).toBe('b');
    expect(cmp.advanced()).toEqual({ current: 1, total: 2 });
  });

  it('counts from the cursor, not from the queue head', async () => {
    const cmp = await setup(['a', 'b', 'c']);
    cmp.next();
    cmp.finish(cmp.current()!);

    expect(cmp.current()!.row.id).toBe('c');
    expect(cmp.advanced()).toEqual({ current: 2, total: 2 });
  });

  it('stays quiet when the last topic drains the queue', async () => {
    const cmp = await setup(['a']);
    cmp.finish(cmp.current()!);

    expect(cmp.current()).toBeNull();
    // The "Alles abgearbeitet" screen is the change — no advance notice on top.
    expect(cmp.advanced()).toBeNull();
  });

  it('reports the step under reduced motion too, where the slide-in is dropped', async () => {
    const cmp = await setup(['a', 'b'], true);
    cmp.finish(cmp.current()!);

    expect(cmp.advanced()).toEqual({ current: 1, total: 1 });
  });

  it('drops a pending notice when the admin steps on manually', async () => {
    const cmp = await setup(['a', 'b', 'c']);
    cmp.finish(cmp.current()!);
    expect(cmp.advanced()).not.toBeNull();

    cmp.next();
    expect(cmp.advanced()).toBeNull();
  });

  // ---- Scope switch (feedback abfa97c6) ----

  it('emits the picked scope and ignores a click on the active one', async () => {
    const cmp = await setup(['a', 'b']);
    const picked: string[] = [];
    cmp.scopeChange.subscribe((s: string) => picked.push(s));

    cmp.pickScope('all'); // already the default input value
    cmp.pickScope('mine');
    expect(picked).toEqual(['mine']);
  });

  it('exposes the switch options with their counts', async () => {
    const cmp = await setup(['a', 'b']);
    fixture.componentRef.setInput('scopeCounts', { mine: 2, others: 3, all: 5 });
    fixture.detectChanges();

    expect(cmp.scopeOptions()).toEqual([
      { key: 'mine', count: 2 },
      { key: 'others', count: 3 },
      { key: 'all', count: 5 },
    ]);
    // Two of the five are on screen — the rest are hidden by the scope.
    expect(cmp.hiddenByScope()).toBe(3);
  });

  it('restarts at the head of a newly scoped queue', async () => {
    const cmp = await setup(['a', 'b', 'c']);
    cmp.next();
    expect(cmp.position()).toBe(1);

    fixture.componentRef.setInput('queue', [item('x'), item('y')]);
    fixture.componentRef.setInput('scope', 'mine');
    fixture.detectChanges();

    expect(cmp.position()).toBe(0);
    expect(cmp.current()!.row.id).toBe('x');
  });

  it('does not celebrate a scope that merely happens to be empty', async () => {
    const cmp = await setup(['a', 'b']);
    fixture.componentRef.setInput('queue', []);
    fixture.componentRef.setInput('scope', 'mine');
    fixture.detectChanges();

    expect(cmp.current()).toBeNull();
    expect(celebration.burst).not.toHaveBeenCalled();
  });
});
