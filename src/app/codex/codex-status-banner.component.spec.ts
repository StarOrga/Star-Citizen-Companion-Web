import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { provideTranslateService } from '@ngx-translate/core';
import { RoleService } from '../auth/role.service';
import { LocaleService } from '../core/locale/locale.service';
import { CodexBuild } from './codex.types';
import { CodexService } from './codex.service';
import { CodexStatusBannerComponent } from './codex-status-banner.component';

const BUILD: CodexBuild = {
  id: 'b1',
  channel: 'LIVE',
  patchVersion: '4.3.0',
  buildNumber: '123',
  schemaVersion: 1,
  qualityScore: 100,
  toolVersion: '0.9.1',
  entityCounts: { ships: 10, seeded: { ships: 5 } } as unknown as CodexBuild['entityCounts'],
  isCurrent: true,
  extractedAt: null,
};

describe('CodexStatusBannerComponent', () => {
  const build = signal<CodexBuild | null>(null);
  const stale = signal(false);
  const collaborator = signal(false);

  function mount() {
    build.set(null);
    stale.set(false);
    collaborator.set(false);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideTranslateService({}),
        { provide: CodexService, useValue: { build, stale } },
        { provide: RoleService, useValue: { isCollaborator: collaborator } },
        { provide: LocaleService, useValue: { language: signal('en'), region: signal('DE') } },
      ],
    });
    const fixture = TestBed.createComponent(CodexStatusBannerComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return { fixture, el };
  }

  it('renders nothing without a build', () => {
    const { el } = mount();
    expect(el.querySelector('.banner')).toBeNull();
  });

  it('renders the banner with the build once one is present, without stale hint', () => {
    const { fixture, el } = mount();
    build.set(BUILD);
    fixture.detectChanges();
    expect(el.querySelector('.banner')).not.toBeNull();
    expect(el.querySelector('.build')?.textContent).toContain('codex.provenance.build');
    expect(el.querySelector('.stale')).toBeNull();
  });

  it('shows the stale notice; the upload link only for collaborators', () => {
    const { fixture, el } = mount();
    build.set(BUILD);
    stale.set(true);
    fixture.detectChanges();
    expect(el.querySelector('.stale .stale-txt')?.textContent).toContain('codex.status.stale');
    expect(el.querySelector('a.stale-link')).toBeNull();

    collaborator.set(true);
    fixture.detectChanges();
    const link = el.querySelector('a.stale-link') as HTMLAnchorElement | null;
    expect(link).not.toBeNull();
    expect(link!.getAttribute('href')).toBe('/uploader');
  });

  it('expands on click to show details and coverage', () => {
    const { fixture, el } = mount();
    build.set(BUILD);
    fixture.detectChanges();
    expect(el.querySelector('.detail')).toBeNull();

    (el.querySelector('button.bar') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('button.bar')?.getAttribute('aria-expanded')).toBe('true');
    const detail = el.querySelector('.detail');
    expect(detail).not.toBeNull();
    expect(detail!.textContent).toContain('0.9.1');
    expect(el.querySelectorAll('.cov li').length).toBe(1);
    expect(el.querySelector('.cov-n')?.textContent).toContain('5');
    expect(el.querySelector('.cov-n')?.textContent).toContain('/10');
  });
});
