import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { FakeCall, fakeSupabase } from '../../testing/fake-supabase';
import { AdminTranslationsComponent } from './translations.component';

const job = (id: string, status: string) => ({
  id,
  build_id: 'b1',
  lang: 'de',
  mode: 'delta',
  status,
  string_count: 10,
  estimate_usd: 1.5,
  spent_usd: 0.5,
  stats: { judge: { n: 2, mean: 4.5 } },
  error: null,
  created_at: '2026-10-29T10:00:00Z',
  build: { patch_version: '4.4', channel: 'LIVE', build_number: '1' },
});

describe('AdminTranslationsComponent', () => {
  function create(answer: (c: FakeCall) => { data?: unknown; error?: unknown }) {
    const fake = fakeSupabase({ answer });
    TestBed.configureTestingModule({
      imports: [AdminTranslationsComponent],
      providers: [fake.provider, provideTranslateService(), provideRouter([])],
    });
    const fixture = TestBed.createComponent(AdminTranslationsComponent);
    fixture.detectChanges();
    return fixture;
  }

  const ok = (c: FakeCall) => {
    switch (c.target) {
      case 'translation_settings':
        return { data: { enabled: false, upload_cap_usd: 20, monthly_cap_usd: 190 } };
      case 'translation_languages':
        return { data: [{ lang: 'de', cig_folder: 'german_(germany)', approved: true }, { lang: 'fr', cig_folder: 'french_(france)', approved: false }] };
      case 'translation_jobs':
        return { data: [job('j1', 'awaiting_approval'), job('j2', 'published')] };
      case 'translation_ledger':
        return { data: [{ usd: 10 }, { usd: '9.5' }] };
      default:
        return { data: [] };
    }
  };

  it('shows approve only on awaiting jobs, cancel on unfinished ones, and the month spend', async () => {
    const fixture = create(ok);
    await fixture.whenStable();
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const rows = Array.from(el.querySelectorAll('table.jobs tbody tr'));
    expect(rows.length).toBe(2);
    expect(rows[0].querySelectorAll('.actions button').length).toBe(2);
    expect(rows[1].querySelectorAll('.actions button').length).toBe(0);
    expect(fixture.componentInstance.spend()).toBe(19.5);
    expect(fixture.componentInstance.spendPct()).toBe(10);
    expect(el.querySelectorAll('.lang').length).toBe(2);
  });

  it('renders an error state with retry instead of the empty state when loading fails', async () => {
    const fixture = create((c) => (c.target === 'translation_jobs' ? { error: { message: 'down' } } : ok(c)));
    await fixture.whenStable();
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.state.error')).not.toBeNull();
    expect(el.querySelector('table.jobs')).toBeNull();
  });
});
