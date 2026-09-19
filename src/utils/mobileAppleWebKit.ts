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
