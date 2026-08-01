import { describe, expect, it } from 'vitest';
import type { Layer } from '../../src/types/layers';
import { evaluateNestedComposition } from '../../src/services/compositionRender/layerEvaluation';
import { createMd1GoldenFixture } from '../../src/services/motionDesign/evidence/md1GoldenFixture';
import { LayerBuilderService } from '../../src/services/layerBuilder/LayerBuilderService';
import { useMediaStore } from '../../src/stores/mediaStore';
import { useTimelineStore } from '../../src/stores/timeline';

function evaluateFixture(time: number): Layer | null {
  const fixture = createMd1GoldenFixture();
  return evaluateNestedComposition({
    clip: fixture.nestedWrapperClip,
    parentTime: time,
    parentCompId: 'md1-parent',
    sources: {
      compositionId: fixture.nestedWrapperClip.compositionId!,
      clipSources: new Map(),
      pendingSourceDisposers: new Map(),
      isReady: true,
      disposed: false,
      lastAccessTime: 0,
    },
    compositions: [{
      id: fixture.nestedWrapperClip.compositionId!,
      width: fixture.width,
      height: fixture.height,
    }],
    mediaFiles: [],
    proxyEnabled: false,
    getVectorAnimationSettings: () => undefined,
    getClipKeyframes: () => undefined,
    getComposition: () => null,
    isCompositionReady: () => true,
    prepareComposition: () => {},
    evaluateCompositionAtTime: () => [],
  }) as Layer | null;
}

function rectangleGradientOpacity(layer: Layer | null): number | undefined {
  const rectangle = layer?.source?.nestedComposition?.layers.find(
    (candidate) => candidate.name === 'MD1 Rectangle',
  );
  if (rectangle?.source?.type !== 'motion' || rectangle.source.motion.kind !== 'shape') {
    return undefined;
  }
  return rectangle.source.motion.appearance?.items.find(
    (item) => item.id === 'md1-rect-gradient',
  )?.opacity;
}

describe('composition renderer nested Motion Design', () => {
  it('renders nested motion shapes and evaluates their embedded keyframes', () => {
    const atStart = evaluateFixture(0);
    const atEnd = evaluateFixture(1);

    expect(atStart?.source?.nestedComposition?.layers).toHaveLength(5);
    expect(atEnd?.source?.nestedComposition?.layers).toHaveLength(5);
    expect(rectangleGradientOpacity(atStart)).toBeCloseTo(0.3, 5);
    expect(rectangleGradientOpacity(atEnd)).toBeCloseTo(0.88, 5);
  });

  it('builds all nested motion layers from the live standalone timeline', () => {
    const timelineBefore = useTimelineStore.getState();
    const mediaBefore = useMediaStore.getState();
    const fixture = createMd1GoldenFixture();
    try {
      useTimelineStore.setState({
        tracks: [{
          id: fixture.nestedWrapperClip.trackId,
          name: 'Nested wrapper',
          type: 'video',
          height: 70,
          muted: false,
          visible: true,
          solo: false,
        }],
        clips: [fixture.nestedWrapperClip],
        clipKeyframes: new Map(),
        playheadPosition: fixture.sampleTime,
      });
      useMediaStore.setState({
        activeCompositionId: null,
        activeLayerSlots: {},
        compositions: [fixture.nestedComposition],
      });

      const layers = new LayerBuilderService().buildLayersFromStore();
      const nestedLayers = layers[0]?.source?.nestedComposition?.layers ?? [];
      expect(nestedLayers).toHaveLength(5);
      expect(nestedLayers.every((layer) => layer.source?.type === 'motion')).toBe(true);
      expect(rectangleGradientOpacity(layers[0])).toBeCloseTo(0.59, 5);
    } finally {
      useTimelineStore.setState({
        tracks: timelineBefore.tracks,
        clips: timelineBefore.clips,
        clipKeyframes: timelineBefore.clipKeyframes,
        playheadPosition: timelineBefore.playheadPosition,
      });
      useMediaStore.setState({
        activeCompositionId: mediaBefore.activeCompositionId,
        activeLayerSlots: mediaBefore.activeLayerSlots,
        compositions: mediaBefore.compositions,
      });
    }
  });
});
