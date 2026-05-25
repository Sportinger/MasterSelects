import { describe, expect, it } from 'vitest';
import { createMockClip } from '../../helpers/mockData';
import { createAudioRepairSuggestionOperation } from '../../../src/services/audio/audioRepairSuggestionOperations';

describe('audio repair suggestion operations', () => {
  it('creates the same whole-clip non-destructive operation used by preview and apply paths', () => {
    const clip = createMockClip({
      id: 'audio-clip',
      startTime: 12,
      duration: 5,
      inPoint: 3,
      outPoint: 8,
    });

    const operation = createAudioRepairSuggestionOperation(clip, {
      id: 'audio-repair:hum-notch',
      kind: 'hum-notch',
      label: '50 Hz hum notch',
      severity: 'warning',
      confidence: 0.84,
      reason: '50 Hz carries concentrated low-frequency energy.',
      operation: {
        editType: 'repair',
        params: {
          repairType: 'hum-notch',
          baseFrequencyHz: 50,
          harmonicCount: 6,
          q: 35,
        },
      },
      evidence: {
        energyShare: 0.24,
        peakDb: -12,
      },
    }, {
      id: 'edit-a',
      createdAt: 1234,
    });

    expect(operation).toEqual({
      id: 'edit-a',
      type: 'repair',
      enabled: true,
      timeRange: { start: 3, end: 8 },
      createdAt: 1234,
      params: expect.objectContaining({
        label: '50 Hz hum notch',
        timelineStart: 12,
        timelineEnd: 17,
        preserveClipDuration: true,
        repairType: 'hum-notch',
        baseFrequencyHz: 50,
        repairSuggestionId: 'audio-repair:hum-notch',
        repairSuggestionKind: 'hum-notch',
        repairSuggestionSeverity: 'warning',
        repairSuggestionConfidence: 0.84,
        repairSuggestionReason: '50 Hz carries concentrated low-frequency energy.',
        repairSuggestionEvidence: JSON.stringify({ energyShare: 0.24, peakDb: -12 }),
      }),
    });
  });

  it('rejects empty source ranges', () => {
    const clip = createMockClip({
      id: 'audio-clip',
      duration: 0,
      inPoint: 4,
      outPoint: 4,
    });

    expect(createAudioRepairSuggestionOperation(clip, {
      id: 'audio-repair:mono',
      kind: 'mono-compatibility',
      label: 'Check mono compatibility',
      operation: {
        editType: 'mono-sum',
        params: {},
      },
    }, {
      id: 'edit-a',
      createdAt: 1234,
    })).toBeNull();
  });
});
