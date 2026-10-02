import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideTranslateService } from '@ngx-translate/core';
import { CodexShipActionsComponent } from './codex-ship-actions.component';
import { ShipLinkFormStore } from './ship-link-form.store';
import { AuthService } from '../../auth/auth.service';

describe('CodexShipActionsComponent', () => {
  const RSI_LISTING = 'https://robertsspaceindustries.com/en/pledge/ships?sortField=name&sortDirection=asc';

  async function setup(
    opts: {
      user?: { id: string } | null;
      pledgeLink?: string | null;
      myPledgeLink?: string | null;
      inputs?: Partial<Record<'spacer' | 'inHangar' | 'addBusy' | 'addFailed', boolean>>;
    } = {},
  ) {
    const store = {
      pledgeLink: signal<string | null>(opts.pledgeLink ?? null),
      myPledgeLink: signal<string | null>(opts.myPledgeLink ?? null),
      toggle: jasmine.createSpy('toggle'),
    };
    await TestBed.configureTestingModule({
      imports: [CodexShipActionsComponent],
      providers: [
        provideTranslateService({}),
        { provide: ShipLinkFormStore, useValue: store },
        { provide: AuthService, useValue: { user: signal(opts.user === undefined ? null : opts.user) } },
      ],
    }).compileComponents();
    const fixture: ComponentFixture<CodexShipActionsComponent> = TestBed.createComponent(CodexShipActionsComponent);
    fixture.componentRef.setInput('classNameSlug', 'AEGS_Gladius');
    for (const [k, v] of Object.entries(opts.inputs ?? {})) fixture.componentRef.setInput(k, v);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement, store };
  }

  afterEach(() => TestBed.resetTestingModule());

  it('shows the class name and, without a pinned link, an external anchor to the RSI ships listing', async () => {
    const { el } = await setup();
    expect(el.querySelector('code.cls')?.textContent).toBe('AEGS_Gladius');
    const a = el.querySelector('a.rsi-link') as HTMLAnchorElement;
    expect(a.getAttribute('href')).toBe(RSI_LISTING);
    expect(a.target).toBe('_blank');
    expect(a.rel).toContain('noopener');
    expect(a.rel).toContain('noreferrer');
  });

  it('uses a pinned pledge link as the anchor href, marked nofollow', async () => {
    const pinned = 'https://robertsspaceindustries.com/pledge/ships/gladius/Gladius';
    const { el } = await setup({ pledgeLink: pinned });
    const links = el.querySelectorAll<HTMLAnchorElement>('a.rsi-link');
    expect(links.length).toBe(1);
    expect(links[0].getAttribute('href')).toBe(pinned);
    expect(links[0].rel).toContain('nofollow');
  });

  it('emits addToHangar from the add button, and hides it once the ship is in the hangar', async () => {
    const { fixture, el } = await setup();
    const emitted = jasmine.createSpy('add');
    fixture.componentInstance.addToHangar.subscribe(emitted);
    (el.querySelector('button.add-hangar') as HTMLButtonElement).click();
    expect(emitted).toHaveBeenCalledTimes(1);

    fixture.componentRef.setInput('inHangar', true);
    fixture.detectChanges();
    expect(el.querySelector('button.add-hangar')).toBeNull();
  });

  it('disables the add button while busy and announces a failed add', async () => {
    const { el } = await setup({ inputs: { addBusy: true, addFailed: true } });
    const btn = el.querySelector('button.add-hangar') as HTMLButtonElement;
    expect(btn.disabled).toBeTrue();
    expect(btn.getAttribute('aria-busy')).toBe('true');
    expect(el.querySelector('.add-err[role="alert"]')?.textContent).toContain('codex.card.addToHangarFailed');
  });

  it('renders the spacer only when asked for', async () => {
    const plain = await setup();
    expect(plain.el.querySelector('.tool-spacer')).toBeNull();
    TestBed.resetTestingModule();
    const spaced = await setup({ inputs: { spacer: true } });
    expect(spaced.el.querySelector('.tool-spacer')).not.toBeNull();
  });

  it('offers the own-link toggle only to a signed-in reader, worded add vs edit', async () => {
    const anon = await setup({ user: null });
    expect(anon.el.querySelector('button.quiet')).toBeNull();
    TestBed.resetTestingModule();

    const signedIn = await setup({ user: { id: 'u1' } });
    const btn = signedIn.el.querySelector('button.quiet') as HTMLButtonElement;
    expect(btn.textContent).toContain('codex.shipLink.add');
    btn.click();
    expect(signedIn.store.toggle).toHaveBeenCalledTimes(1);

    signedIn.store.myPledgeLink.set('https://robertsspaceindustries.com/x');
    signedIn.fixture.detectChanges();
    expect(btn.textContent).toContain('codex.shipLink.edit');
  });
});
