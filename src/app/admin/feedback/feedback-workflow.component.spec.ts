import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
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
  return { row: row(id), replies: [], kind: 'question' };
}

/** An Abnahme step: a shipped topic nobody has signed off yet (feedback d4990269). */
function reviewItem(id: string): WorkflowItem {
  return {
    row: { ...row(id), status: 'shipped', reviewed_at: null, ship_ref: 'https://example.test/pr/1' },
    replies: [],
    kind: 'review',
  };
}

describe('FeedbackWorkflowComponent — advancing after "Erledigt"', () => {
  let fixture: ComponentFixture<FeedbackWorkflowComponent>;
  let celebration: { reducedMotion: boolean; burst: jasmine.Spy; burstFrom: jasmine.Spy };

  /**
   * Mounts the mode with `ids` in the queue and wires `markHandled` the way the
   * board does: the ticked-off topic leaves the queue synchronously.
   */
  async function setup(ids: string[], reducedMotion = false) {
    return setupQueue(ids.map(item), reducedMotion);
  }

  /** Same, but with a hand-built queue — used for the mixed question/Abnahme runs. */
  async function setupQueue(items: WorkflowItem[], reducedMotion = false) {
    celebration = {
      reducedMotion,
      burst: jasmine.createSpy('burst'),
      burstFrom: jasmine.createSpy('burstFrom'),
    };

    await TestBed.configureTestingModule({
      imports: [FeedbackWorkflowComponent],
      providers: [
        provideTranslateService({ fallbackLang: 'en' }),
        // The answer box persists its draft on the account, which pulls in
        // AuthService — and that injects the Router.
        provideRouter([]),
        { provide: CelebrationService, useValue: celebration },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FeedbackWorkflowComponent);
    let queue = items;
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
    cmp.skip();
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

    cmp.skip();
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
    cmp.skip();
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

  // ---- Carousel with skip (feedback d4990269) ----

  it('parks the current item and steps to the next unseen one', async () => {
    const cmp = await setup(['a', 'b', 'c']);
    cmp.skip();

    expect(cmp.current()!.row.id).toBe('b');
    expect(cmp.skippedCount()).toBe(1);
    // Parked, not resolved: the item is still in the queue and still counted.
    expect(cmp.total()).toBe(3);
  });

  it('walks past items it already parked', async () => {
    const cmp = await setup(['a', 'b', 'c']);
    cmp.skip(); // parks a → b
    cmp.skip(); // parks b → c
    expect(cmp.current()!.row.id).toBe('c');
    expect(cmp.skippedCount()).toBe(2);
  });

  it('wraps back onto the parked items once the lap is through', async () => {
    const cmp = await setup(['a', 'b', 'c']);
    cmp.skip();
    cmp.skip();
    cmp.skip(); // nothing unseen left → new lap

    expect(cmp.current()!.row.id).toBe('a');
    expect(cmp.lapWrapped()).toBeTrue();
    // The lap starts over, so nothing counts as skipped again…
    expect(cmp.skippedCount()).toBe(0);
    // …but the item says it has been round once already.
    expect(cmp.isSkipped()).toBeTrue();
  });

  it('carries a one-item queue around too', async () => {
    const cmp = await setup(['a']);
    cmp.skip();

    expect(cmp.current()!.row.id).toBe('a');
    expect(cmp.lapWrapped()).toBeTrue();
  });

  it('stops counting parked items that left the queue meanwhile', async () => {
    const cmp = await setup(['a', 'b', 'c']);
    cmp.skip();
    expect(cmp.skippedCount()).toBe(1);

    fixture.componentRef.setInput('queue', [item('b'), item('c')]);
    fixture.detectChanges();
    expect(cmp.skippedCount()).toBe(0);
  });

  it('starts a fresh lap when the scope changes', async () => {
    const cmp = await setup(['a', 'b', 'c']);
    cmp.skip();

    fixture.componentRef.setInput('queue', [item('a'), item('b')]);
    fixture.componentRef.setInput('scope', 'mine');
    fixture.detectChanges();

    expect(cmp.skippedCount()).toBe(0);
    expect(cmp.isSkipped()).toBeFalse();
  });

  // ---- Abnahme steps folded into the run (feedback d4990269) ----

  it('tells an Abnahme step from a Rückfrage', async () => {
    const cmp = await setupQueue([item('q'), reviewItem('r')]);

    expect(cmp.isReview(cmp.current()!)).toBeFalse();
    cmp.skip();
    expect(cmp.isReview(cmp.current()!)).toBeTrue();
    expect(cmp.outcomeStatus(cmp.current()!)).toBe('shipped');
    expect(cmp.linkKind(cmp.current()!)).toBe('ship');
  });

  it('offers exactly the two Abnahme decisions and hands them to the board', async () => {
    const cmp = await setupQueue([reviewItem('r')]);
    const accepted: string[] = [];
    const reopened: string[] = [];
    const opened: string[] = [];
    cmp.acceptReview.subscribe((r: FeedbackRow) => accepted.push(r.id));
    cmp.reopenReview.subscribe((r: FeedbackRow) => reopened.push(r.id));
    cmp.openTopic.subscribe((r: FeedbackRow) => opened.push(r.id));

    // accept · reopen · skip · open topic — no answer box on an Abnahme step.
    const buttons: HTMLButtonElement[] = Array.from(
      fixture.nativeElement.querySelectorAll('.wf-actions button'),
    );
    expect(buttons.length).toBe(4);
    expect(fixture.nativeElement.querySelector('sc-feedback-composer')).toBeNull();

    buttons[0].click();
    buttons[1].click();
    buttons[3].click();

    expect(accepted).toEqual(['r']);
    expect(reopened).toEqual(['r']);
    expect(opened).toEqual(['r']);
  });

  it('reports the step once a sign-off decision came back', async () => {
    const cmp = await setupQueue([reviewItem('r'), item('q')]);
    cmp.decide(cmp.current()!, 'accept');

    // The board is writing — the topic is still in the queue, nothing to report.
    fixture.componentRef.setInput('busy', true);
    fixture.detectChanges();
    expect(cmp.advanced()).toBeNull();

    // Write landed and the refresh dropped the topic → the run names where it is.
    fixture.componentRef.setInput('queue', [item('q')]);
    fixture.componentRef.setInput('busy', false);
    fixture.detectChanges();
    expect(cmp.advanced()).toEqual({ current: 1, total: 1 });
  });

  it('stays quiet when the sign-off write failed and the topic stayed', async () => {
    const cmp = await setupQueue([reviewItem('r'), item('q')]);
    cmp.decide(cmp.current()!, 'reopen');

    fixture.componentRef.setInput('busy', true);
    fixture.detectChanges();
    // Write came back with an error: still busy=false, topic still queued.
    fixture.componentRef.setInput('busy', false);
    fixture.detectChanges();
    expect(cmp.advanced()).toBeNull();

    // …and the dropped marker does not fire on some later, unrelated change.
    fixture.componentRef.setInput('queue', [item('q')]);
    fixture.detectChanges();
    expect(cmp.advanced()).toBeNull();
  });

  it('stops promising a comeback for a topic that was decided', async () => {
    const cmp = await setupQueue([reviewItem('r'), item('q')]);
    cmp.skip(); // parks r → q
    expect(cmp.skippedCount()).toBe(1);

    cmp.decide(cmp.queue()[0], 'accept');
    expect(cmp.skippedCount()).toBe(0);
  });

  it('dates an Abnahme by when its outcome landed, a question by its creation', async () => {
    const review = reviewItem('r');
    review.row.shipped_at = '2026-07-25T09:00:00Z';
    const cmp = await setupQueue([item('q'), review]);

    expect(cmp.stamp(cmp.current()!)).toBe('2026-07-20T10:00:00Z');
    cmp.skip();
    expect(cmp.stamp(cmp.current()!)).toBe('2026-07-25T09:00:00Z');
  });
});
