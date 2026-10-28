import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { DesktopCapabilityService } from '../core/desktop-capability.service';
import { APP_NOTICE_DELAY_MS, APP_NOTICE_SNOOZE_MS, AppNoticeService } from './app-notice.service';
import { AppNoticeComponent } from './app-notice.component';
import { DesktopReleaseService } from './desktop-release.service';

const KEY = 'sc.appNotice.starscape.snoozedUntil';

describe('AppNoticeService', () => {
  beforeEach(() => localStorage.removeItem(KEY));
  afterEach(() => localStorage.removeItem(KEY));

  it('is not snoozed until dismissed, then for 14 days', () => {
    const s = new AppNoticeService();
    expect(s.isSnoozed('starscape', 1000)).toBeFalse();
    s.snooze('starscape', 1000);
    expect(s.isSnoozed('starscape', 1000 + APP_NOTICE_SNOOZE_MS - 1)).toBeTrue();
    expect(s.isSnoozed('starscape', 1000 + APP_NOTICE_SNOOZE_MS + 1)).toBeFalse();
  });

  it('snoozes per app', () => {
    const s = new AppNoticeService();
    s.snooze('starscape', 1000);
    expect(s.isSnoozed('scc', 1001)).toBeFalse();
  });

  it('survives unavailable storage', () => {
    spyOn(Storage.prototype, 'getItem').and.throwError('blocked');
    spyOn(Storage.prototype, 'setItem').and.throwError('blocked');
    const s = new AppNoticeService();
    expect(() => s.snooze('scc')).not.toThrow();
    expect(s.isSnoozed('scc')).toBeFalse();
  });
});

@Component({
  standalone: true,
  imports: [AppNoticeComponent],
  template: `@if (show()) { <sc-app-notice app="starscape" /> }`,
})
class HostComponent {
  readonly show = signal(true);
}

describe('AppNoticeComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let canInstall: boolean;

  const el = () => fixture.nativeElement as HTMLElement;

  beforeEach(() => {
    localStorage.removeItem(KEY);
    canInstall = true;
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideTranslateService(),
        { provide: DesktopCapabilityService, useValue: { canInstall: () => canInstall } },
        { provide: DesktopReleaseService, useValue: { ringsFor: () => Promise.resolve({ releases: [], error: null }) } },
      ],
    });
  });
  afterEach(() => localStorage.removeItem(KEY));

  it('appears only after 3 s of presence', fakeAsync(() => {
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    tick(APP_NOTICE_DELAY_MS - 1);
    fixture.detectChanges();
    expect(el().querySelector('.toast')).toBeNull();
    tick(1);
    fixture.detectChanges();
    expect(el().querySelector('.toast')).not.toBeNull();
  }));

  it('never appears when the page is left before 3 s', fakeAsync(() => {
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    tick(2000);
    fixture.componentInstance.show.set(false);
    fixture.detectChanges();
    tick(5000);
    fixture.detectChanges();
    expect(el().querySelector('.toast')).toBeNull();
  }));

  it('stays hidden on a device that cannot install apps', fakeAsync(() => {
    canInstall = false;
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    tick(APP_NOTICE_DELAY_MS);
    fixture.detectChanges();
    expect(el().querySelector('.toast')).toBeNull();
  }));

  it('expands on a click anywhere and snoozes on the x', fakeAsync(() => {
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    tick(APP_NOTICE_DELAY_MS);
    fixture.detectChanges();
    const toast = el().querySelector<HTMLElement>('.toast')!;
    toast.click();
    fixture.detectChanges();
    expect(toast.classList.contains('open')).toBeTrue();
    el().querySelector<HTMLElement>('.x')!.click();
    fixture.detectChanges();
    expect(el().querySelector('.toast')).toBeNull();
    expect(new AppNoticeService().isSnoozed('starscape')).toBeTrue();
    tick();
  }));

  it('stays away while snoozed', fakeAsync(() => {
    new AppNoticeService().snooze('starscape');
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    tick(APP_NOTICE_DELAY_MS);
    fixture.detectChanges();
    expect(el().querySelector('.toast')).toBeNull();
  }));
});
