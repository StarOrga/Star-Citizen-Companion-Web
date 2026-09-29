import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { signal } from '@angular/core';

import { PatchEntryRowComponent } from './patch-entry-row.component';
import { RoadmapService } from './roadmap.service';
import { PatchStabilityService } from './patch-stability.service';
import { PatchNoteEntry } from './patch-notes';
import { PatchOutline } from './patch-outline';

const URL = 'https://x.test/forum/1/thread/alpha-4-9-live';

const entry = (over: Partial<PatchNoteEntry> = {}): PatchNoteEntry => ({
  item: {
    id: 'n1', title: 'Star Citizen Alpha 4.9 Live', url: URL, publishedAt: '2026-09-01T00:00:00Z',
    channel: 'patch', source: 'spectrum',
  },
  version: '4.9', segments: [4, 9], stage: 'live', hotfix: false, facet: 'live', ...over,
});

const OUTLINE: PatchOutline = {
  slug: 'alpha-4-9-live', subject: 's', bulletCount: 3, truncated: false,
  nodes: [{ kind: 'bullet', text: 'Fixed the Eta', depth: 0 }],
};

class FakeRoadmap {
  readonly outlines = signal<ReadonlyMap<string, PatchOutline>>(new Map());
  readonly pending = signal<ReadonlySet<string>>(new Set());
  readonly requestOutlines = jasmine.createSpy('requestOutlines');
  outlineFor(slug: string): PatchOutline | null {
    return this.outlines().get(slug) ?? null;
  }
  isPending(slug: string): boolean {
    return this.pending().has(slug);
  }
}

describe('PatchEntryRowComponent', () => {
  let roadmap: FakeRoadmap;

  beforeEach(() => {
    roadmap = new FakeRoadmap();
    TestBed.configureTestingModule({
      imports: [PatchEntryRowComponent],
      providers: [
        provideTranslateService({}),
        { provide: RoadmapService, useValue: roadmap },
        { provide: PatchStabilityService, useValue: { patchRowFor: () => null, verdictFor: () => null } },
      ],
    });
  });

  function render(inputs: Record<string, unknown> = {}) {
    const f = TestBed.createComponent(PatchEntryRowComponent);
    f.componentRef.setInput('entry', entry());
    f.componentRef.setInput('when', 'news.relative.now');
    for (const [k, v] of Object.entries(inputs)) f.componentRef.setInput(k, v);
    f.detectChanges();
    return f;
  }
  const $ = (f: { nativeElement: HTMLElement }, sel: string) => f.nativeElement.querySelector<HTMLElement>(sel);

  it('renders a collapsed row: title, version, stage, time, and a separate RSI anchor', () => {
    const f = render();
    expect($(f, '.title')!.textContent!.replace(/\s+/g, ' ').trim()).toBe('Star Citizen Alpha 4.9 Live');
    expect($(f, '.tag.ver')!.textContent!.trim()).toBe('4.9');
    expect($(f, '[data-stage]')!.textContent!.trim()).toBe('news.patch.stage.live');
    expect($(f, 'time')!.textContent!.trim()).toBe('news.relative.now');
    expect($(f, '.main')!.getAttribute('aria-expanded')).toBe('false');
    const a = $(f, 'a.rsi') as HTMLAnchorElement;
    expect(a.getAttribute('href')).toBe(URL);
    expect(a.target).toBe('_blank');
    expect(f.nativeElement.querySelector('sc-patch-note-detail')).toBeNull();
  });

  it('emits the entry id when the row button is clicked', () => {
    const f = render();
    const ids: string[] = [];
    f.componentInstance.toggled.subscribe((id) => ids.push(id));
    $(f, '.main')!.click();
    expect(ids).toEqual(['n1']);
  });

  it('hides version and stage tags when compact, keeps the time', () => {
    const f = render({ compact: true });
    expect($(f, '.tag.ver')).toBeNull();
    expect($(f, '[data-stage]')).toBeNull();
    expect($(f, 'time')).not.toBeNull();
  });

  it('shows a hotfix tag for hotfix entries', () => {
    const f = render({ entry: entry({ hotfix: true, facet: 'hotfix' }) });
    expect($(f, '.tag.hotfix')!.textContent!.trim()).toBe('news.patch.hotfix');
  });

  it('expanded: shows the loading state, then the outline, then "unavailable"', () => {
    roadmap.pending.set(new Set(['alpha-4-9-live']));
    const f = render({ open: true });
    expect($(f, '.main')!.getAttribute('aria-expanded')).toBe('true');
    expect($(f, 'sc-patch-note-detail .pn-state')!.textContent!.trim()).toBe('news.patch.detail.loading');
    expect(roadmap.requestOutlines).toHaveBeenCalledWith(['alpha-4-9-live']);

    roadmap.pending.set(new Set());
    roadmap.outlines.set(new Map([[OUTLINE.slug, OUTLINE]]));
    f.detectChanges();
    expect($(f, 'sc-patch-note-detail .pn-line')).not.toBeNull();
    // The bullet count appears on the collapsed line once contents are known.
    expect($(f, '.tag.pts')!.textContent).toContain('news.patch.detail.points');

    roadmap.outlines.set(new Map());
    f.detectChanges();
    expect($(f, 'sc-patch-note-detail .pn-state')!.textContent!.trim()).toBe('news.patch.detail.unavailable');
  });

  it('highlights query tokens in the title', () => {
    const f = render({ tokens: ['alpha'] });
    expect($(f, 'mark')!.textContent).toBe('Alpha');
  });

  it('shows a hit count for loaded contents', () => {
    roadmap.outlines.set(new Map([[OUTLINE.slug, OUTLINE]]));
    const f = render({ tokens: ['eta'] });
    // "Eta" only hits inside the note (the title has none): the hits tag wins over the points tag.
    expect($(f, 'mark')).toBeNull();
    expect($(f, '.tag.hits')).not.toBeNull();
    expect($(f, '.tag.pts')).toBeNull();
  });
});
