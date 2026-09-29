import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { FakeCall, FakeResult, fakeSupabase } from '../testing/fake-supabase';
import { TelemetryStatsComponent } from './telemetry-stats.component';

const STATS = {
  generatedAt: 1_780_000_000_000,
  windowDays: 30,
  totals: { crashes: 12, usage: 3456, installs: 78, sessions: 901 },
  products: [
    { product: 'scc-app', events: 10, crashes: 1, usage: 5, installs: 2, sessions: 3, lastSeen: null },
  ],
  byVersion: [{ version: '1.2.3', crashes: 12, usage: 3456, sessions: 901 }],
  crashesByType: [],
  crashesByRole: [],
  recentCrashes: [],
};

describe('TelemetryStatsComponent', () => {
  async function mount(url: string, answer: (call: FakeCall) => FakeResult | Promise<FakeResult>) {
    const fake = fakeSupabase({ answer });
    TestBed.configureTestingModule({
      providers: [
        fake.provider,
        provideRouter([{ path: '', component: TelemetryStatsComponent }]),
        provideTranslateService({ fallbackLang: 'en' }),
      ],
    });
    const harness = await RouterTestingHarness.create(url);
    await settle(harness);
    return { harness, fake, el: harness.routeNativeElement as HTMLElement };
  }

  async function settle(harness: RouterTestingHarness) {
    harness.detectChanges();
    await harness.fixture.whenStable();
    for (let i = 0; i < 40; i++) await Promise.resolve();
    harness.detectChanges();
  }

  const statsCalls = (calls: FakeCall[]) => calls.filter((c) => c.op === 'rpc' && c.target === 'get_telemetry_stats');

  afterEach(() => TestBed.resetTestingModule());

  it('loads the default window across all products without a product filter', async () => {
    const { fake } = await mount('/', () => ({ data: STATS }));
    expect(statsCalls(fake.calls)[0].args).toEqual({ window_days: 30, product_filter: null });
  });

  it('passes the window and product from the URL to the RPC', async () => {
    const { fake } = await mount('/?days=90&product=starscape', () => ({ data: STATS }));
    expect(statsCalls(fake.calls)[0].args).toEqual({ window_days: 90, product_filter: 'starscape' });
  });

  it('falls back to 30 days for a window the control does not offer', async () => {
    const { fake } = await mount('/?days=5', () => ({ data: STATS }));
    expect(statsCalls(fake.calls)[0].args).toEqual({ window_days: 30, product_filter: null });
  });

  it('renders the totals of the answered stats', async () => {
    const { el } = await mount('/', () => ({ data: STATS }));
    const nums = Array.from(el.querySelectorAll('.totals .num')).map((n) => n.textContent!.trim());
    expect(nums).toEqual(['12', '3,456', '78', '901']);
    expect(el.querySelector('.err')).toBeNull();
  });

  it('shows the error key and no totals when the RPC fails', async () => {
    const { el } = await mount('/', () => ({ error: { message: 'boom', code: '57014' } }));
    expect(el.querySelector('.err')?.textContent).toContain('telemetry.errorTitle');
    expect(el.querySelector('.err')?.textContent).toContain('errors.timeout');
    expect(el.querySelector('.totals')).toBeNull();
    expect(el.querySelector('.empty')).toBeNull();
  });

  it('clears an earlier error after a successful reload', async () => {
    let fail = true;
    const { harness, el } = await mount('/', () => (fail ? { error: { message: 'x', code: '57014' } } : { data: STATS }));
    expect(el.querySelector('.err')).not.toBeNull();
    fail = false;
    await harness.routeDebugElement!.componentInstance.load(30, 'all');
    await settle(harness);
    expect(el.querySelector('.err')).toBeNull();
    expect(el.querySelector('.totals')).not.toBeNull();
  });
});
