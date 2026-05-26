import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AudioLevelMeter } from '../../src/components/timeline/components/AudioLevelMeter';
import type { AudioMeterSnapshot } from '../../src/types';

afterEach(() => {
  cleanup();
});

function createMeter(overrides: Partial<AudioMeterSnapshot> = {}): AudioMeterSnapshot {
  return {
    peakLinear: 0.5,
    rmsLinear: 0.25,
    peakDb: -6,
    rmsDb: -12,
    clipping: false,
    updatedAt: 1000,
    ...overrides,
  };
}

describe('AudioLevelMeter', () => {
  it('uses vertical transform fills for track header meters', () => {
    const { container } = render(
      <AudioLevelMeter meter={createMeter()} label="Audio 1 level" orientation="vertical" />,
    );

    const peakFill = container.querySelector<HTMLElement>('.audio-level-meter-peak-fill');
    const rmsFill = container.querySelector<HTMLElement>('.audio-level-meter-rms');
    const peakMarker = container.querySelector<HTMLElement>('.audio-level-meter-peak');

    expect(peakFill?.style.transform).toBe('scaleY(0.9)');
    expect(peakFill?.style.opacity).toBe('0.68');
    expect(rmsFill?.style.transform).toBe('scaleY(0.8)');
    expect(rmsFill?.style.opacity).toBe('0.9');
    expect(peakMarker?.style.bottom).toBe('90%');
    expect(peakMarker?.style.opacity).toBe('1');
  });

  it('hides active fills and peak marker when no live meter snapshot exists', () => {
    const { container } = render(<AudioLevelMeter label="Audio 1 level" orientation="vertical" />);

    const peakFill = container.querySelector<HTMLElement>('.audio-level-meter-peak-fill');
    const rmsFill = container.querySelector<HTMLElement>('.audio-level-meter-rms');
    const peakMarker = container.querySelector<HTMLElement>('.audio-level-meter-peak');

    expect(peakFill?.style.transform).toBe('scaleY(0)');
    expect(peakFill?.style.opacity).toBe('0');
    expect(rmsFill?.style.transform).toBe('scaleY(0)');
    expect(rmsFill?.style.opacity).toBe('0');
    expect(peakMarker?.style.opacity).toBe('0');
  });
});
