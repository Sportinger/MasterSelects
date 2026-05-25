import { describe, expect, it } from 'vitest';
import {
  addClipCustomNodeDefinition,
  createClipAICustomNodeDefinition,
  hasRunnableAINodes,
  renderClipAINodesToCanvas,
  sortPixelsTexture,
} from '../../src/services/nodeGraph';
import { DEFAULT_TRANSFORM } from '../../src/stores/timeline/constants';
import type { LayerSource, TimelineClip } from '../../src/types';
import { primeTimelineLoudnessEnvelopeCache } from '../../src/services/audio/timelineLoudnessEnvelopeCache';
import {
  primeTimelineFrequencySummaryCache,
  primeTimelinePhaseCorrelationCache,
} from '../../src/services/audio/timelineFrequencyPhaseCache';
import { createMockTrack } from '../helpers/mockData';

function createClip(): TimelineClip {
  return {
    id: 'clip-1',
    trackId: 'video-1',
    name: 'Clip',
    file: new File([], 'clip.mp4', { type: 'video/mp4' }),
    startTime: 0,
    duration: 5,
    inPoint: 0,
    outPoint: 5,
    source: { type: 'video' },
    transform: structuredClone(DEFAULT_TRANSFORM),
    effects: [],
  };
}

describe('AI node runtime', () => {
  it('sorts RGBA pixels deterministically', () => {
    const output = sortPixelsTexture({
      width: 3,
      height: 1,
      data: new Uint8ClampedArray([
        255, 0, 0, 255,
        0, 0, 0, 255,
        0, 255, 0, 255,
      ]),
    });

    expect([...output.data]).toEqual([
      0, 0, 0, 255,
      0, 255, 0, 255,
      255, 0, 0, 255,
    ]);
  });

  it('does not run bypassed AI nodes', () => {
    const clip = createClip();
    const definition = {
      ...createClipAICustomNodeDefinition('custom-ai', clip),
      bypassed: true,
      status: 'ready' as const,
      ai: {
        prompt: 'sort all pixels',
        generatedCode: 'defineNode({ process(input) { return { output: input.input }; } })',
      },
    };
    const nodeGraph = addClipCustomNodeDefinition(clip, definition);

    expect(hasRunnableAINodes({ ...clip, nodeGraph })).toBe(false);
  });

  it('injects bounded artifact-only audio analysis context into generated AI nodes', () => {
    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = 6;
    sourceCanvas.height = 1;
    const sourceContext = sourceCanvas.getContext('2d');
    expect(sourceContext).not.toBeNull();
    const sourceImage = sourceContext?.createImageData(6, 1);
    expect(sourceImage).toBeDefined();
    sourceImage?.data.set([
      1, 2, 3, 255,
      4, 5, 6, 255,
      7, 8, 9, 255,
      10, 11, 12, 255,
      13, 14, 15, 255,
      16, 17, 18, 255,
    ]);
    if (sourceImage) {
      sourceContext?.putImageData(sourceImage, 0, 0);
    }

    const clip = createClip();
    const definition = {
      ...createClipAICustomNodeDefinition('custom-ai', clip),
      status: 'ready' as const,
      ai: {
        prompt: 'Read audio analysis context',
        generatedCode: `
          defineNode({
            process(input, context) {
              const audio = context.audio;
              const output = {
                ...input.input,
                data: new Uint8ClampedArray(input.input.data),
              };
              const serializedAudio = JSON.stringify(audio);
              output.data[0] = audio.analysis.source.waveform.artifactId === 'source-waveform' ? 101 : 0;
              output.data[1] = audio.analysis.processed.processedWaveform.artifactId === 'processed-waveform' ? 102 : 0;
              output.data[2] = audio.analysis.effective.waveform.artifactId === 'processed-waveform' ? 103 : 0;
              output.data[4] = audio.analysis.effective.loudness.artifactId === 'processed-loudness' ? 104 : 0;
              output.data[5] = audio.analysis.source.spectrogramTileSetCount === 20 ? 105 : 0;
              output.data[6] = context.signals.audioAnalysis.source.spectrogramTileSets.length === 16 ? 106 : 0;
              output.data[8] = audio.analysis.source.omittedSpectrogramTileSetCount === 4 ? 107 : 0;
              output.data[9] = input.audio.waveform.sampleCount === 1024 ? 108 : 0;
              output.data[10] = input.audio.waveform.preview.length === 256 ? 109 : 0;
              output.data[12] = context.metadata.audio.waveform.peak > 0.99 ? 110 : 0;
              output.data[13] = serializedAudio.includes('AudioBuffer') || serializedAudio.includes('Float32Array') || serializedAudio.includes('sampleRate') || Array.isArray(audio.waveform.samples) ? 0 : 111;
              output.data[16] = audio.routing.track.volumeDb === -6 && audio.routing.track.effectStack[0].descriptorId === 'audio-compressor' ? 112 : 0;
              output.data[17] = audio.routing.master.volumeDb === -1 && audio.routing.master.effectStack[0].descriptorId === 'audio-low-pass' ? 113 : 0;
              output.data[20] = audio.repairSuggestions.some(suggestion => suggestion.kind === 'hum-notch' && suggestion.operation.params.baseFrequencyHz === 50) ? 114 : 0;
              output.data[21] = context.signals.audioRepairSuggestions === audio.repairSuggestions ? 115 : 0;
              output.data[18] = audio.analysis.effective.frequencyBands.frequencyBandSummary.dominantBandId === 'mains' ? 116 : 0;
              output.data[22] = context.signals.frequencyBands === audio.analysis.effective.frequencyBands && context.signals.audioMetadata.waveformSampleCount === 1024 && audio.metadata.trackId === 'video-1' ? 117 : 0;
              return { output };
            }
          })
        `,
      },
    };
    const nodeGraph = addClipCustomNodeDefinition(clip, definition);
    const audioClip: TimelineClip = {
      ...clip,
      nodeGraph,
      waveform: Array.from({ length: 1024 }, (_, index) => Math.sin(index)),
      audioState: {
        sourceAudioRevisionId: 'audio-rev-1',
        sourceAnalysisRefs: {
          waveformPyramidId: 'source-waveform',
          spectrogramTileSetIds: Array.from({ length: 20 }, (_, index) => `source-spectrum-${index + 1}`),
          loudnessEnvelopeId: 'source-loudness',
        },
        processedAnalysisRefs: {
          processedWaveformPyramidId: 'processed-waveform',
          loudnessEnvelopeId: 'processed-loudness',
          frequencySummaryId: 'processed-frequency',
          phaseCorrelationId: 'processed-phase',
        },
      },
    };
    primeTimelineLoudnessEnvelopeCache(['processed-loudness'], {
      sampleRate: 48_000,
      duration: 5,
      curves: [],
      summary: {
        integratedLufs: -31,
        truePeakDbtp: -0.2,
        samplePeakDbfs: -0.4,
        rmsDbfs: -28,
      },
    });
    primeTimelineFrequencySummaryCache(['processed-frequency'], {
      sampleRate: 48_000,
      duration: 5,
      fftSize: 2048,
      hopSize: 512,
      summary: {
        spectralCentroidHz: 240,
        lowEnergyShare: 0.62,
        midEnergyShare: 0.32,
        highEnergyShare: 0.06,
        dominantBandId: 'mains',
      },
      bands: [{
        bandId: 'mains',
        label: '50 Hz',
        minFrequency: 45,
        maxFrequency: 55,
        rmsDb: -21,
        peakDb: -12,
        energyShare: 0.24,
        centroidHz: 50,
      }],
    });
    primeTimelinePhaseCorrelationCache(['processed-phase'], {
      sampleRate: 48_000,
      duration: 5,
      windowDuration: 0.4,
      hopDuration: 0.1,
      points: [],
      summary: {
        averageCorrelation: 0.12,
        minimumCorrelation: -0.58,
        maximumCorrelation: 0.8,
        negativeCorrelationPercent: 22,
        averageMidSideRatioDb: 5,
        stereoWidth: 1.5,
        monoCompatible: false,
      },
    });
    const source: LayerSource = {
      type: 'text',
      textCanvas: sourceCanvas,
    };
    const track = createMockTrack({
      id: 'video-1',
      name: 'Video 1',
      type: 'video',
      muted: false,
      solo: false,
      audioState: {
        volumeDb: -6,
        pan: 0.25,
        muted: false,
        solo: false,
        meterMode: 'lufs',
        effectStack: [
          {
            id: 'track-compressor',
            descriptorId: 'audio-compressor',
            enabled: true,
            params: { thresholdDb: -18, ratio: 3 },
          },
        ],
      },
    });
    const masterAudioState = {
      volumeDb: -1,
      limiterEnabled: true,
      truePeakCeilingDb: -1,
      effectStack: [
        {
          id: 'master-low-pass',
          descriptorId: 'audio-low-pass',
          enabled: true,
          params: { frequencyHz: 18000, q: 0.707 },
        },
      ],
    };

    const outputCanvas = renderClipAINodesToCanvas(audioClip, source, 'layer-1', 0, undefined, {
      track,
      masterAudioState,
    });
    expect(outputCanvas).not.toBeNull();
    const outputData = outputCanvas?.getContext('2d')?.getImageData(0, 0, 6, 1).data;

    expect(outputData?.[0]).toBe(101);
    expect(outputData?.[1]).toBe(102);
    expect(outputData?.[2]).toBe(103);
    expect(outputData?.[4]).toBe(104);
    expect(outputData?.[5]).toBe(105);
    expect(outputData?.[6]).toBe(106);
    expect(outputData?.[8]).toBe(107);
    expect(outputData?.[9]).toBe(108);
    expect(outputData?.[10]).toBe(109);
    expect(outputData?.[12]).toBe(110);
    expect(outputData?.[13]).toBe(111);
    expect(outputData?.[16]).toBe(112);
    expect(outputData?.[17]).toBe(113);
    expect(outputData?.[20]).toBe(114);
    expect(outputData?.[21]).toBe(115);
    expect(outputData?.[18]).toBe(116);
    expect(outputData?.[22]).toBe(117);
  });
});
