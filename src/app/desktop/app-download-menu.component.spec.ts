import { TestBed } from '@angular/core/testing';
import { computed, signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { AuthService } from '../auth/auth.service';
import { Role, RoleService } from '../auth/role.service';
import { DesktopCapabilityService } from '../core/desktop-capability.service';
import { AppDownloadMenuComponent } from './app-download-menu.component';
import { DesktopProduct, connectionState } from './desktop-access';
import { DesktopConnectionService } from './desktop-connection.service';
import { DesktopReleaseService, RingRelease } from './desktop-release.service';

const DAY = 24 * 60 * 60 * 1000;

function ring(r: RingRelease['ring'], version: string): RingRelease {
  return {
    ring: r,
    version,
    url: `https://example.test/app-${r}.exe`,
    sizeBytes: 3 * 1024 * 1024,
    hash: 'abcdef123456',
    notes: null,
  };
}

describe('AppDownloadMenuComponent', () => {
  /** Clicks an element with navigation defused — the entries are real anchors. */
  function clickNoNav(el: HTMLElement): void {
    const stop = (e: Event) => e.preventDefault();
    document.addEventListener('click', stop, true);
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    document.removeEventListener('click', stop, true);
  }

  function setup(opts: {
    product?: DesktopProduct;
    role?: Role | null;
    signedIn?: boolean;
    releases?: RingRelease[];
    lastSeenAt?: string | null;
    error?: string | null;
    fallbackUrl?: string;
    /** Device that cannot install a desktop app at all (feedback dccdcc82). */
    mobile?: boolean;
  } = {}) {
    const lastSeenAt = opts.lastSeenAt ?? null;
    const canInstall = signal(!opts.mobile);
    const ringsFor = jasmine.createSpy('ringsFor').and.resolveTo({
      releases: opts.releases ?? [ring('stable', '1.2.0'), ring('beta', '1.3.0')],
      error: opts.error ?? null,
    });
    const conn: Partial<DesktopConnectionService> = {
      refresh: jasmine.createSpy('refresh').and.resolveTo(undefined) as never,
      for: () => (lastSeenAt ? { product: 'uploader', lastSeenAt, appVersion: null } : null),
      stateFor: (_p: DesktopProduct, now = Date.now()) => connectionState(lastSeenAt, now),
    };

    TestBed.configureTestingModule({
      imports: [AppDownloadMenuComponent, TranslateModule.forRoot()],
      providers: [
        provideRouter([]),
        { provide: RoleService, useValue: { role: signal(opts.role ?? null) } },
        {
          provide: AuthService,
          useValue: { user: signal(opts.signedIn === false ? null : { id: 'u1' }) },
        },
        { provide: DesktopReleaseService, useValue: { ringsFor } },
        { provide: DesktopConnectionService, useValue: conn },
        {
          provide: DesktopCapabilityService,
          useValue: { canInstall, isMobileDevice: computed(() => !canInstall()) },
        },
      ],
    });
    const fixture = TestBed.createComponent(AppDownloadMenuComponent);
    fixture.componentRef.setInput('product', opts.product ?? 'uploader');
    if (opts.fallbackUrl) fixture.componentRef.setInput('fallbackUrl', opts.fallbackUrl);
    fixture.detectChanges();
    return { fixture, ringsFor, el: fixture.nativeElement as HTMLElement };
  }

  async function open(fixture: ReturnType<typeof setup>['fixture'], el: HTMLElement) {
    (el.querySelector('.dlm-trigger') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  afterEach(() => TestBed.resetTestingModule());

  it('renders nothing at all for a viewer on the uploader — the control must not exist', () => {
    const { el, ringsFor } = setup({ product: 'uploader', role: 'viewer' });
    expect(el.querySelector('.dlm-trigger')).toBeNull();
    expect(el.textContent?.trim()).toBe('');
    expect(ringsFor).not.toHaveBeenCalled();
  });

  it('renders nothing for an anonymous visitor on the uploader', () => {
    const { el } = setup({ product: 'uploader', role: null, signedIn: false });
    expect(el.querySelector('.dlm-trigger')).toBeNull();
  });

  // Admin feedback dccdcc82: "warum sehe ich mobil Desktop-Apps zum Download".
  // The menu is a header chip that exists purely to start a download, so on a
  // device that cannot install one there is nothing left to render.
  describe('on a device that cannot install desktop apps', () => {
    it('removes the Data-Uploader control entirely, even for an admin', () => {
      const { el, ringsFor } = setup({ product: 'uploader', role: 'admin', mobile: true });
      expect(el.querySelector('.dlm-trigger')).toBeNull();
      expect(el.textContent?.trim()).toBe('');
      expect(ringsFor).not.toHaveBeenCalled();
    });

    it('removes the public Starscape control too', () => {
      const { el } = setup({ product: 'starscape', role: 'viewer', mobile: true });
      expect(el.querySelector('.dlm-trigger')).toBeNull();
    });

    it('still renders it on a desktop browser', () => {
      const { el } = setup({ product: 'starscape', role: 'viewer', mobile: false });
      expect(el.querySelector('.dlm-trigger')).not.toBeNull();
    });
  });

  it('asks the server only for the rings the role may take (admin: all three)', async () => {
    const { fixture, el, ringsFor } = setup({ product: 'uploader', role: 'admin' });
    await open(fixture, el);
    expect(ringsFor).toHaveBeenCalledWith('uploader', ['stable', 'beta', 'alpha']);
  });

  it('asks for beta + stable as a collaborator', async () => {
    const { fixture, el, ringsFor } = setup({ product: 'uploader', role: 'collaborator' });
    await open(fixture, el);
    expect(ringsFor).toHaveBeenCalledWith('uploader', ['stable', 'beta']);
  });

  it('offers Starscape stable to everyone, including a viewer', async () => {
    const { fixture, el, ringsFor } = setup({ product: 'starscape', role: 'viewer' });
    expect(el.querySelector('.dlm-trigger')).not.toBeNull();
    await open(fixture, el);
    expect(ringsFor).toHaveBeenCalledWith('starscape', ['stable']);
  });

  // Colour semantics (admin feedback b8b31f24): red means "admin only". A
  // viewer who is handed a perfectly public download must not be told, in the
  // app's own colour language, that it is not for them.
  describe('the red accent', () => {
    it('does NOT paint the Starscape control red — every visitor may download it', () => {
      const { el } = setup({ product: 'starscape', role: 'viewer' });
      expect(el.querySelector('.dlm.restricted')).toBeNull();
      expect(el.querySelector('.dlm')).not.toBeNull();
    });

    it('keeps the red box on the collaborator-gated Data Uploader', () => {
      const { el } = setup({ product: 'uploader', role: 'collaborator' });
      expect(el.querySelector('.dlm.restricted')).not.toBeNull();
    });

    it('leaves every non-admin-only ring in the normal accent, red box or not', async () => {
      const { fixture, el } = setup({
        product: 'uploader',
        role: 'collaborator',
        releases: [ring('stable', '1.2.0'), ring('beta', '1.3.0')],
      });
      await open(fixture, el);
      expect(el.querySelectorAll('a.pop-dl').length).toBe(2);
      expect(el.querySelector('a.pop-dl.admin-only')).toBeNull();
    });

    it('marks the admin-only alpha ring red AND says so in words', async () => {
      const { fixture, el } = setup({
        product: 'starscape',
        role: 'admin',
        releases: [ring('stable', '1.2.0'), ring('beta', '1.3.0'), ring('alpha', '1.4.0')],
      });
      await open(fixture, el);
      const flagged = Array.from(el.querySelectorAll<HTMLAnchorElement>('a.pop-dl.admin-only'));
      expect(flagged.length).toBe(1);
      expect(flagged[0].getAttribute('href')).toBe('https://example.test/app-alpha.exe');
      // The colour is never the only carrier of the meaning.
      expect(flagged[0].querySelector('.dl-tag')?.textContent).toContain('appMenu.adminOnly');
    });
  });

  it('opens an overlapping panel and renders every version as a real download anchor', async () => {
    const { fixture, el } = setup({ role: 'admin' });
    const trigger = el.querySelector('.dlm-trigger') as HTMLButtonElement;
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(el.querySelector('.dlm-pop')).toBeNull();

    await open(fixture, el);

    const pop = el.querySelector('.dlm-pop') as HTMLElement;
    expect(pop).not.toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(pop.getAttribute('role')).toBe('dialog');
    // Overlapping, not in flow: it must be absolutely positioned.
    expect(getComputedStyle(pop).position).toBe('absolute');

    const links = Array.from(el.querySelectorAll<HTMLAnchorElement>('a.pop-dl'));
    expect(links.length).toBe(2);
    expect(links[0].getAttribute('href')).toBe('https://example.test/app-stable.exe');
    expect(links[0].hasAttribute('download')).toBeTrue();
    expect(links[0].getAttribute('target')).toBe('_blank');
    expect(links[0].getAttribute('rel')).toBe('noopener noreferrer');
    expect(links[0].getAttribute('title')).toContain('3.0 MB');
  });

  it('collapses itself the moment a download is started', async () => {
    const { fixture, el } = setup({ role: 'admin' });
    await open(fixture, el);
    expect(el.querySelector('.dlm-pop')).not.toBeNull();

    clickNoNav(el.querySelector('a.pop-dl') as HTMLElement);
    fixture.detectChanges();

    expect(el.querySelector('.dlm-pop')).toBeNull();
    expect(el.querySelector('.dlm-trigger')?.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(el.querySelector('.dlm-trigger'));
  });

  it('closes on Escape and on a pointerdown outside, and toggles shut again', async () => {
    const { fixture, el } = setup({ role: 'admin' });

    await open(fixture, el);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(el.querySelector('.dlm-pop')).toBeNull();

    await open(fixture, el);
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    fixture.detectChanges();
    expect(el.querySelector('.dlm-pop')).toBeNull();

    await open(fixture, el);
    (el.querySelector('.dlm-trigger') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('.dlm-pop')).toBeNull();
  });

  it('fetches the release list once, not on every open', async () => {
    const { fixture, el, ringsFor } = setup({ role: 'admin' });
    await open(fixture, el);
    (el.querySelector('.dlm-trigger') as HTMLButtonElement).click();
    fixture.detectChanges();
    await open(fixture, el);
    expect(ringsFor).toHaveBeenCalledTimes(1);
  });

  it('reports a fresh check-in as connected', async () => {
    const { fixture, el } = setup({
      role: 'admin',
      lastSeenAt: new Date(Date.now() - 2 * DAY).toISOString(),
    });
    expect(el.querySelector('.dlm-dot.connected')).not.toBeNull();
    await open(fixture, el);
    expect(el.querySelector('.pop-conn.connected')).not.toBeNull();
  });

  it('reports a check-in older than 30 days as expired', async () => {
    const { fixture, el } = setup({
      role: 'admin',
      lastSeenAt: new Date(Date.now() - 45 * DAY).toISOString(),
    });
    await open(fixture, el);
    expect(el.querySelector('.pop-conn.expired')).not.toBeNull();
    expect(el.querySelector('.pop-conn.connected')).toBeNull();
  });

  it('reports never-connected when there is no check-in', async () => {
    const { fixture, el } = setup({ role: 'admin', lastSeenAt: null });
    await open(fixture, el);
    expect(el.querySelector('.pop-conn.never')).not.toBeNull();
  });

  it('says nothing about a connection to an anonymous Starscape visitor', async () => {
    const { fixture, el } = setup({ product: 'starscape', role: null, signedIn: false });
    await open(fixture, el);
    expect(el.querySelector('.pop-conn')).toBeNull();
    expect(el.querySelector('.dlm-dot')).toBeNull();
  });

  it('states "no release" instead of an empty list when no ring resolved', async () => {
    const { fixture, el } = setup({ role: 'admin', releases: [] });
    await open(fixture, el);
    expect(el.querySelectorAll('a.pop-dl').length).toBe(0);
    expect(el.querySelector('.pop-state')).not.toBeNull();
  });

  it('falls back to the never-stale alias when no ring pointer resolved', async () => {
    const { fixture, el } = setup({
      product: 'starscape',
      role: 'viewer',
      releases: [],
      error: 'boom',
      fallbackUrl: 'https://example.test/starscape-latest.exe',
    });
    await open(fixture, el);
    const links = Array.from(el.querySelectorAll<HTMLAnchorElement>('a.pop-dl'));
    expect(links.length).toBe(1);
    expect(links[0].getAttribute('href')).toBe('https://example.test/starscape-latest.exe');
    // A working download outranks the error banner.
    expect(el.querySelector('.pop-state.err')).toBeNull();

    clickNoNav(links[0]);
    fixture.detectChanges();
    expect(el.querySelector('.dlm-pop')).toBeNull();
  });

  it('surfaces the resolver error when every ring failed', async () => {
    const { fixture, el } = setup({ role: 'admin', releases: [], error: 'boom' });
    await open(fixture, el);
    expect(el.querySelector('.pop-state.err')?.textContent).toContain('boom');
  });
});
