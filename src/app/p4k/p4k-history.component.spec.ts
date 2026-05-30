import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideTranslateService } from '@ngx-translate/core';
import { P4kHistoryComponent } from './p4k-history.component';
import { ChannelTag, P4kBundleRow, P4kService } from './p4k.service';
import { RoleService } from '../auth/role.service';

function row(channel: ChannelTag, patch: string, quality: number, created: string): P4kBundleRow {
  return {
    id: `${channel}-${patch}-${created}`,
    channel,
    patch_version: patch,
    build_number: '1',
    schema_version: 1,
    quality_score: quality,
    entity_counts: { ships: 100 },
    diff_summary: null,
    disabled: false,
    disabled_reason: null,
    tool_version: '0.4.5',
    uploaded_by_id: 'u',
    uploaded_by_email: 'u@example.com',
    uploaded_by_name: 'U',
    created_at: created,
  };
}

function setup(bundles: P4kBundleRow[]) {
  const svc = {
    bundles: signal(bundles),
    busy: signal(false),
    errorMsg: signal<string | null>(null),
    includeHistory: signal(false),
    includeDisabled: signal(false),
    listBundles: jasmine.createSpy('listBundles').and.resolveTo(undefined),
    toggleHistory: jasmine.createSpy('toggleHistory'),
    toggleDisabled: jasmine.createSpy('toggleDisabled'),
  };
  TestBed.configureTestingModule({
    imports: [P4kHistoryComponent],
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideTranslateService({ fallbackLang: 'en' }),
      { provide: P4kService, useValue: svc },
      { provide: RoleService, useValue: { isAdmin: signal(false) } },
    ],
  });
  const fixture = TestBed.createComponent(P4kHistoryComponent);
  fixture.detectChanges();
  return fixture;
}

describe('P4kHistoryComponent — summary card (rendered DOM)', () => {
  it('renders one row per channel: live first, then patch version descending', () => {
    const fixture = setup([
      row('ptu', '4.9.0', 70, '2026-05-01T00:00:00Z'),
      row('live', '4.8.0', 90, '2026-05-02T00:00:00Z'),
      row('eptu', '4.10.0', 55, '2026-05-03T00:00:00Z'),
    ]);
    const rows = Array.from(
      fixture.nativeElement.querySelectorAll('.summary-row'),
    ) as HTMLElement[];

    expect(rows.length).toBe(3);
    expect(rows.map((r) => r.querySelector('.ch-pill')!.textContent!.trim())).toEqual([
      'LIVE',
      'EPTU',
      'PTU',
    ]);
    // Patch version is shown next to the channel in every summary row.
    expect(rows.map((r) => r.querySelector('.sum-patch')!.textContent!.trim())).toEqual([
      '4.8.0',
      '4.10.0',
      '4.9.0',
    ]);
  });

  it('shows the patch-latest quality score, not a newer upload of an older patch', () => {
    const fixture = setup([
      row('live', '4.8.0', 90, '2026-05-01T00:00:00Z'),
      row('live', '4.7.0', 40, '2026-05-20T00:00:00Z'), // newer upload, older patch
    ]);
    const quality = fixture.nativeElement
      .querySelector('.summary-row .sum-quality')!
      .textContent!.trim();
    expect(quality).toBe('90');
  });
});
