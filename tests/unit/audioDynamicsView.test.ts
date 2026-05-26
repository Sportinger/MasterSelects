import { describe, expect, it } from 'vitest';
import type { AudioEffectInstance } from '../../src/types';
import {
  createAudioDynamicsViewModel,
  isAudioDynamicsEffect,
} from '../../src/components/panels/properties/audioDynamicsView';

function effect(
  descriptorId: string,
  params: AudioEffectInstance['params'],
): AudioEffectInstance {
  return {
    id: `${descriptorId}-1`,
    descriptorId,
    enabled: true,
    params,
  };
}

describe('audioDynamicsView', () => {
  it('identifies dynamics effects and skips non-dynamics effects', () => {
    expect(isAudioDynamicsEffect('audio-compressor')).toBe(true);
    expect(isAudioDynamicsEffect('audio-noise-gate')).toBe(true);
    expect(isAudioDynamicsEffect('audio-expander')).toBe(true);
    expect(isAudioDynamicsEffect('audio-eq')).toBe(false);
    expect(createAudioDynamicsViewModel(effect('audio-eq', {}), 'EQ')).toBeNull();
  });

  it('creates a compressor transfer curve with threshold and timing readout', () => {
    const model = createAudioDynamicsViewModel(effect('audio-compressor', {
      thresholdDb: -18,
      ratio: 4,
      kneeDb: 6,
      attackMs: 8,
      releaseMs: 140,
      makeupGainDb: 2,
    }), 'Compressor');

    expect(model).toMatchObject({
      effectId: 'audio-compressor',
      title: 'Compressor',
      primary: '-18.0 dB / 4.0:1',
      secondary: 'A 8.0 ms  R 140 ms',
      markers: [expect.objectContaining({ label: 'T' })],
    });
    expect(model?.points.split(' ')).toHaveLength(29);
  });

  it('creates limiter, gate, and expander curves with bounded marker positions', () => {
    const limiter = createAudioDynamicsViewModel(effect('audio-limiter', {
      ceilingDb: -1,
      inputGainDb: 6,
    }), 'Limiter');
    const gate = createAudioDynamicsViewModel(effect('audio-noise-gate', {
      thresholdDb: -42,
      floorDb: -90,
      attackMs: 2,
      releaseMs: 80,
    }), 'Noise Gate');
    const expander = createAudioDynamicsViewModel(effect('audio-expander', {
      thresholdDb: -38,
      ratio: 2.5,
      rangeDb: 18,
      attackMs: 3,
      releaseMs: 110,
    }), 'Expander');

    expect(limiter?.primary).toBe('-1.0 dB ceiling');
    expect(gate?.primary).toBe('-42.0 dB open');
    expect(expander?.primary).toBe('-38.0 dB / 2.5:1');
    expect(expander?.secondary).toContain('-18.0 dB max');
    for (const model of [limiter, gate, expander]) {
      expect(model?.markers[0]?.xPercent).toBeGreaterThanOrEqual(0);
      expect(model?.markers[0]?.xPercent).toBeLessThanOrEqual(100);
      expect(model?.markers[0]?.yPercent).toBeGreaterThanOrEqual(0);
      expect(model?.markers[0]?.yPercent).toBeLessThanOrEqual(100);
    }
  });

  it('adds live gain reduction when the runtime snapshot matches the effect', () => {
    const model = createAudioDynamicsViewModel(
      effect('audio-compressor', {
        thresholdDb: -18,
        ratio: 3,
      }),
      'Compressor',
      {
        effectId: 'audio-compressor-1',
        processorType: 'compressor',
        gainReductionDb: 5.25,
        updatedAt: 1000,
      },
    );

    expect(model?.liveGainReductionDb).toBe(5.25);
  });

  it('adds live sample-domain reduction for limiter, gate, and expander effects', () => {
    const limiter = createAudioDynamicsViewModel(
      effect('audio-limiter', {
        ceilingDb: -1,
        inputGainDb: 6,
      }),
      'Limiter',
      {
        effectId: 'audio-limiter-1',
        processorType: 'limiter',
        gainReductionDb: 3.5,
        updatedAt: 1000,
      },
    );
    const gate = createAudioDynamicsViewModel(
      effect('audio-noise-gate', {
        thresholdDb: -42,
        floorDb: -90,
      }),
      'Gate',
      {
        effectId: 'audio-noise-gate-1',
        processorType: 'noise-gate',
        gainReductionDb: 18,
        updatedAt: 1000,
      },
    );
    const expander = createAudioDynamicsViewModel(
      effect('audio-expander', {
        thresholdDb: -38,
        ratio: 2.5,
        rangeDb: 18,
      }),
      'Expander',
      {
        effectId: 'audio-expander-1',
        processorType: 'expander',
        gainReductionDb: 9,
        updatedAt: 1000,
      },
    );

    expect(limiter?.liveGainReductionDb).toBe(3.5);
    expect(gate?.liveGainReductionDb).toBe(18);
    expect(expander?.liveGainReductionDb).toBe(9);
  });
});
