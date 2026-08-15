import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { FeedbackWorkflowComponent } from './feedback-workflow.component';
import { CelebrationService } from './celebration.service';
import { FeedbackMessage, FeedbackRow, WorkflowItem } from './feedback.types';

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


/** A thread message, oldest-first order assumed by the component. */
function msg(id: string, isSystem: boolean): FeedbackMessage {
  return {
    id,
    feedback_id: 'x',
    author_id: isSystem ? null : 'admin',
    is_system: isSystem,
    body: `Message ${id}`,
    created_at: '2026-07-20T11:00:00Z',
    author: null,
  };
}

describe('FeedbackWorkflowComponent — advancing after "Erledigt"', () => {
  let fixture: ComponentFixture<FeedbackWorkflowComponent>;
  let celebration: { reducedMotion: boolean; burst: jasmine.Spy; burstFrom: jasmine.Spy };
  /** Stand-in for the board's "post the steer, then reopen" write. */
  let reopenWithReply: jasmine.Spy;
  /** What that write resolves to — flipped to false for the failure case. */
  let reopenOk = true;

  /**
   * Mounts the mode with `ids` in the queue and wires `markHandled` the way the
   * board does: the ticked-off topic leaves the queue synchronously.
   */
  async function setup(ids: string[], reducedMotion = false) {
    return setupQueue(ids.map(item), reducedMotion);
  }

  /** Same, but with a hand-built queue — used for the mixed question/Abnahme runs. */
  async function setupQueue(items: WorkflowItem[], reducedMotion = false) {
    reopenOk = true;
    reopenWithReply = jasmine
      .createSpy('reopenWithReply')
      .and.callFake(() => Promise.resolve(reopenOk));
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
    fixture.componentRef.setInput('reopenWithReply', reopenWithReply);
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

  it('offers the sign-off, the reopen and skip — and no "Thema öffnen"', async () => {
    const cmp = await setupQueue([reviewItem('r')]);
    const accepted: string[] = [];
    cmp.acceptReview.subscribe((r: FeedbackRow) => accepted.push(r.id));

    // accept · reopen · skip. "Thema öffnen" is gone (feedback d4990269,
    // round 2) — the card shows the whole topic — and there is no answer box
    // until the reopen is picked.
    const buttons: HTMLButtonElement[] = Array.from(
      fixture.nativeElement.querySelectorAll('.wf-actions button'),
    );
    expect(buttons.length).toBe(3);
    expect(fixture.nativeElement.querySelector('sc-feedback-composer')).toBeNull();

    buttons[0].click();
    expect(accepted).toEqual(['r']);
  });

  it('reports the step once a sign-off decision came back', async () => {
    const cmp = await setupQueue([reviewItem('r'), item('q')]);
    cmp.accept(cmp.current()!);

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
    cmp.accept(cmp.current()!);

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

    cmp.accept(cmp.queue()[0]);
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
  // ---- Kind lens: the Abnahme tab's replacement (feedback d4990269, round 2) ----

  it('exposes the kind switch with its counts', async () => {
    const cmp = await setupQueue([item('q'), reviewItem('r')]);
    fixture.componentRef.setInput('kindCounts', { all: 2, question: 1, review: 1 });
    fixture.detectChanges();

    expect(cmp.kindOptions()).toEqual([
      { key: 'all', count: 2 },
      { key: 'question', count: 1 },
      { key: 'review', count: 1 },
    ]);
  });

  it('emits the picked kind and ignores a click on the active one', async () => {
    const cmp = await setup(['a']);
    const picked: string[] = [];
    cmp.kindChange.subscribe((k: string) => picked.push(k));

    cmp.pickKind('all'); // already the default input value
    cmp.pickKind('review');
    expect(picked).toEqual(['review']);
  });

  it('blames the kind lens, not an empty inbox, when it is what hides the work', async () => {
    const cmp = await setupQueue([]);
    // Filtered to Abnahmen, none waiting — but three Rückfragen sit behind it.
    fixture.componentRef.setInput('kind', 'review');
    fixture.componentRef.setInput('kindCounts', { all: 3, question: 3, review: 0 });
    fixture.componentRef.setInput('scopeCounts', { mine: 0, others: 0, all: 0 });
    fixture.detectChanges();

    expect(cmp.hiddenByScope()).toBe(0);
    expect(cmp.hiddenByKind()).toBe(3);
  });

  // ---- Folded thread history (feedback d4990269, round 2) ----

  it('shows only the tail the run points at, folding the rest away', async () => {
    // …first post, two older messages, then the routine's open question.
    const q = item('q');
    q.replies = [msg('m1', false), msg('m2', true), msg('m3', false), msg('m4', true)];
    const cmp = await setupQueue([q]);

    // The run points at the trailing routine message → everything before folds.
    expect(cmp.focusIndex()).toBe(3);
    expect(cmp.hiddenCount()).toBe(3);
    expect(cmp.visibleReplies().map((m) => m.id)).toEqual(['m4']);
  });

  it('unfolds the history on demand and folds it back', async () => {
    const q = item('q');
    q.replies = [msg('m1', false), msg('m2', true), msg('m3', true)];
    const cmp = await setupQueue([q]);
    expect(cmp.visibleReplies().length).toBe(2); // the trailing routine run

    cmp.toggleThread();
    expect(cmp.hiddenCount()).toBe(0);
    expect(cmp.visibleReplies().map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);

    cmp.toggleThread();
    expect(cmp.visibleReplies().map((m) => m.id)).toEqual(['m2', 'm3']);
  });

  it('folds nothing when the run points at the first message', async () => {
    const q = item('q');
    q.replies = [msg('m1', true)];
    const cmp = await setupQueue([q]);

    expect(cmp.hiddenCount()).toBe(0);
    expect(fixture.nativeElement.querySelector('.thread-more')).toBeNull();
  });

  it('starts the next card folded again', async () => {
    const a = item('a');
    a.replies = [msg('m1', false), msg('m2', true)];
    const b = item('b');
    b.replies = [msg('n1', false), msg('n2', true)];
    const cmp = await setupQueue([a, b]);

    cmp.toggleThread();
    expect(cmp.threadExpanded()).toBeTrue();
    cmp.skip();
    fixture.detectChanges();

    expect(cmp.current()!.row.id).toBe('b');
    expect(cmp.threadExpanded()).toBeFalse();
  });

  // ---- Reopen carries a message (feedback d4990269, round 2) ----

  it('opens the answer box instead of flipping the status on the spot', async () => {
    const cmp = await setupQueue([reviewItem('r')]);
    expect(fixture.nativeElement.querySelector('sc-feedback-composer')).toBeNull();

    cmp.startReopen();
    fixture.detectChanges();

    expect(cmp.reopening()).toBeTrue();
    expect(fixture.nativeElement.querySelector('sc-feedback-composer')).not.toBeNull();
    // The two decisions step aside while the admin is writing.
    const labels: string[] = Array.from(
      fixture.nativeElement.querySelectorAll('.wf-actions button'),
    ).map((b) => (b as HTMLButtonElement).textContent!.trim());
    expect(labels.length).toBe(1);
    expect(reopenWithReply).not.toHaveBeenCalled();
  });

  it('backs out of the answer box without writing anything', async () => {
    const cmp = await setupQueue([reviewItem('r')]);
    cmp.startReopen();
    cmp.cancelReopen();
    fixture.detectChanges();

    expect(cmp.reopening()).toBeFalse();
    expect(fixture.nativeElement.querySelectorAll('.wf-actions button').length).toBe(3);
    expect(reopenWithReply).not.toHaveBeenCalled();
  });

  it('sends the steer and the reopen as one call, then reports the step', async () => {
    const cmp = await setupQueue([reviewItem('r'), item('q')]);
    cmp.startReopen();

    expect(await cmp.submitReopen({ text: 'noch nicht ganz', images: [] })).toBeTrue();
    expect(reopenWithReply).toHaveBeenCalledWith('r', { text: 'noch nicht ganz', images: [] });
    expect(cmp.reopening()).toBeFalse();

    // The board's refresh drops the reopened topic → the run names where it is.
    fixture.componentRef.setInput('queue', [item('q')]);
    fixture.detectChanges();
    expect(cmp.advanced()).toEqual({ current: 1, total: 1 });
  });

  it('keeps the box open when the write failed', async () => {
    const cmp = await setupQueue([reviewItem('r')]);
    cmp.startReopen();
    reopenOk = false;

    expect(await cmp.submitReopen({ text: 'nope', images: [] })).toBeFalse();
    // The admin's words stay in front of them, and nothing was reported.
    expect(cmp.reopening()).toBeTrue();
    expect(cmp.advanced()).toBeNull();
  });
});
