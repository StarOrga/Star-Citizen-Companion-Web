import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { signal } from '@angular/core';

import { PatchNoteDetailComponent } from './patch-note-detail.component';
import { RoadmapService } from './roadmap.service';
import { PatchStabilityService } from './patch-stability.service';
import { PatchOutline } from './patch-outline';

const OUTLINE: PatchOutline = {
  slug: 'alpha-4-9',
  subject: 'Alpha 4.9',
  bulletCount: 2,
  truncated: false,
  nodes: [
    { kind: 'heading', text: 'Features', depth: 0, links: ['https://x.test/full'] },
    { kind: 'subheading', text: 'Ships', depth: 0 },
    { kind: 'bullet', text: 'Added the Zeta', depth: 0 },
    { kind: 'bullet', text: 'Fixed the Eta', depth: 1, links: ['https://x.test/issue'] },
  ],
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

describe('PatchNoteDetailComponent', () => {
  let roadmap: FakeRoadmap;

  beforeEach(() => {
    roadmap = new FakeRoadmap();
    TestBed.configureTestingModule({
      imports: [PatchNoteDetailComponent],
      providers: [
        provideTranslateService({}),
        { provide: RoadmapService, useValue: roadmap },
        { provide: PatchStabilityService, useValue: { patchRowFor: () => null, verdictFor: () => null } },
      ],
    });
  });

  function render(tokens: string[] = []) {
    const f = TestBed.createComponent(PatchNoteDetailComponent);
    f.componentRef.setInput('slug', 'alpha-4-9');
    f.componentRef.setInput('url', 'https://x.test/thread/alpha-4-9');
    f.componentRef.setInput('tokens', tokens);
    f.detectChanges();
    return f;
  }
  const text = (f: { nativeElement: HTMLElement }, sel: string) => f.nativeElement.querySelector(sel)?.textContent?.trim();

  it('requests its own outline as soon as it renders', () => {
    render();
    expect(roadmap.requestOutlines).toHaveBeenCalledWith(['alpha-4-9']);
  });

  it('shows the loading state while the outline is pending', () => {
    roadmap.pending.set(new Set(['alpha-4-9']));
    const f = render();
    expect(text(f, '.pn-state')).toBe('news.patch.detail.loading');
    expect(f.nativeElement.querySelector('.pn-sections')).toBeNull();
  });

  it('shows the outline: heading, sub-heading, bullets and out-links', () => {
    roadmap.outlines.set(new Map([[OUTLINE.slug, OUTLINE]]));
    const f = render();
    const el = f.nativeElement as HTMLElement;
    expect(text(f, '.pn-heading')).toBe('Features');
    expect(text(f, '.pn-sub')).toBe('Ships');
    const lines = Array.from(el.querySelectorAll('.pn-line'));
    expect(lines.map((l) => l.querySelector('.pn-text')!.textContent!.trim())).toEqual(['Added the Zeta', 'Fixed the Eta']);
    expect(lines[1].getAttribute('data-depth')).toBe('1');
    // Off-site links are real anchors that open a new tab.
    const out = el.querySelector<HTMLAnchorElement>('.pn-line a.pn-link')!;
    expect(out.getAttribute('href')).toBe('https://x.test/issue');
    expect(out.target).toBe('_blank');
    expect(out.rel).toContain('noopener');
  });

  it('shows "unavailable" for a note without contents, and the RSI link stays', () => {
    const f = render();
    expect(text(f, '.pn-state')).toBe('news.patch.detail.unavailable');
    const src = (f.nativeElement as HTMLElement).querySelector<HTMLAnchorElement>('.pn-source')!;
    expect(src.getAttribute('href')).toBe('https://x.test/thread/alpha-4-9');
  });

  it('narrows to the query, marks hits, and says so when nothing matches', () => {
    roadmap.outlines.set(new Map([[OUTLINE.slug, OUTLINE]]));
    const f = render(['zeta']);
    expect(f.nativeElement.querySelectorAll('.pn-line').length).toBe(1);
    expect(text(f, 'mark')?.toLowerCase()).toBe('zeta');

    const none = render(['nonexistent']);
    expect(text(none, '.pn-state')).toBe('news.patch.detail.noMatch');
  });

  it('flags a truncated outline', () => {
    roadmap.outlines.set(new Map([[OUTLINE.slug, { ...OUTLINE, truncated: true }]]));
    const f = render();
    expect(f.nativeElement.textContent).toContain('news.patch.detail.truncated');
  });
});
