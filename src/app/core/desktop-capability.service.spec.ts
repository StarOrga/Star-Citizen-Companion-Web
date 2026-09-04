import { TestBed } from '@angular/core/testing';
import { DOCUMENT } from '@angular/core';
import {
  DesktopCapabilityService,
  DeviceEnv,
  canInstallDesktopApps,
} from './desktop-capability.service';

const WIN_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36';
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
/** iPadOS ≥ 13 in its default "Request Desktop Website" mode — a Mac, it claims. */
const IPAD_DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

describe('canInstallDesktopApps', () => {
  function env(overrides: Partial<DeviceEnv> = {}): DeviceEnv {
    return { userAgent: WIN_UA, ...overrides };
  }

  it('says yes for a Windows desktop browser', () => {
    expect(
      canInstallDesktopApps(env({ uaDataPlatform: 'Windows', uaDataMobile: false, platform: 'Win32' })),
    ).toBeTrue();
  });

  it('says no when the browser reports itself as mobile', () => {
    expect(canInstallDesktopApps(env({ uaDataMobile: true }))).toBeFalse();
  });

  it('says no for Android and iOS via Client Hints', () => {
    expect(canInstallDesktopApps(env({ uaDataPlatform: 'Android' }))).toBeFalse();
    expect(canInstallDesktopApps(env({ uaDataPlatform: 'iOS' }))).toBeFalse();
  });

  it('falls back to the user agent when Client Hints are absent (Firefox, Safari)', () => {
    expect(canInstallDesktopApps({ userAgent: ANDROID_UA, platform: 'Linux armv8l' })).toBeFalse();
    expect(canInstallDesktopApps({ userAgent: IPHONE_UA, platform: 'iPhone' })).toBeFalse();
  });

  it('unmasks an iPad claiming to be desktop Safari', () => {
    expect(
      canInstallDesktopApps({ userAgent: IPAD_DESKTOP_UA, platform: 'MacIntel', maxTouchPoints: 5 }),
    ).toBeFalse();
    // A real Mac reports the same platform with no touch screen.
    expect(
      canInstallDesktopApps({ userAgent: IPAD_DESKTOP_UA, platform: 'MacIntel', maxTouchPoints: 0 }),
    ).toBeTrue();
  });

  it('keeps a narrow desktop window a valid download target', () => {
    // Width is never consulted — there is not even an input for it.
    expect(canInstallDesktopApps(env({ platform: 'Win32', coarsePointer: false }))).toBeTrue();
  });

  it('does not disqualify a touch-screen laptop that can still hover', () => {
    expect(
      canInstallDesktopApps(env({ platform: 'Win32', coarsePointer: true, noHover: false })),
    ).toBeTrue();
  });

  it('treats an unidentifiable coarse, hover-less pointer as a touch device', () => {
    expect(
      canInstallDesktopApps({ userAgent: '', platform: '', coarsePointer: true, noHover: true }),
    ).toBeFalse();
    expect(
      canInstallDesktopApps({ userAgent: '', platform: '', coarsePointer: false, noHover: false }),
    ).toBeTrue();
  });
});

describe('DesktopCapabilityService', () => {
  type Listener = (ev: MediaQueryListEvent) => void;

  function setup(opts: {
    userAgent?: string;
    uaDataPlatform?: string;
    uaDataMobile?: boolean;
    platform?: string;
    coarse?: boolean;
    hoverNone?: boolean;
  } = {}) {
    const listeners = new Map<string, Listener[]>();
    const matches: Record<string, boolean> = {
      '(pointer: coarse)': opts.coarse ?? false,
      '(hover: none)': opts.hoverNone ?? false,
    };
    const defaultView = {
      navigator: {
        userAgent: opts.userAgent ?? WIN_UA,
        platform: opts.platform ?? 'Win32',
        maxTouchPoints: 0,
        userAgentData:
          opts.uaDataPlatform === undefined && opts.uaDataMobile === undefined
            ? undefined
            : { platform: opts.uaDataPlatform, mobile: opts.uaDataMobile },
      },
      matchMedia: (query: string) => ({
        matches: matches[query] ?? false,
        addEventListener: (_: string, fn: Listener) =>
          listeners.set(query, [...(listeners.get(query) ?? []), fn]),
        removeEventListener: () => undefined,
      }),
    };

    TestBed.configureTestingModule({
      providers: [{ provide: DOCUMENT, useValue: { defaultView } }],
    });
    const svc = TestBed.inject(DesktopCapabilityService);
    const emit = (query: string, value: boolean) =>
      (listeners.get(query) ?? []).forEach((fn) => fn({ matches: value } as MediaQueryListEvent));
    return { svc, emit };
  }

  it('allows the download on a desktop browser', () => {
    const { svc } = setup();
    expect(svc.canInstall()).toBeTrue();
    expect(svc.isMobileDevice()).toBeFalse();
  });

  it('blocks it on a phone', () => {
    const { svc } = setup({ userAgent: ANDROID_UA, uaDataPlatform: 'Android', uaDataMobile: true });
    expect(svc.canInstall()).toBeFalse();
    expect(svc.isMobileDevice()).toBeTrue();
  });

  it('re-evaluates when the pointer capabilities change', () => {
    // No identifiable platform, so the media queries decide — and keep deciding.
    const { svc, emit } = setup({ userAgent: '', platform: '' });
    expect(svc.canInstall()).toBeTrue();

    emit('(pointer: coarse)', true);
    emit('(hover: none)', true);
    expect(svc.canInstall()).toBeFalse();

    emit('(hover: none)', false);
    expect(svc.canInstall()).toBeTrue();
  });
});
