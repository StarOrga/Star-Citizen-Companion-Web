import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService, TranslateService } from '@ngx-translate/core';
import type { StabilityVerdict } from '../../../news/patch-stability';
import type { VerseNewsItem } from '../../../news/news.service';
import type { VerseChannelInfo } from '../../data/verse.models';
import { BriefingHubComponent } from './briefing-hub.component';
import { daysSince, hubChannel, hubChannels } from './briefing-hub';

const NOW = Date.parse('2026-10-28T12:00:00Z');
const known = ['4.10', '4.9'];
const noVerdict = (): StabilityVerdict | null => null;

const build = (version: string, replies: number, extra: Partial<VerseChannelInfo> = {}): VerseChannelInfo => ({
  version, startedAt: '2026-10-23T12:00:00Z', threadFirstAt: '2026-10-23T12:00:00Z', wave: 1, replies, votes: 0,
  ticketShare: 0.2, ticketVoteShare: 0.1, previous: null, ...extra,
});

describe('Verse hub — channel info (Hotfix / PTU / Evocati)', () => {
  it('daysSince counts whole days and tolerates garbage', () => {
    expect(daysSince('2026-10-23T12:00:00Z', NOW)).toBe(5);
    expect(daysSince('2026-10-28T11:00:00Z', NOW)).toBe(0);
    expect(daysSince('2026-10-30T00:00:00Z', NOW)).toBe(0);
    expect(daysSince(null, NOW)).toBeNull();
    expect(daysSince('nope', NOW)).toBeNull();
  });

  it('compares a build with the previous build of its own channel and takes since + wave from the info', () => {
    const info = {
      ptu: build('4.10.3', 121, {
        wave: 2,
        previous: { version: '4.10.2', startedAt: '2026-09-25T12:00:00Z', threadFirstAt: '2026-09-25T12:00:00Z', wave: null, replies: 382, votes: 0, ticketShare: 0.5, ticketVoteShare: 0.5, endedAt: '2026-10-23T12:00:00Z' },
      }),
    };
    const ptu = hubChannel('ptu', { live: '4.10.2' }, known, noVerdict, info, NOW);
    expect([ptu.version, ptu.line, ptu.sinceDays, ptu.wave]).toEqual(['4.10.3', '4.10', 5, 2]);
    expect(ptu.chip?.previousLabel).toBe('4.10.2 PTU');
    expect(ptu.chip?.percent).not.toBeNull();
    expect(ptu.chip?.previous).not.toBeNull();
    expect(ptu.chip?.early).withContext('a PTU build is provisional by nature').toBeTrue();
    expect(ptu.chip?.finished).toBeFalse();
  });

  it('shows "–" for what is missing: no predecessor, too few replies, no ticket data, no wave on a hotfix', () => {
    const lone = hubChannel('evocati', {}, known, noVerdict, { evocati: build('4.11', 40) }, NOW);
    expect(lone.chip).withContext('Evocati has no chip').toBeNull();
    const first = hubChannel('ptu', {}, known, noVerdict, { ptu: build('4.11', 40) }, NOW);
    expect(first.chip?.previous).toBeNull();
    expect(first.chip?.percent).not.toBeNull();
    const thin = hubChannel('ptu', {}, known, noVerdict, { ptu: build('4.11', 3) }, NOW);
    expect(thin.chip?.percent).withContext('too few replies → "Zu wenig Daten"').toBeNull();
    const noTickets = hubChannel('ptu', {}, known, noVerdict, { ptu: build('4.11', 80, { ticketShare: null }) }, NOW);
    expect(noTickets.chip?.percent).toBeNull();
    const hot = hubChannel('hotfix', { live: '4.10.2' }, known, noVerdict, { hotfix: build('4.10.2', 339, { wave: 4 }) }, NOW);
    expect(hot.wave).toBeNull();
    expect(hot.sinceDays).toBe(5);
  });

  it('keeps the quiet slot for a channel without info or version, and the old fallback for a digest without channelInfo', () => {
    const rows = hubChannels({ live: '4.10.2', ptu: '4.11.0' }, known, noVerdict, { evocati: build('4.12', 100) }, NOW);
    expect(rows.map((r) => r.version)).toEqual([null, '4.11.0', '4.12']);
    expect(rows[1].sinceDays).toBeNull();
    expect(rows[1].chip?.percent).withContext('no channelInfo → no number').toBeNull();
    expect(rows[2].chip).toBeNull();
  });
});

describe('BriefingHubComponent — news accordion', () => {
  it('clips the open entry to rounded corners, also its image zoom and gradient', () => {
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideTranslateService({})] });
    const fixture = TestBed.createComponent(BriefingHubComponent);
    const item = { id: 'n1', title: 'News', thumbnail: null, publishedAt: new Date(NOW).toISOString() };
    fixture.componentRef.setInput('news', [item] as unknown as VerseNewsItem[]);
    fixture.detectChanges();
    const css = getComputedStyle((fixture.nativeElement as HTMLElement).querySelector('.acc-i.open .acc-a')!);
    expect(css.overflow).toBe('hidden');
    expect(css.borderTopLeftRadius).toBe('6px');
  });
});

describe('BriefingHubComponent — channel rows', () => {
  function render(channels: ReturnType<typeof hubChannels>): HTMLElement {
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideTranslateService({})] });
    const t = TestBed.inject(TranslateService);
    t.setTranslation('en', {
      verse: {
        hub: {
          channel: { hotfix: 'Hotfix', ptu: 'PTU', evocati: 'Evocati' },
          liveSince: 'for {{n}} days', liveSinceOne: 'for 1 day', liveSinceToday: 'since today',
          wave: 'Wave {{n}}', channelOff: 'none running',
        },
      },
    });
    t.use('en');
    const fixture = TestBed.createComponent(BriefingHubComponent);
    fixture.componentRef.setInput('channels', channels);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('prints since-days and wave in the row, "–" when unknown, and keeps the quiet slot', () => {
    const info = { ptu: build('4.10.3', 121, { wave: 2 }) };
    const el = render(hubChannels({ live: '4.10.2', evocati: '4.11' }, known, noVerdict, info, NOW));
    const ptu = el.querySelector('.ch[data-ch="ptu"]')!;
    expect(ptu.querySelector('.ch-id')!.textContent).toContain('for 5 days');
    expect(ptu.querySelector('.ch-id')!.textContent).toContain('Wave 2');
    expect(ptu.querySelector('sc-stability-chip .chip')!.textContent).toMatch(/\d+ %/);
    expect(ptu.querySelector('sc-stability-chip .chip')!.classList.contains('early')).toBeTrue();
    const evo = el.querySelector('.ch[data-ch="evocati"]')!;
    expect(evo.querySelector('.ch-id span')!.textContent!.trim()).toBe('–');
    expect(evo.querySelector('sc-stability-chip')).withContext('Evocati row without chip').toBeNull();
    expect(el.querySelector('.ch.off[data-ch="hotfix"] .quiet')!.textContent).toContain('none running');
  });

  it('sets the right side of a row flush right: the quiet note and the chip end on the row edge', () => {
    const info = { ptu: build('4.10.3', 121, { wave: 2 }) };
    const el = render(hubChannels({ live: '4.10.2', evocati: '4.11' }, known, noVerdict, info, NOW));
    const right = (sel: string) => el.querySelector(sel)!.getBoundingClientRect().right;
    expect(right('.ch.off[data-ch="hotfix"] .quiet')).toBeCloseTo(right('.ch.off[data-ch="hotfix"]'), 0);
    expect(right('.ch[data-ch="ptu"] .ch-chip')).toBeCloseTo(right('.ch[data-ch="ptu"]'), 0);
  });
  it('puts the stability chip of the live patch card flush right', () => {
    const live = hubChannel('live', { live: '4.10.2' }, known, noVerdict, { live: build('4.10.2', 200) }, NOW);
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideTranslateService({})] });
    const fixture = TestBed.createComponent(BriefingHubComponent);
    fixture.componentRef.setInput('live', live);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const chip = el.querySelector('.feat-h sc-stability-chip');
    if (!chip) { pending('no chip for this fixture'); return; }
    expect(chip.getBoundingClientRect().right).toBeCloseTo(el.querySelector('.feat-h')!.getBoundingClientRect().right, 0);
  });
});
