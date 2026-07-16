import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MixerMeterScale,
} from '../../src/components/panels/audio-mixer/MixerMeter';
import { getMixerFaderScaleTopPercent } from '../../src/components/panels/audio-mixer/audioMixerMath';

afterEach(() => {
  cleanup();
});

describe('MixerMeterScale', () => {
  it('uses the mixer fader dB range instead of the meter-only +3 dB scale', () => {
    const { container } = render(<MixerMeterScale />);
    const labels = Array.from(container.querySelectorAll<HTMLSpanElement>('.audio-mixer-meter-scale-labels span'));

    expect(labels.map(label => label.textContent)).toEqual(['+18', '+12', '+6', '0', '-12', '-30', '-60']);
    expect(labels.some(label => label.textContent === '+3')).toBe(false);
  });

  it('positions 0 dB on the same normalized range as the fader thumb', () => {
    const { container } = render(<MixerMeterScale />);
    const zeroLabel = Array.from(container.querySelectorAll<HTMLSpanElement>('.audio-mixer-meter-scale-labels span'))
      .find(label => label.textContent === '0');

    expect(getMixerFaderScaleTopPercent(18)).toBe(0);
    expect(getMixerFaderScaleTopPercent(0)).toBeCloseTo(23.0769, 4);
    expect(getMixerFaderScaleTopPercent(-60)).toBe(100);
    expect(zeroLabel?.style.top).toBe(`${getMixerFaderScaleTopPercent(0)}%`);
  });
});
