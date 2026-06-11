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
  it('uses vertical clip-path fills for track header meters', () => {
    const { container } = render(
      <AudioLevelMeter
        meter={createMeter({ phaseCorrelation: -0.25, stereoWidth: 0.6 })}
        label="Audio 1 level"
        orientation="vertical"
      />,
    );

    const peakFill = container.querySelector<HTMLElement>('.audio-level-meter-peak-fill');
    const rmsFill = container.querySelector<HTMLElement>('.audio-level-meter-rms');
    const peakMarker = container.querySelector<HTMLElement>('.audio-level-meter-peak');
    const phaseMarker = container.querySelector<HTMLElement>('.audio-level-meter-phase');
    const meter = container.querySelector<HTMLElement>('.audio-level-meter');

    expect(peakFill?.style.transform).toBe('none');
    expect(peakFill?.style.clipPath).toBe('inset(9.999999999999998% 0 0 0)');
    expect(peakFill?.style.opacity).toBe('0.68');
    expect(rmsFill?.style.transform).toBe('none');
    expect(rmsFill?.style.clipPath).toBe('inset(19.999999999999996% 0 0 0)');
    expect(rmsFill?.style.opacity).toBe('0.9');
    expect(peakMarker?.style.bottom).toBe('90%');
    expect(peakMarker?.style.opacity).toBe('1');
    expect(phaseMarker?.style.bottom).toBe('37.5%');
    expect(phaseMarker?.style.opacity).toBe('0.95');
    expect(meter?.title).toContain('phase -0.25');
    expect(meter?.title).toContain('width 0.60');
  });

  it('hides active fills and peak marker when no live meter snapshot exists', () => {
    const { container } = render(<AudioLevelMeter label="Audio 1 level" orientation="vertical" />);

    const peakFill = container.querySelector<HTMLElement>('.audio-level-meter-peak-fill');
    const rmsFill = container.querySelector<HTMLElement>('.audio-level-meter-rms');
    const peakMarker = container.querySelector<HTMLElement>('.audio-level-meter-peak');
    const phaseMarker = container.querySelector<HTMLElement>('.audio-level-meter-phase');

    expect(peakFill?.style.transform).toBe('none');
    expect(peakFill?.style.clipPath).toBe('inset(100% 0 0 0)');
    expect(peakFill?.style.opacity).toBe('0');
    expect(rmsFill?.style.transform).toBe('none');
    expect(rmsFill?.style.clipPath).toBe('inset(100% 0 0 0)');
    expect(rmsFill?.style.opacity).toBe('0');
    expect(peakMarker?.style.opacity).toBe('0');
    expect(phaseMarker?.style.opacity).toBe('0');
  });

  it('renders independent stereo channel bars without the mono phase marker', () => {
    const { container } = render(
      <AudioLevelMeter
        meter={createMeter({
          channels: {
            left: {
              peakLinear: 1,
              rmsLinear: 0.001,
              peakDb: 0,
              rmsDb: -60,
            },
            right: {
              peakLinear: 0.001,
              rmsLinear: 0.001,
              peakDb: -60,
              rmsDb: -60,
            },
          },
          phaseCorrelation: 0.25,
        })}
        label="Stereo level"
        orientation="vertical"
        display="stereo"
      />,
    );

    const meter = container.querySelector<HTMLElement>('.audio-level-meter.stereo.vertical');
    const channels = container.querySelectorAll<HTMLElement>('.audio-level-meter-stereo-channel');
    const peakFills = container.querySelectorAll<HTMLElement>('.audio-level-meter-peak-fill');
    const rmsFills = container.querySelectorAll<HTMLElement>('.audio-level-meter-rms');
    const phaseMarker = container.querySelector<HTMLElement>('.audio-level-meter-phase');

    expect(meter).not.toBeNull();
    expect(channels).toHaveLength(2);
    expect(peakFills[0].style.clipPath).toBe('inset(0% 0 0 0)');
    expect(rmsFills[0].style.clipPath).toBe('inset(100% 0 0 0)');
    expect(peakFills[1].style.clipPath).toBe('inset(100% 0 0 0)');
    expect(rmsFills[1].style.clipPath).toBe('inset(100% 0 0 0)');
    expect(meter?.title).toContain('L 0.0 dB');
    expect(meter?.title).toContain('R -60.0 dB');
    expect(phaseMarker).toBeNull();
  });

  it('auto-selects stereo only when channel snapshots are available', () => {
    const { container, rerender } = render(
      <AudioLevelMeter
        meter={createMeter()}
        label="Layer level"
        orientation="vertical"
        display="auto"
      />,
    );

    expect(container.querySelector('.audio-level-meter.stereo')).toBeNull();
    expect(container.querySelector('.audio-level-meter-phase')).not.toBeNull();

    rerender(
      <AudioLevelMeter
        meter={createMeter({
          channels: {
            left: {
              peakLinear: 1,
              rmsLinear: 0.001,
              peakDb: 0,
              rmsDb: -60,
            },
            right: {
              peakLinear: 0.001,
              rmsLinear: 0.001,
              peakDb: -60,
              rmsDb: -60,
            },
          },
        })}
        label="Layer level"
        orientation="vertical"
        display="auto"
      />,
    );

    expect(container.querySelector('.audio-level-meter.stereo')).not.toBeNull();
    expect(container.querySelector('.audio-level-meter-phase')).toBeNull();
  });
});
