import { describe, expect, it } from 'vitest';

import { PHONE_MARKER_COLORS, formatPhoneMarkerTime } from '../../src/components/mobileSkin/markers/phoneMarkerFormat';

describe('phone marker format', () => {
  it('shows minutes, seconds and frames at the composition rate', () => {
    expect(formatPhoneMarkerTime(0, 30)).toBe('0:00.00');
    expect(formatPhoneMarkerTime(1.5, 30)).toBe('0:01.15');
    expect(formatPhoneMarkerTime(61 + 23 / 24, 24)).toBe('1:01.23');
    expect(formatPhoneMarkerTime(-3, 30)).toBe('0:00.00');
    expect(formatPhoneMarkerTime(2, Number.NaN)).toBe('0:02.00');
  });

  it('starts with the editor default marker colour', () => {
    expect(PHONE_MARKER_COLORS[0]).toBe('#2997E5');
  });
});
