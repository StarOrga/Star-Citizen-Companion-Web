import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { FakeCall, FakeResult, fakeSupabase } from '../testing/fake-supabase';
import { SilhouetteCoverageComponent } from './silhouette-coverage.component';

const COVERAGE = {
  build: { id: 'b1', channel: 'LIVE', patch_version: '4.10.0', build_number: 'desktop' },
  total: 355,
  with_silhouette: 332,
  with_anchors: 0,
  without_silhouette: 23,
  fallback_icon: 12,
  fallback_none: 11,
  missing: [
    { class_name: 'AEGS_Idris_M', name: 'Idris-M' },
    { class_name: 'XNAA_SanTokYai', name: null },
  ],
};

describe('SilhouetteCoverageComponent', () => {
  let fixture: ComponentFixture<SilhouetteCoverageComponent>;

  async function mount(answer: (call: FakeCall) => FakeResult | Promise<FakeResult>) {
    const fake = fakeSupabase({ answer });
    TestBed.configureTestingModule({
      imports: [SilhouetteCoverageComponent],
      providers: [fake.provider, provideRouter([]), provideTranslateService({ fallbackLang: 'en' })],
    });
    fixture = TestBed.createComponent(SilhouetteCoverageComponent);
    await settle();
    return { fake, el: fixture.nativeElement as HTMLElement };
  }

  async function settle() {
    fixture.detectChanges();
    await fixture.whenStable();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    fixture.detectChanges();
  }

  const coverageCalls = (calls: FakeCall[]) =>
    calls.filter((c) => c.op === 'rpc' && c.target === 'silhouette_coverage');

  afterEach(() => TestBed.resetTestingModule());

  it('asks for the current build and renders the four counts', async () => {
    const { fake, el } = await mount(() => ({ data: COVERAGE }));
    expect(coverageCalls(fake.calls)[0].args).toEqual({ p_build_id: null });
    const nums = Array.from(el.querySelectorAll('.num-cell b')).map((b) => b.textContent!.trim());
    expect(nums).toEqual(['355', '332', '0', '23']);
    expect(fixture.componentInstance.percent()).toBe(94);
    const fill = el.querySelector<HTMLElement>('.bar .fill')!;
    expect(fill.style.width).toBe('94%');
  });

  it('links every hull without a silhouette to its Codex page with a real anchor', async () => {
    const { el } = await mount(() => ({ data: COVERAGE }));
    const links = Array.from(el.querySelectorAll<HTMLAnchorElement>('.missing a'));
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/codex/ship/AEGS_Idris_M',
      '/codex/ship/XNAA_SanTokYai',
    ]);
    // A row without a name falls back to its class name.
    expect(links[1].textContent!.trim()).toBe('XNAA_SanTokYai');
  });

  it('hides the missing list when every hull has a silhouette', async () => {
    const full = { ...COVERAGE, with_silhouette: 355, without_silhouette: 0, fallback_icon: 0, fallback_none: 0, missing: [] };
    const { el } = await mount(() => ({ data: full }));
    expect(el.querySelector('.missing')).toBeNull();
    expect(fixture.componentInstance.percent()).toBe(100);
  });

  it('shows the no-build state, not zeros, when the RPC answers null', async () => {
    const { el } = await mount(() => ({ data: null }));
    expect(el.querySelector('.nums')).toBeNull();
    expect(el.querySelector('.empty')!.textContent).toContain('admin.silhouettes.noBuild');
    expect(el.querySelector('.err')).toBeNull();
  });

  it('renders an error state with retry on failure and recovers on retry', async () => {
    let fail = true;
    const { fake, el } = await mount(() =>
      fail ? { data: null, error: { message: 'forbidden: admin role required', code: '42501' } } : { data: COVERAGE },
    );
    expect(el.querySelector('.err')).not.toBeNull();
    expect(el.querySelector('.empty')).toBeNull();
    expect(el.querySelector('.nums')).toBeNull();

    fail = false;
    el.querySelector<HTMLButtonElement>('.err button')!.click();
    await settle();
    expect(coverageCalls(fake.calls).length).toBe(2);
    expect(el.querySelector('.err')).toBeNull();
    expect(el.querySelectorAll('.num-cell').length).toBe(4);
  });
});
