import { Component, effect, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { FeedbackComposerComponent } from '../admin/feedback/feedback-composer.component';
import { FeedbackComposerSeedService } from './feedback-composer-seed.service';
import { FeedbackDraftService } from './feedback-draft.service';
import { FeedbackSpotDirective } from './feedback-spot.directive';
import { FeedbackLineTarget, FeedbackSpotService, withReferenceLine } from './feedback-spot.service';
import { provideFakeAttachmentSigner } from './testing/fake-attachment-signer';

/**
 * Feedback #243: where an admin's click-capture line goes.
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

  it('is open while a launcher reports its panel', () => {
    expect(svc.open()).toBeFalse();
    const el = document.createElement('div');
    svc.setPanel('user', el, 'user:new');
    expect(svc.open()).toBeTrue();
    svc.setPanel('admin', el, 'admin:new');
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

  it('with the panel shut and no composer, seeds the admin new topic and asks the panel to open', () => {
    const before = seeds.openRequests();
    svc.insert('Headline');
    expect(seeds.take('admin:new')?.body).toBe('Headline');
    expect(seeds.openRequests()).toBe(before + 1);
  });

  it('asks a shut panel to open even when its composer stays mounted', () => {
    const t = target();
    svc.attachTarget(t);
    const before = seeds.openRequests();
    svc.insert('Headline');
    expect(t.lines).toEqual(['Headline']);
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
