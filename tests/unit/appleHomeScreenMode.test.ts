import { describe, expect, it } from 'vitest';
import { resolveAppleHomeScreenMode } from '../../src/utils/mobileAppleWebKit';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
// iPadOS Safari requests desktop sites by default: a Mac user agent, told apart by touch points.
const IPAD_DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const CHROME_DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';

describe('resolveAppleHomeScreenMode', () => {
  it('detects an iOS Safari tab', () => {
    expect(resolveAppleHomeScreenMode({ userAgent: IPHONE, platform: 'iPhone', maxTouchPoints: 5 })).toBe('browser-tab');
  });

  it('detects the Home Screen app by navigator.standalone or display-mode', () => {
    expect(resolveAppleHomeScreenMode({ userAgent: IPHONE, platform: 'iPhone', maxTouchPoints: 5, standalone: true })).toBe('home-screen-app');
    expect(resolveAppleHomeScreenMode({ userAgent: IPHONE, platform: 'iPhone', maxTouchPoints: 5, displayModeStandalone: true })).toBe('home-screen-app');
  });

  it('detects an iPad with the desktop user agent through touch points', () => {
    expect(resolveAppleHomeScreenMode({ userAgent: IPAD_DESKTOP, platform: 'MacIntel', maxTouchPoints: 5 })).toBe('browser-tab');
    expect(resolveAppleHomeScreenMode({ userAgent: IPAD_DESKTOP, platform: 'MacIntel', maxTouchPoints: 5, standalone: true })).toBe('home-screen-app');
  });

  it('ignores desktop Safari, desktop Chrome and Android, also when installed', () => {
    expect(resolveAppleHomeScreenMode({ userAgent: IPAD_DESKTOP, platform: 'MacIntel', maxTouchPoints: 0 })).toBe('none');
    expect(resolveAppleHomeScreenMode({ userAgent: CHROME_DESKTOP, platform: 'Win32', maxTouchPoints: 0, displayModeStandalone: true })).toBe('none');
    expect(resolveAppleHomeScreenMode({ userAgent: ANDROID, platform: 'Linux armv8l', maxTouchPoints: 5 })).toBe('none');
    expect(resolveAppleHomeScreenMode({ userAgent: ANDROID, platform: 'Linux armv8l', maxTouchPoints: 5, displayModeStandalone: true })).toBe('none');
  });
});
