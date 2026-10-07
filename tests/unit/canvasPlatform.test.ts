import { afterEach, describe, expect, it, vi } from 'vitest';
import { prefersSoftwareTimelineCanvas } from '../../src/utils/canvasPlatform';

afterEach(() => vi.unstubAllGlobals());
describe('canvas platform policy', () => {
  it.each([
    ['Linux x86_64', 'Mozilla/5.0 (X11; Linux x86_64)', undefined, true],
    ['Linux aarch64', 'Mozilla/5.0 (Linux; Android 15)', undefined, false],
    ['Win32', 'Mozilla/5.0 (Windows NT 10.0)', undefined, false],
    ['MacIntel', 'Mozilla/5.0 (Macintosh)', undefined, false],
    ['', '', { platform: 'Linux' }, true],
  ])('chooses safe presentation for %s', (platform, userAgent, userAgentData, expected) => {
    vi.stubGlobal('navigator', { platform, userAgent, userAgentData });
    expect(prefersSoftwareTimelineCanvas()).toBe(expected);
  });
  it('does not assume a browser platform in non-browser execution', () => {
    vi.stubGlobal('navigator', undefined);
    expect(prefersSoftwareTimelineCanvas()).toBe(false);
  });
});
