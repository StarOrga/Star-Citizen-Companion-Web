import { Component, effect, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { FeedbackComposerComponent } from '../admin/feedback/feedback-composer.component';
import { FeedbackComposerSeedService } from './feedback-composer-seed.service';
import { FeedbackDraftService } from './feedback-draft.service';
import { FeedbackSpotDirective } from './feedback-spot.directive';
import { FeedbackLineTarget, FeedbackSpotService, withReferenceLine } from './feedback-spot.service';
import { SPOT_SIZE, placeSpots, referenceLine } from './feedback-spots.component';
import { provideFakeAttachmentSigner } from './testing/fake-attachment-signer';

/**
 * Feedback #243: while a feedback panel is open, small buttons on the page's
 * sections put "<where>" as the first line of the text being written.
 */
describe('withReferenceLine', () => {
  it('fills an empty box with the line and puts the caret below it', () => {
    expect(withReferenceLine('', 'Headline', null, 0)).toEqual({ text: 'Headline\n', caret: 9 });
  });

  it('puts the line above the writer’s text and keeps the caret in that text', () => {
    const r = withReferenceLine('Zu klein', 'Loadout', null, 3);
    expect(r.text).toBe('Loadout\nZu klein');
    expect(r.caret).toBe('Loadout\n'.length + 3);
  });

  it('replaces its own earlier line instead of stacking a second one', () => {
    const r = withReferenceLine('Loadout\nZu klein', 'Analyse', 'Loadout', 'Loadout\nZu'.length);
    expect(r.text).toBe('Analyse\nZu klein');
    expect(r.caret).toBe('Analyse\nZu'.length);
  });

  it('leaves a first line alone that the writer has since edited', () => {
    const r = withReferenceLine('Loadout ist kaputt\nmehr', 'Analyse', 'Loadout', 0);
    expect(r.text).toBe('Analyse\nLoadout ist kaputt\nmehr');
  });
});

describe('referenceLine', () => {
  const t = (key: string, params?: Record<string, string>) =>
    params ? `${key}(${Object.values(params).join('|')})` : key;

  it('names the section and its sub-part', () => {
    expect(referenceLine({ key: 'L', subKey: 'W', text: null }, null, t)).toBe('L W');
  });

  it('puts the Codex view in front on a ship page', () => {
    expect(referenceLine({ key: 'L', subKey: 'W', text: null }, 'classic', t)).toBe(
      'codex.holo.toggle.classicHint: L W',
    );
  });

  it('quotes a page title through its own key', () => {
    expect(referenceLine({ key: 'H', subKey: null, text: 'Gladius' }, null, t)).toBe(
      'feedbackSpot.titled(H|Gladius)',
    );
  });
});

describe('placeSpots', () => {
  const vp = { width: 1200, height: 800, topClear: 60 };
  const rect = (top: number, left: number, right: number, bottom: number) => ({ top, left, right, bottom });

  it('sits in the section’s top-right corner', () => {
    const [p] = placeSpots([{ spot: 'a', rect: rect(100, 0, 500, 400) }], [], vp);
    expect(p).toEqual({ spot: 'a', top: 106, left: 500 - SPOT_SIZE - 6 });
  });

  it('pins below the sticky header while a tall section is still on screen', () => {
    const [p] = placeSpots([{ spot: 'a', rect: rect(-300, 0, 500, 700) }], [], vp);
    expect(p.top).toBe(66);
  });

  it('skips hidden, off-screen and almost scrolled-away sections', () => {
    const placed = placeSpots(
      [
        { spot: 'hidden', rect: rect(0, 0, 0, 0) },
        { spot: 'below', rect: rect(900, 0, 500, 1200) },
        { spot: 'gone', rect: rect(-500, 0, 500, 70) },
      ],
      [],
      vp,
    );
    expect(placed).toEqual([]);
  });

  it('never puts a spot under the open feedback panel', () => {
    const panel = rect(300, 700, 1180, 780);
    const placed = placeSpots(
      [
        { spot: 'under', rect: rect(300, 600, 1000, 600) },
        { spot: 'free', rect: rect(100, 0, 500, 400) },
      ],
      [panel],
      vp,
    );
    expect(placed.map((p) => p.spot)).toEqual(['free']);
  });

  it('draws one spot where a marked heading sits in a marked card', () => {
    const placed = placeSpots(
      [
        { spot: 'card', rect: rect(100, 0, 500, 400) },
        { spot: 'heading', rect: rect(102, 10, 498, 160) },
      ],
      [],
      vp,
    );
    expect(placed.map((p) => p.spot)).toEqual(['card']);
  });
});

describe('FeedbackSpotService', () => {
  let svc: FeedbackSpotService;
  let seeds: FeedbackComposerSeedService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    svc = TestBed.inject(FeedbackSpotService);
    seeds = TestBed.inject(FeedbackComposerSeedService);
  });

  function target(): FeedbackLineTarget & { lines: string[] } {
    const lines: string[] = [];
    return { lines, insertReferenceLine: (l: string) => lines.push(l) };
  }

  it('is open while a launcher reports its panel, and admin wins the colour', () => {
    expect(svc.open()).toBeFalse();
    const el = document.createElement('div');
    svc.setPanel('user', el, 'user:new');
    expect(svc.open()).toBeTrue();
    expect(svc.owner()).toBe('user');
    svc.setPanel('admin', el, 'admin:new');
    expect(svc.owner()).toBe('admin');
    svc.setPanel('admin', null, 'admin:new');
    svc.setPanel('user', null, 'user:new');
    expect(svc.open()).toBeFalse();
  });

  it('settles when a launcher reports its panel from an effect (no open/close loop)', () => {
    // The launchers call setPanel inside an effect with an onCleanup. A tracked
    // read of the panel map inside setPanel made that effect re-run on its own
    // write, forever — the admin sheet froze the page on phones.
    let runs = 0;
    @Component({ selector: 'sc-spot-launcher-probe', template: '' })
    class LauncherProbe {
      readonly open = signal(false);
      constructor() {
        effect((onCleanup) => {
          runs++;
          const el = this.open() ? document.body : null;
          svc.setPanel('admin', el, 'admin:new');
          onCleanup(() => svc.setPanel('admin', null, 'admin:new'));
        });
      }
    }
    const fixture = TestBed.createComponent(LauncherProbe);
    fixture.detectChanges();
    fixture.componentInstance.open.set(true);
    fixture.detectChanges();
    expect(svc.open()).toBeTrue();
    expect(runs).toBe(2);
  });

  it('sends the line to the composer last focused, else the last mounted', () => {
    const a = target();
    const b = target();
    svc.attachTarget(a);
    const detachB = svc.attachTarget(b);
    svc.insert('one');
    expect(b.lines).toEqual(['one']);
    svc.touch(a);
    svc.insert('two');
    expect(a.lines).toEqual(['two']);
    detachB();
    svc.insert('three');
    expect(a.lines).toEqual(['two', 'three']);
  });

  it('with no composer mounted, seeds the open panel’s new topic and asks it to unfold', () => {
    svc.setPanel('admin', document.createElement('div'), 'admin:new');
    const before = seeds.openRequests();
    svc.insert('Headline');
    expect(seeds.take('admin:new')?.body).toBe('Headline');
    expect(seeds.openRequests()).toBe(before + 1);
  });

  it('registers a marked element for as long as it lives', () => {
    @Component({
      standalone: true,
      imports: [FeedbackSpotDirective],
      template: `@if (show()) { <section [scFeedbackSpot]="'codex.detail.columnLoadout'" [scFeedbackSpotSub]="'codex.moduleSection.weapons'"></section> }`,
    })
    class HostComponent {
      readonly show = signal(true);
    }
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    expect(svc.spots().length).toBe(1);
    expect(svc.spots()[0].label()).toEqual({
      key: 'codex.detail.columnLoadout',
      subKey: 'codex.moduleSection.weapons',
      text: null,
    });
    fixture.componentInstance.show.set(false);
    fixture.detectChanges();
    expect(svc.spots().length).toBe(0);
  });
});

describe('FeedbackComposerComponent — reference line', () => {
  class Drafts {
    readonly entries = signal(new Map()).asReadonly();
    ready = () => Promise.resolve();
    entry = () => null;
    stage = () => undefined;
    flush = () => Promise.resolve();
    discard = () => Promise.resolve();
    clearSent = () => Promise.resolve();
    uploadAttachment = () => Promise.resolve(null);
  }

  afterEach(() => TestBed.resetTestingModule());

  it('puts the spot’s line on top of the focused composer and swaps it on the next click', async () => {
    await TestBed.configureTestingModule({
      imports: [FeedbackComposerComponent],
      providers: [
        provideTranslateService({ fallbackLang: 'en' }),
        provideFakeAttachmentSigner(),
        { provide: FeedbackDraftService, useClass: Drafts },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(FeedbackComposerComponent);
    fixture.componentRef.setInput('placeholder', 'adminFeedback.compose.placeholder');
    fixture.componentRef.setInput('sendLabel', 'adminFeedback.compose.send');
    fixture.detectChanges();
    const cmp = fixture.componentInstance;
    const spots = TestBed.inject(FeedbackSpotService);
    const ta: HTMLTextAreaElement = fixture.nativeElement.querySelector('textarea');

    ta.value = 'Zu klein';
    ta.setSelectionRange(8, 8);
    cmp.onInput({ target: ta } as unknown as Event);
    ta.dispatchEvent(new FocusEvent('focus'));

    spots.insert('Klassische Ansicht: Loadout Bewaffnung');
    expect(cmp.draft()).toBe('Klassische Ansicht: Loadout Bewaffnung\nZu klein');
    expect(ta.selectionStart).toBe(cmp.draft().length);

    spots.insert('Klassische Ansicht: Analyse');
    expect(cmp.draft()).toBe('Klassische Ansicht: Analyse\nZu klein');
  });
});
