export interface MobileAppleWebKitEnvironment {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
}

export function isMobileAppleWebKit(
  environment: MobileAppleWebKitEnvironment = typeof navigator === 'undefined' ? {} : navigator,
): boolean {
  const userAgent = environment.userAgent ?? '';
  const platform = environment.platform ?? '';
  const platformSignature = `${userAgent} ${platform}`;
  const isAppleWebKit = /AppleWebKit/i.test(userAgent);
  const isMobileApple = /iPad|iPhone|iPod/i.test(platformSignature)
    || (/Mac/i.test(platformSignature) && (environment.maxTouchPoints ?? 0) > 1);
  return isAppleWebKit && isMobileApple;
}

/**
 * Where an iPhone/iPad page runs. Safari evicts a site's script-writable storage
 * after seven days of browser use without a visit; Home Screen web apps are
 * exempt and keep their own, separate storage.
 * - `none`: not iOS/iPadOS WebKit (desktop, Android): no Home Screen guidance.
 * - `browser-tab`: a Safari (or other iOS browser) tab, subject to eviction.
 * - `home-screen-app`: opened from the Home Screen icon.
 */
export type AppleHomeScreenMode = 'none' | 'browser-tab' | 'home-screen-app';

export interface HomeScreenEnvironment extends MobileAppleWebKitEnvironment {
  /** WebKit's `navigator.standalone`, true inside a Home Screen web app. */
  standalone?: boolean;
  /** `matchMedia('(display-mode: standalone)')` (or fullscreen) matches. */
  displayModeStandalone?: boolean;
}

function matchesStandaloneDisplayMode(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: fullscreen)').matches;
  } catch {
    return false;
  }
}

export function readHomeScreenEnvironment(): HomeScreenEnvironment {
  if (typeof navigator === 'undefined') return {};
  const { userAgent, platform, maxTouchPoints } = navigator;
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return { userAgent, platform, maxTouchPoints, standalone, displayModeStandalone: matchesStandaloneDisplayMode() };
}

export function resolveAppleHomeScreenMode(environment: HomeScreenEnvironment = readHomeScreenEnvironment()): AppleHomeScreenMode {
  if (!isMobileAppleWebKit(environment)) return 'none';
  return environment.standalone === true || environment.displayModeStandalone === true ? 'home-screen-app' : 'browser-tab';
}
