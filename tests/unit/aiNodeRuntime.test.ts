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
    sourceCanvas.width = 4;
    sourceCanvas.height = 1;
    const sourceContext = sourceCanvas.getContext('2d');
    expect(sourceContext).not.toBeNull();
    const sourceImage = sourceContext?.createImageData(4, 1);
    expect(sourceImage).toBeDefined();
    sourceImage?.data.set([
      1, 2, 3, 255,
      4, 5, 6, 255,
      7, 8, 9, 255,
      10, 11, 12, 255,
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
        },
      },
    };
    const source: LayerSource = {
      type: 'text',
      textCanvas: sourceCanvas,
    };

    const outputCanvas = renderClipAINodesToCanvas(audioClip, source, 'layer-1', 0);
    expect(outputCanvas).not.toBeNull();
    const outputData = outputCanvas?.getContext('2d')?.getImageData(0, 0, 4, 1).data;

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
  });
});
