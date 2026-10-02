import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideTranslateService } from '@ngx-translate/core';
import { CodexShipLinkFormComponent } from './codex-ship-link-form.component';
import { ShipLinkFormStore } from './ship-link-form.store';
import { RoleService } from '../../auth/role.service';

describe('CodexShipLinkFormComponent', () => {
  function makeStore() {
    return {
      input: signal(''),
      error: signal<string | null>(null),
      saving: signal(false),
      saved: signal(false),
      myPledgeLink: signal<string | null>(null),
      globalPledgeLink: signal<string | null>(null),
      onInput: jasmine.createSpy('onInput'),
      save: jasmine.createSpy('save').and.resolveTo(undefined),
      remove: jasmine.createSpy('remove'),
      toggle: jasmine.createSpy('toggle'),
      promote: jasmine.createSpy('promote'),
      unpromote: jasmine.createSpy('unpromote'),
    };
  }

  async function setup(admin = false) {
    const store = makeStore();
    await TestBed.configureTestingModule({
      imports: [CodexShipLinkFormComponent],
      providers: [
        provideTranslateService({}),
        { provide: ShipLinkFormStore, useValue: store },
        { provide: RoleService, useValue: { isAdmin: signal(admin) } },
      ],
    }).compileComponents();
    const fixture: ComponentFixture<CodexShipLinkFormComponent> = TestBed.createComponent(CodexShipLinkFormComponent);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement, store };
  }

  function buttonByText(el: HTMLElement, key: string): HTMLButtonElement | undefined {
    return Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.includes(key));
  }

  afterEach(() => TestBed.resetTestingModule());

  it('forwards typing to the store and saves on submit without a page reload', async () => {
    const { el, store } = await setup();
    const input = el.querySelector('input.sl-input') as HTMLInputElement;
    input.value = 'https://robertsspaceindustries.com/pledge/ships/gladius';
    input.dispatchEvent(new Event('input'));
    expect(store.onInput).toHaveBeenCalledWith('https://robertsspaceindustries.com/pledge/ships/gladius');

    const submit = new Event('submit', { cancelable: true });
    (el.querySelector('form') as HTMLFormElement).dispatchEvent(submit);
    expect(store.save).toHaveBeenCalledTimes(1);
    expect(submit.defaultPrevented).toBeTrue();
  });

  it('cancel toggles the form shut; remove appears only with an own link', async () => {
    const { fixture, el, store } = await setup();
    expect(buttonByText(el, 'codex.shipLink.remove')).toBeUndefined();
    buttonByText(el, 'codex.shipLink.cancel')!.click();
    expect(store.toggle).toHaveBeenCalledTimes(1);

    store.myPledgeLink.set('https://robertsspaceindustries.com/x');
    fixture.detectChanges();
    buttonByText(el, 'codex.shipLink.remove')!.click();
    expect(store.remove).toHaveBeenCalledTimes(1);
  });

  it('marks the input invalid and announces the translated error', async () => {
    const { fixture, el, store } = await setup();
    expect(el.querySelector('input.sl-input')?.getAttribute('aria-invalid')).toBeNull();
    store.error.set('notRsi');
    fixture.detectChanges();
    expect(el.querySelector('input.sl-input')?.getAttribute('aria-invalid')).toBe('true');
    expect(el.querySelector('.sl-error[role="alert"]')?.textContent).toContain('codex.shipLink.error.notRsi');
  });

  it('confirms a save and disables the submit while saving', async () => {
    const { fixture, el, store } = await setup();
    store.saved.set(true);
    store.saving.set(true);
    fixture.detectChanges();
    expect(el.querySelector('.sl-ok[role="status"]')).not.toBeNull();
    expect((el.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBeTrue();
  });

  it('shows the publish block to an admin only, unpublish only when a global link exists', async () => {
    const viewer = await setup(false);
    expect(viewer.el.querySelector('.sl-admin')).toBeNull();
    TestBed.resetTestingModule();

    const { fixture, el, store } = await setup(true);
    expect(el.querySelector('.sl-admin')).not.toBeNull();
    expect(buttonByText(el, 'codex.shipLink.unpromote')).toBeUndefined();
    buttonByText(el, 'codex.shipLink.promote')!.click();
    expect(store.promote).toHaveBeenCalledTimes(1);

    store.globalPledgeLink.set('https://robertsspaceindustries.com/x');
    fixture.detectChanges();
    buttonByText(el, 'codex.shipLink.unpromote')!.click();
    expect(store.unpromote).toHaveBeenCalledTimes(1);
  });
});
