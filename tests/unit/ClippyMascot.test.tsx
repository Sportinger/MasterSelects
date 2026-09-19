import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClippyMascot } from '../../src/components/common/tutorial/ClippyMascot';

describe('ClippyMascot', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    Reflect.deleteProperty(navigator, 'maxTouchPoints');
  });

  it.each([
    {
      label: 'iPad user agent',
      maxTouchPoints: 5,
      userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15',
    },
    {
      label: 'iPadOS desktop mode',
      maxTouchPoints: 5,
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15',
    },
  ])('uses the transparent image fallback on $label', ({ maxTouchPoints, userAgent }) => {
    mockNavigator({ maxTouchPoints, userAgent });

    const { container } = render(<ClippyMascot isClosing={false} />);

    expect(container.querySelector('img')).toHaveAttribute('src', '/clippy.webp');
    expect(container.querySelector('video')).toBeNull();
  });

  it('keeps the animated WebM mascot on non-Apple desktop browsers', () => {
    mockNavigator({
      maxTouchPoints: 0,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0.0.0',
    });

    const { container } = render(<ClippyMascot isClosing={false} />);

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('source[src="/clippy-intro.webm"]')).not.toBeNull();
  });
});

function mockNavigator({
  maxTouchPoints,
  userAgent,
}: {
  maxTouchPoints: number;
  userAgent: string;
}): void {
  Object.defineProperty(navigator, 'maxTouchPoints', {
    configurable: true,
    value: maxTouchPoints,
  });
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent);
}
