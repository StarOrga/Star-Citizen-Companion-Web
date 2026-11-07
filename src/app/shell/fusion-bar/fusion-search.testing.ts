// Test harness for FusionSearchComponent specs: a stand-in engine whose
// `result()` is the real composer over fixture groups, and stub services.
// Only imported by specs.

import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { AuthService } from '../../auth/auth.service';
import { CodexBuildDiffService } from '../../codex/codex-build-diff.service';
import type { PolyHitKind, PolySearchHit } from '../../codex/codex-poly-search';
import { CodexService } from '../../codex/codex.service';
import { CodexSearchEngine } from '../../codex/search/codex-search-engine';
import { CodexSearchHub } from '../../codex/search/codex-search-hub.service';
import type { CodexSearchGroup } from '../../codex/search/codex-search-model';
import { ComposeInput, composeSearchResult } from '../../codex/search/search-compose';
import type { SearchChip } from '../../codex/search/search-result-model';
import { SearchWishlistService } from '../../codex/search/search-wishlist.service';
import { HangarService } from '../../hangar/hangar.service';
import { HqOwnershipService } from '../../hq/hq-ownership.service';
import { FusionSearchComponent } from './fusion-search.component';
import { SearchContext, neutralContext } from './search-context';
import { ItemPathService } from '../../hq/data/item-path.service';
import { fakeItemPath } from '../../shared/item-path/item-path.testing';
import { SearchRowActionsService } from './search-row-actions.service';

export function fxHit(kind: PolyHitKind, slug: string, name: string, extra: Partial<PolySearchHit> = {}): PolySearchHit {
  return { kind, classNameSlug: slug, nameLocalized: name, manufacturerCode: null, manufacturerName: null, size: null, grade: null, scope: 'equipment', ...extra };
}

export function fxGroup(kind: PolyHitKind, hits: PolySearchHit[], total = hits.length): CodexSearchGroup {
  return { kind, hits, total, count: total, countIsFloor: false, folded: 0, foldedIsFloor: false, more: null };
}

export interface FakeEngineInit {
  groups?: CodexSearchGroup[];
  context?: SearchContext;
  extraChips?: SearchChip[];
  compose?: Partial<ComposeInput>;
}

/** A stand-in engine: debounce-free input, the real composer over fixture groups. */
export function fakeEngine(init: FakeEngineInit = {}) {
  const input = signal('');
  const groups = signal<CodexSearchGroup[]>(init.groups ?? []);
  const context = signal<SearchContext>(init.context ?? neutralContext());
  const removed = signal<string[]>([]);
  const extraChips = signal<SearchChip[]>(init.extraChips ?? []);
  const compose = signal<Partial<ComposeInput>>(init.compose ?? {});
  const calls = { setChipValue: [] as [string, string][], removeLastChip: 0, noteOpened: 0, setContext: 0 };
  const activeChips = computed(() => [...context().chips, ...extraChips()].filter((c) => !removed().includes(c.id)));
  const result = computed(() =>
    composeSearchResult({ term: input(), groups: input().trim() ? groups() : [], context: context(), chips: activeChips(), signedIn: true, ...compose() }),
  );
  return {
    input,
    term: input,
    loading: signal(false),
    error: signal<string | null>(null),
    groups,
    recent: signal<string[]>([]),
    context,
    result,
    activeChips,
    calls,
    extraChips,
    compose,
    readings: signal<{ aliases: { word: string; to: string }[]; chips: { word: string; chip: SearchChip }[] }>({ aliases: [], chips: [] }),
    lang: () => 'de' as const,
    setInput: (v: string) => input.set(v),
    setContext: (c: SearchContext) => {
      calls.setContext++;
      if (!init.context) context.set(c);
    },
    ensureSuggestions: () => undefined,
    ensureSources: () => undefined,
    clear: () => input.set(''),
    retry: () => undefined,
    commit: () => false,
    remember: () => undefined,
    searchFor: (t: string) => input.set(t),
    noteOpened: () => {
      calls.noteOpened++;
    },
    removeChip: (id: string) => removed.set([...removed(), id]),
    removeLastChip: () => {
      calls.removeLastChip++;
      const last = activeChips().at(-1);
      if (last) removed.set([...removed(), last.id]);
      return last?.id ?? null;
    },
    setChipValue: (id: string, value: string) => {
      calls.setChipValue.push([id, value]);
    },
    href: () => '/x',
  };
}

export type FakeEngine = ReturnType<typeof fakeEngine>;

export function fakeActions() {
  return {
    cta: jasmine.createSpy('cta').and.resolveTo(null),
  };
}

/** Configure TestBed for FusionSearchComponent with the given engine. */
export function setupFusionSearch(engine: FakeEngine, actions = fakeActions(), path = fakeItemPath()) {
  TestBed.configureTestingModule({
    imports: [FusionSearchComponent],
    providers: [
      provideTranslateService(),
      provideRouter([]),
      { provide: AuthService, useValue: { user: signal(null) } },
      { provide: CodexService, useValue: { isPinned: () => false, build: signal(null), silhouettes: async () => new Map() } },
      { provide: CodexBuildDiffService, useValue: { addedClassNamesMemo: async () => [] } },
      { provide: HangarService, useValue: { ships: signal([]), flagshipClassName: () => null } },
      { provide: HqOwnershipService, useValue: { ensureLoaded: async () => undefined, ownsShip: () => false } },
      { provide: SearchWishlistService, useValue: { ensureLoaded: () => undefined, has: () => false } },
      { provide: SearchRowActionsService, useValue: actions },
      { provide: ItemPathService, useValue: path },
      { provide: CodexSearchHub, useValue: { register: () => () => undefined, hasBar: () => false, activate: () => false } },
    ],
  });
  TestBed.overrideComponent(FusionSearchComponent, {
    set: { providers: [{ provide: CodexSearchEngine, useValue: engine }] },
  });
  const fixture = TestBed.createComponent(FusionSearchComponent);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const field = el.querySelector('input.input') as HTMLInputElement;
  const type = (v: string) => {
    field.value = v;
    field.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };
  const key = (k: string, extra: KeyboardEventInit = {}) => {
    field.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra }));
    fixture.detectChanges();
  };
  return { fixture, el, field, type, key, cmp: fixture.componentInstance, actions };
}
