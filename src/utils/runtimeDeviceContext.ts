export type RuntimePlatform = 'windows' | 'macos' | 'linux' | 'ios' | 'android' | 'other';
export type RuntimeDeviceClass = 'desktop' | 'tablet' | 'mobile';
export type RuntimeBrowser = 'chrome' | 'edge' | 'firefox' | 'safari' | 'other';

interface RuntimeNavigatorLike {
  maxTouchPoints?: number;
  platform?: string;
  userAgent?: string;
  userAgentData?: {
    mobile?: boolean;
    platform?: string;
  };
}

export interface RuntimeDeviceContext {
  browser: RuntimeBrowser;
  deviceClass: RuntimeDeviceClass;
  platform: RuntimePlatform;
}

export function resolveRuntimeDeviceContext(
  runtimeNavigator: RuntimeNavigatorLike,
  viewportWidth: number,
): RuntimeDeviceContext {
  const userAgent = runtimeNavigator.userAgent ?? '';
  const platformSignature = `${runtimeNavigator.userAgentData?.platform ?? ''} ${runtimeNavigator.platform ?? ''}`;
  const isIpadDesktopMode = /mac/i.test(platformSignature)
    && (runtimeNavigator.maxTouchPoints ?? 0) > 1;
  const platform: RuntimePlatform = /android/i.test(`${userAgent} ${platformSignature}`)
    ? 'android'
    : /iphone|ipad|ipod/i.test(`${userAgent} ${platformSignature}`) || isIpadDesktopMode
      ? 'ios'
      : /windows/i.test(`${userAgent} ${platformSignature}`)
        ? 'windows'
        : /macintosh|mac os|macintel/i.test(`${userAgent} ${platformSignature}`)
          ? 'macos'
          : /linux/i.test(`${userAgent} ${platformSignature}`)
            ? 'linux'
            : 'other';

  const browser: RuntimeBrowser = /edg(?:e|a|ios)?\//i.test(userAgent)
    ? 'edge'
    : /firefox|fxios/i.test(userAgent)
      ? 'firefox'
      : /chrome|crios/i.test(userAgent)
        ? 'chrome'
        : /safari/i.test(userAgent) && /applewebkit/i.test(userAgent)
          ? 'safari'
          : 'other';

  const reportsMobile = runtimeNavigator.userAgentData?.mobile === true;
  const deviceClass: RuntimeDeviceClass = platform === 'ios' && (isIpadDesktopMode || /ipad/i.test(userAgent))
    ? 'tablet'
    : reportsMobile || /iphone|ipod|android.+mobile|\bmobile\b/i.test(userAgent) || viewportWidth <= 767
      ? 'mobile'
      : /ipad|tablet|android/i.test(userAgent) || viewportWidth <= 1100
        ? 'tablet'
        : 'desktop';

  return { browser, deviceClass, platform };
}

export function getRuntimeDeviceContext(): RuntimeDeviceContext {
  if (typeof navigator === 'undefined') {
    return { browser: 'other', deviceClass: 'desktop', platform: 'other' };
  }
  const viewportWidth = typeof window === 'undefined' ? 1280 : window.innerWidth;
  return resolveRuntimeDeviceContext(navigator, viewportWidth);
}
