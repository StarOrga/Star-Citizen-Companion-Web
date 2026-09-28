import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withXhr } from '@angular/common/http';
import { provideTranslateService } from '@ngx-translate/core';
import { P4kHistoryComponent } from './p4k-history.component';
import { ChannelTag, P4kBundleRow, P4kService } from './p4k.service';
import { RoleService } from '../auth/role.service';
import { ScConfirmService } from '../shared/dialog/sc-confirm.service';

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
    superseded_at: null,
  };
}

function setup(bundles: P4kBundleRow[], isAdmin = false) {
  return setupWithMocks(bundles, isAdmin).fixture;
}

/** Same page, plus the service and dialog mocks for the admin actions. */
function setupWithMocks(bundles: P4kBundleRow[], isAdmin = false) {
  const dialog = {
    confirm: jasmine.createSpy('confirm').and.resolveTo(true),
    prompt: jasmine.createSpy('prompt').and.resolveTo(''),
  };
  const svc = {
    setDisabled: jasmine.createSpy('setDisabled').and.resolveTo(undefined),
    deleteBundle: jasmine.createSpy('deleteBundle').and.resolveTo(undefined),
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
      provideHttpClient(withXhr()),
      provideTranslateService({ fallbackLang: 'en' }),
      { provide: P4kService, useValue: svc },
      { provide: RoleService, useValue: { isAdmin: signal(isAdmin) } },
      { provide: ScConfirmService, useValue: dialog },
    ],
  });
  const fixture = TestBed.createComponent(P4kHistoryComponent);
  fixture.detectChanges();
  return { fixture, svc, dialog };
}

describe('P4kHistoryComponent — patch cards (redesigned entries)', () => {
  it('renders one patch card per patch version, newest first', () => {
    const el = setup([
      row('live', '4.8.0', 90, '2026-05-02T00:00:00Z'),
      row('ptu', '4.10.0', 70, '2026-05-01T00:00:00Z'),
    ]).nativeElement as HTMLElement;
    const cards = Array.from(el.querySelectorAll('.hist-list .patch')) as HTMLElement[];
    expect(cards.length).toBe(2);
    expect(cards.map((c) => c.querySelector('.patch-ver')!.textContent!.trim())).toEqual([
      '4.10.0',
      '4.8.0',
    ]);
  });

  it('reveals the per-upload rows only after the patch card is expanded', () => {
    const fixture = setup([
      row('live', '4.8.0', 90, '2026-05-01T00:00:00Z'),
      row('ptu', '4.8.0', 60, '2026-05-02T00:00:00Z'),
    ]);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('.up-row').length).toBe(0);

    (el.querySelector('.patch-main') as HTMLElement).click();
    fixture.detectChanges();

    // Both uploads for the single 4.8.0 patch group are now shown.
    expect(el.querySelectorAll('.up-row').length).toBe(2);
  });

  it('renders admin actions on the upload rows only for admins', () => {
    const fixture = setup([row('live', '4.8.0', 90, '2026-05-01T00:00:00Z')], true);
    const el = fixture.nativeElement as HTMLElement;
    (el.querySelector('.patch-main') as HTMLElement).click();
    fixture.detectChanges();
    expect(el.querySelector('.up-row .acts')).toBeTruthy();
  });
});

describe('P4kHistoryComponent — superseded vs disabled', () => {
  const supersededRow = (): P4kBundleRow => ({
    ...row('live', '4.8.0', 88, '2026-06-01T00:00:00Z'),
    disabled: true,
    superseded_at: '2026-07-01T00:00:00Z',
    disabled_reason: 'superseded by tool 0.9.0',
  });
  const manualDisabledRow = (): P4kBundleRow => ({
    ...row('live', '4.8.0', 88, '2026-06-01T00:00:00Z'),
    disabled: true,
    superseded_at: null,
    disabled_reason: 'bad extract',
  });

  it('isSuperseded is true only for auto-retired (superseded_at set) rows', () => {
    const c = setup([]).componentInstance;
    expect(c.isSuperseded(supersededRow())).toBe(true);
    expect(c.isSuperseded(manualDisabledRow())).toBe(false); // manual moderation disable
    expect(c.isSuperseded(row('live', '4.8.0', 88, '2026-06-01T00:00:00Z'))).toBe(false); // active
  });

  it('renders a Superseded badge on a fully-superseded patch card', () => {
    const el = setup([supersededRow()]).nativeElement as HTMLElement;
    expect(el.querySelector('.patch.superseded')).toBeTruthy();
    expect(el.querySelector('.patch-ver .badge')).toBeTruthy();
  });

  it('renders no Superseded badge on an active patch card', () => {
    const el = setup([row('live', '4.8.0', 88, '2026-06-01T00:00:00Z')]).nativeElement as HTMLElement;
    expect(el.querySelector('.badge')).toBeNull();
  });
});

describe('P4kHistoryComponent — admin actions ask in the app dialog', () => {
  const bundle = () => row('live', '4.8.0', 88, '2026-06-01T00:00:00Z');

  it('does not disable when the reason prompt is cancelled', async () => {
    const { fixture, svc, dialog } = setupWithMocks([bundle()], true);
    dialog.prompt.and.resolveTo(null);
    await fixture.componentInstance.disable(bundle());
    expect(dialog.prompt).toHaveBeenCalledWith(
      jasmine.objectContaining({ titleKey: 'p4k.prompts.disableTitle', inputLabelKey: 'p4k.prompts.reasonLabel' }),
    );
    expect(svc.setDisabled).not.toHaveBeenCalled();
  });

  it('disables with the trimmed reason', async () => {
    const { fixture, svc, dialog } = setupWithMocks([bundle()], true);
    dialog.prompt.and.resolveTo(' alt ');
    const b = bundle();
    await fixture.componentInstance.disable(b);
    expect(svc.setDisabled).toHaveBeenCalledWith(b.id, true, 'alt');
  });

  it('disables with null for an empty reason', async () => {
    const { fixture, svc, dialog } = setupWithMocks([bundle()], true);
    dialog.prompt.and.resolveTo('   ');
    const b = bundle();
    await fixture.componentInstance.disable(b);
    expect(svc.setDisabled).toHaveBeenCalledWith(b.id, true, null);
  });

  it('does not delete when the question is cancelled', async () => {
    const { fixture, svc, dialog } = setupWithMocks([bundle()], true);
    dialog.confirm.and.resolveTo(false);
    await fixture.componentInstance.remove(bundle());
    expect(dialog.confirm).toHaveBeenCalledWith(
      jasmine.objectContaining({ titleKey: 'p4k.prompts.deleteTitle', tone: 'danger' }),
    );
    expect(svc.deleteBundle).not.toHaveBeenCalled();
  });

  it('re-enables only after confirmation', async () => {
    const { fixture, svc, dialog } = setupWithMocks([bundle()], true);
    const b = bundle();
    dialog.confirm.and.resolveTo(false);
    await fixture.componentInstance.reenable(b);
    expect(svc.setDisabled).not.toHaveBeenCalled();
    dialog.confirm.and.resolveTo(true);
    await fixture.componentInstance.reenable(b);
    expect(svc.setDisabled).toHaveBeenCalledWith(b.id, false, null);
  });
});
