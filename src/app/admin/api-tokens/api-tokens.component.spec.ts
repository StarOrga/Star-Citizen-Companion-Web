import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { ScConfirmService } from '../../shared/dialog/sc-confirm.service';
import { ApiTokenRow, ApiTokensService, CreatedToken } from './api-tokens.service';
import { ApiTokensComponent } from './api-tokens.component';

const ROW_A: ApiTokenRow = {
  id: 'tok-a',
  name: 'CI pipeline',
  prefix: 'scc_a1b2',
  scopes: ['news:read', 'ships:read'],
  created_at: '2026-09-01T10:00:00Z',
  last_used_at: null,
  revoked_at: null,
};
const ROW_B: ApiTokenRow = { ...ROW_A, id: 'tok-b', name: 'Dashboard', prefix: 'scc_c3d4', scopes: ['*:read'] };

describe('ApiTokensComponent', () => {
  let svc: {
    list: jasmine.Spy;
    create: jasmine.Spy;
    revoke: jasmine.Spy;
  };
  let confirm: jasmine.Spy;

  async function mount(rows: ApiTokenRow[] = [ROW_A, ROW_B]) {
    svc = {
      list: jasmine.createSpy('list').and.resolveTo(rows),
      create: jasmine.createSpy('create'),
      revoke: jasmine.createSpy('revoke').and.resolveTo(undefined),
    };
    confirm = jasmine.createSpy('confirm').and.resolveTo(true);
    await TestBed.configureTestingModule({
      imports: [ApiTokensComponent],
      providers: [
        provideTranslateService({ fallbackLang: 'en' }),
        { provide: ApiTokensService, useValue: svc },
        { provide: ScConfirmService, useValue: { confirm } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(ApiTokensComponent);
    await settle(fixture);
    return fixture;
  }

  async function settle(fixture: ComponentFixture<ApiTokensComponent>) {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const q = (f: ComponentFixture<unknown>, sel: string) => (f.nativeElement as HTMLElement).querySelector(sel);
  const qa = (f: ComponentFixture<unknown>, sel: string) =>
    Array.from((f.nativeElement as HTMLElement).querySelectorAll(sel));

  afterEach(() => TestBed.resetTestingModule());

  it('renders one row per token with its prefix and scopes', async () => {
    const f = await mount();
    const rows = qa(f, 'tbody tr');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('CI pipeline');
    expect(rows[0].textContent).toContain('scc_a1b2');
    expect(rows[0].querySelectorAll('.scope-pill').length).toBe(2);
    expect(rows[0].textContent).toContain('admin.tokens.neverUsed');
  });

  it('shows the empty state for an empty list', async () => {
    const f = await mount([]);
    expect(q(f, 'table')).toBeNull();
    expect(q(f, '.empty')?.textContent).toContain('admin.tokens.empty');
  });

  it('shows the error key and no empty state when loading fails', async () => {
    const f = await mount();
    svc.list.and.rejectWith(Object.assign(new Error('list_failed'), { status: 500 }));
    await f.componentInstance.refresh();
    await settle(f);
    expect(q(f, '.err')?.textContent).toContain('errors.server');
    expect(f.componentInstance.loadError()).toBe('errors.server');
  });

  it('create shows the plaintext token exactly once', async () => {
    const f = await mount([ROW_A]);
    const created: CreatedToken = { plaintext: 'scc_secret_plaintext', token: ROW_B };
    svc.create.and.resolveTo(created);
    svc.list.and.resolveTo([ROW_A, ROW_B]);

    (q(f, '.head-actions button') as HTMLButtonElement).click();
    await settle(f);
    const name = q(f, '.dialog input[type="text"]') as HTMLInputElement;
    name.value = '  Bot  ';
    name.dispatchEvent(new Event('input'));
    (q(f, '.dialog input[type="checkbox"]') as HTMLInputElement).click();
    await settle(f);
    (q(f, '.dialog form') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
    await settle(f);

    expect(svc.create).toHaveBeenCalledOnceWith('Bot', ['news:read']);
    expect(q(f, '.reveal-token')?.textContent).toContain('scc_secret_plaintext');
    expect(qa(f, 'tbody tr').length).toBe(2);
    expect((f.nativeElement as HTMLElement).textContent!.split('scc_secret_plaintext').length - 1).toBe(1);

    (q(f, '.reveal-dialog .sc-btn-primary') as HTMLButtonElement).click();
    await settle(f);
    expect(q(f, '.reveal-token')).toBeNull();
    expect((f.nativeElement as HTMLElement).textContent).not.toContain('scc_secret_plaintext');
  });

  it('keeps the create dialog open and shows the error key when creating fails', async () => {
    const f = await mount([]);
    svc.create.and.rejectWith(Object.assign(new Error('forbidden'), { status: 403, code: 'forbidden' }));
    (q(f, '.head-actions button') as HTMLButtonElement).click();
    await settle(f);
    const name = q(f, '.dialog input[type="text"]') as HTMLInputElement;
    name.value = 'Bot';
    name.dispatchEvent(new Event('input'));
    (q(f, '.dialog input[type="checkbox"]') as HTMLInputElement).click();
    await settle(f);
    (q(f, '.dialog form') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
    await settle(f);
    expect(q(f, '.dialog .err')?.textContent).toContain('errors.forbidden');
    expect(q(f, '.reveal-token')).toBeNull();
  });

  it('does not create without a name and at least one scope', async () => {
    const f = await mount([]);
    (q(f, '.head-actions button') as HTMLButtonElement).click();
    await settle(f);
    const submit = q(f, '.dialog button[type="submit"]') as HTMLButtonElement;
    expect(submit.disabled).toBeTrue();
    await f.componentInstance.onCreateSubmit(new Event('submit', { cancelable: true }));
    expect(svc.create).not.toHaveBeenCalled();
  });

  it('asks before revoking and revokes after a confirm', async () => {
    const f = await mount();
    (q(f, 'tbody tr .danger') as HTMLButtonElement).click();
    await settle(f);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.calls.mostRecent().args[0]).toEqual(
      jasmine.objectContaining({ params: { name: 'CI pipeline' }, tone: 'danger' }),
    );
    expect(svc.revoke).toHaveBeenCalledOnceWith('tok-a');
    expect(q(f, '.flash.success')).not.toBeNull();
    expect(svc.list).toHaveBeenCalledTimes(2);
  });

  it('does not revoke when the confirm is declined', async () => {
    const f = await mount();
    confirm.and.resolveTo(false);
    (q(f, 'tbody tr .danger') as HTMLButtonElement).click();
    await settle(f);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(svc.revoke).not.toHaveBeenCalled();
    expect(q(f, '.flash')).toBeNull();
  });

  it('shows an error flash when the revoke fails', async () => {
    const f = await mount();
    svc.revoke.and.rejectWith(Object.assign(new Error('revoke_failed'), { status: 500 }));
    (q(f, 'tbody tr .danger') as HTMLButtonElement).click();
    await settle(f);
    expect(q(f, '.flash.error')?.textContent).toContain('admin.tokens.revokeError');
    expect(f.componentInstance.revokingId()).toBeNull();
  });
});
