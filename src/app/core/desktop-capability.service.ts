import { DOCUMENT, DestroyRef, Injectable, Signal, computed, inject, signal } from '@angular/core';

/**
 * Everything the capability rule is allowed to look at. Passing it in (instead
 * of reaching for `navigator` inside the rule) keeps the decision a pure,
 * unit-testable function — a device we cannot buy is still a device we can test.
 */
export interface DeviceEnv {
  /** `navigator.userAgent`. */
  userAgent: string;
  /** `navigator.userAgentData.platform` — "Windows", "Android", "iOS", … */
  uaDataPlatform?: string | null;
  /** `navigator.userAgentData.mobile` — the one explicit statement a browser makes. */
  uaDataMobile?: boolean | null;
  /** Legacy `navigator.platform` — "Win32", "MacIntel", "Linux armv8l", … */
  platform?: string | null;
  /** `navigator.maxTouchPoints` — the iPadOS tell-tale. */
  maxTouchPoints?: number;
  /** `(pointer: coarse)` matches. */
  coarsePointer?: boolean;
  /** `(hover: none)` matches. */
  noHover?: boolean;
}

/** `userAgentData.platform` values that mean "no installable desktop binaries". */
const MOBILE_UA_DATA_PLATFORM = /^(android|ios|ipados)$/;
/** UA substrings that mark a phone/tablet browser. `mobi` also covers "Mobile". */
const MOBILE_UA = /android|iphone|ipad|ipod|iemobile|blackberry|bb10|opera mini|windows phone|mobi/;
/** Legacy `navigator.platform` prefixes of operating systems that install apps. */
const DESKTOP_PLATFORM = /^(win|mac|linux|freebsd|openbsd|sunos|cros|x11)/;

/**
 * Can this device install and run a downloaded desktop application at all?
 *
 * Answers the admin's question from feedback dccdcc82 — "warum sehe ich mobil
 * Desktop-Apps zum Download […], das macht ja gar keinen Sinn" — with a real
 * signal instead of a viewport width. A narrow *desktop* window is still a
 * perfectly good download target: somebody dragging their browser to half the
 * screen has not stopped owning a PC. Width alone therefore cannot decide this.
 *
 * The checks run strongest-evidence-first and stop at the first one that
 * actually knows something:
 *
 *   1. `navigator.userAgentData.mobile` — a browser saying "I am a phone".
 *   2. `userAgentData.platform` — a frozen, non-spoofable OS name.
 *   3. The user-agent string — mobile tokens (covers every non-Chromium browser,
 *      which has no `userAgentData` at all).
 *   4. iPadOS ≥ 13, which deliberately claims to be desktop Safari: it reports
 *      `MacIntel` *and* a touch screen, a combination no real Mac produces.
 *   5. A known desktop platform → yes.
 *   6. Nothing identifiable: a pointer that is coarse AND cannot hover is a
 *      touch device. This is the fallback, never the primary test — a touch
 *      screen on a laptop makes neither query decisive on its own.
 *
 * Deliberately NOT "can this device run *Windows* binaries": hiding the download
 * from macOS and Linux users is a different (and much larger) product decision
 * than not offering an install to a phone that cannot install anything.
 */
export function canInstallDesktopApps(env: DeviceEnv): boolean {
  if (env.uaDataMobile === true) return false;

  const uaDataPlatform = (env.uaDataPlatform ?? '').trim().toLowerCase();
  if (uaDataPlatform && uaDataPlatform !== 'unknown') {
    return !MOBILE_UA_DATA_PLATFORM.test(uaDataPlatform);
  }

  const ua = (env.userAgent ?? '').toLowerCase();
  if (MOBILE_UA.test(ua)) return false;

  const platform = (env.platform ?? '').trim().toLowerCase();
  if (platform.startsWith('mac') && (env.maxTouchPoints ?? 0) > 1) return false;
  if (DESKTOP_PLATFORM.test(platform)) return true;

  return !(env.coarsePointer && env.noHover);
}

/** Shape of the Client-Hints API, which TS's lib.dom does not know yet. */
interface UaDataNavigator extends Navigator {
  userAgentData?: { platform?: string; mobile?: boolean };
}

const COARSE_POINTER = '(pointer: coarse)';
const NO_HOVER = '(hover: none)';

/**
 * The one place the app asks "may I offer a desktop download here?".
 *
 * Exposed as a signal rather than a boolean so a device that *changes* its
 * answer — an attached keyboard/mouse, a 2-in-1 folding out of tablet mode —
 * updates the UI instead of freezing whatever was true at bootstrap. Templates
 * read the signal; no component re-implements a media query of its own.
 */
@Injectable({ providedIn: 'root' })
export class DesktopCapabilityService {
  private readonly doc = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);

  private readonly coarsePointer = signal(false);
  private readonly noHover = signal(false);
  private readonly staticEnv: Omit<DeviceEnv, 'coarsePointer' | 'noHover'>;

  /** True when a downloaded desktop application could actually be installed. */
  readonly canInstall: Signal<boolean>;
  /** Inverse, for the (more readable) "show the mobile notice" branches. */
  readonly isMobileDevice: Signal<boolean>;

  constructor() {
    const view = this.doc.defaultView;
    const nav = view?.navigator as UaDataNavigator | undefined;
    this.staticEnv = {
      userAgent: nav?.userAgent ?? '',
      uaDataPlatform: nav?.userAgentData?.platform ?? null,
      uaDataMobile: nav?.userAgentData?.mobile ?? null,
      platform: nav?.platform ?? null,
      maxTouchPoints: nav?.maxTouchPoints ?? 0,
    };
    this.watch(view, COARSE_POINTER, this.coarsePointer);
    this.watch(view, NO_HOVER, this.noHover);

    this.canInstall = computed(() =>
      canInstallDesktopApps({
        ...this.staticEnv,
        coarsePointer: this.coarsePointer(),
        noHover: this.noHover(),
      }),
    );
    this.isMobileDevice = computed(() => !this.canInstall());
  }

  private watch(
    view: (Window & typeof globalThis) | null | undefined,
    query: string,
    target: { set(value: boolean): void },
  ): void {
    if (typeof view?.matchMedia !== 'function') return;
    const mq = view.matchMedia(query);
    target.set(mq.matches);
    const onChange = (ev: MediaQueryListEvent) => target.set(ev.matches);
    mq.addEventListener('change', onChange);
    this.destroyRef.onDestroy(() => mq.removeEventListener('change', onChange));
  }
}
