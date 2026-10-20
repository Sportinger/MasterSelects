import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { ensureTransitionCompositionForPair } from '../../src/services/timeline/transitionCompositionService';
import { reuseExistingTimelineData } from '../../src/services/timeline/transitionCompositionReuse';
import { resolveTransitionRecipeBlendMode } from '../../src/services/timeline/transitionRecipeBlendWindows';
import { evaluateTransitionMappedAnimation } from '../../src/services/compositionRender/transitionMappedAnimation';
import { createTransitionNestedCompositionLayer } from '../../src/services/layerBuilder/transitionNestedCompositionLayer';
import {
  COMPOSITOR_PREMULTIPLIED_SOURCE_FLAG,
  COMPOSITOR_UNIFORM_FLOAT_COUNT,
  writeLayerUniformData,
} from '../../src/engine/pipeline/compositor/uniforms';
import { findUnrenderedAudioCrossfades } from '../../src/engine/audio/exportPipeline/unrenderedAudioCrossfades';
import { getCrossfadeAudioGains } from '../../src/transitions';
import type { Composition } from '../../src/stores/mediaStore';
import type { Layer } from '../../src/types/layers';
import type { SerializableClip, TimelineClip } from '../../src/types/timeline';

vi.mock('../../src/services/compositionRenderer', () => ({
  compositionRenderer: { invalidateCompositionAndParents: vi.fn() },
}));

function serializableClip(id: string, startTime: number, opacity = 1): SerializableClip {
  return {
    id,
    trackId: 'track-1',
    name: id,
    mediaFileId: `${id}-media`,
    startTime,
    duration: 2,
    inPoint: 0,
    outPoint: 2,
    sourceType: 'video',
    naturalDuration: 2,
    transform: {
      opacity,
      blendMode: 'normal',
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      rotation: { x: 0, y: 0, z: 0 },
    },
    effects: [],
  };
}

function timelineClip(clip: SerializableClip): TimelineClip {
  return {
    ...clip,
    file: new File([], `${clip.id}.mp4`),
    source: { type: 'video', mediaFileId: clip.mediaFileId, naturalDuration: clip.naturalDuration },
  } as TimelineClip;
}

function buildComposition(type: string, outgoingOpacity = 1, incomingOpacity = 1): Composition {
  const serializableClips = [serializableClip('out', 0, outgoingOpacity), serializableClip('in', 2, incomingOpacity)];
  const timelineClips = serializableClips.map(timelineClip);
  timelineClips[0].transitionOut = { id: 'transition-1', type, duration: 1, linkedClipId: 'in' };
  timelineClips[1].transitionIn = { id: 'transition-1', type, duration: 1, linkedClipId: 'out' };
  const parent: Composition = {
    id: 'parent', name: 'Parent', type: 'composition', parentId: null, createdAt: 1,
    width: 1920, height: 1080, frameRate: 30, duration: 8, backgroundColor: '#000000',
    timelineData: { tracks: [], clips: serializableClips, duration: 8 },
  };
  const compositions: Composition[] = [parent];
  const id = ensureTransitionCompositionForPair({
    outgoingClipId: 'out',
    transitionId: 'transition-1',
    timelineClips,
    serializableClips,
    parentComposition: parent,
    compositions,
    createComposition: (_name, settings) => {
      const composition: Composition = {
        id: 'transition-comp-1', name: 'Transition', type: 'composition', parentId: null, createdAt: 2,
        width: 1920, height: 1080, frameRate: 30, duration: settings?.duration ?? 1,
        backgroundColor: '#000000', timelineData: settings?.timelineData, transitionComp: settings?.transitionComp,
      };
      compositions.push(composition);
      return composition;
    },
    updateComposition: () => {},
    attachTransitionComposition: () => {},
  });
  const composition = compositions.find((candidate) => candidate.id === id);
  if (!composition) throw new Error('Expected a transition composition');
  return composition;
}

function source(composition: Composition, target: 'outgoing' | 'incoming'): SerializableClip {
  const clip = composition.timelineData?.clips.find((candidate) => candidate.id === `transition-comp:transition-1:${target}`);
  if (!clip) throw new Error(`Expected ${target} source`);
  return clip;
}

function opacityAt(clip: SerializableClip, time: number): number | undefined {
  return evaluateTransitionMappedAnimation(clip, clip.keyframes, time)?.transform.opacity;
}

describe('crossfade transition', () => {
  it('fades the outgoing clip out and adds the incoming clip with the plus operator', () => {
    const composition = buildComposition('crossfade');
    const outgoing = source(composition, 'outgoing');
    const incoming = source(composition, 'incoming');

    expect(opacityAt(outgoing, 0)).toBeCloseTo(1);
    expect(opacityAt(outgoing, 0.25)).toBeCloseTo(0.75);
    expect(opacityAt(outgoing, 1)).toBeCloseTo(0);
    expect(opacityAt(incoming, 0.25)).toBeCloseTo(0.25);
    expect(outgoing.transitionRecipeBlendWindows).toBeUndefined();
    expect(incoming.transitionRecipeBlendWindows).toEqual([{ compStart: 0, compEnd: 1, blendMode: 'plus' }]);
    expect(resolveTransitionRecipeBlendMode(incoming.transitionRecipeBlendWindows, 0.5, 'normal')).toBe('plus');
  });

  it('keeps each clip\'s own opacity through the transition instead of ramping to 100 %', () => {
    const composition = buildComposition('crossfade', 0.8, 0.5);
    const outgoing = source(composition, 'outgoing');
    const incoming = source(composition, 'incoming');

    expect(opacityAt(outgoing, 0)).toBeCloseTo(0.8);
    expect(opacityAt(outgoing, 0.5)).toBeCloseTo(0.4);
    expect(opacityAt(incoming, 0.5)).toBeCloseTo(0.25);
    // At the end the incoming clip has its own 50 %, so nothing jumps after the transition.
    expect(opacityAt(incoming, 1)).toBeCloseTo(0.5);
    // Same for every recipe opacity primitive, e.g. the second half of Dip to Black.
    expect(opacityAt(source(buildComposition('dip-to-black', 1, 0.5), 'incoming'), 1)).toBeCloseTo(0.5);
  });

  it('rebuilds stored crossfade compositions from before the recipe revision', () => {
    const current = buildComposition('crossfade');
    const key = current.transitionComp?.templateParamsKey ?? '';
    expect(JSON.parse(key)).toEqual({ params: [], recipeRevision: 1 });
    // Transitions without a revision keep their former key, so their stored comps are reused.
    expect(JSON.parse(buildComposition('wipe-left').transitionComp?.templateParamsKey ?? '')).toEqual({ params: [] });

    const generated = {
      timelineData: current.timelineData!,
      link: { ...current.transitionComp!, materialized: true },
    };
    const stale: Composition = {
      ...current,
      transitionComp: { ...current.transitionComp!, templateParamsKey: JSON.stringify({ params: [] }) },
      timelineData: {
        ...current.timelineData!,
        clips: current.timelineData!.clips.map((clip) => ({ ...clip, keyframes: [] })),
      },
    };
    expect(reuseExistingTimelineData(stale, generated, true)).toBe(generated.timelineData);
  });

  it('composites transition compositions as premultiplied sources', () => {
    const layer = createTransitionNestedCompositionLayer({
      transition: { id: 'transition-1', type: 'crossfade', duration: 1, linkedClipId: 'in' },
      composition: buildComposition('crossfade'),
      compositionTime: 0.5,
      nestedLayers: [],
      layerIndex: 0,
      layerIdPrefix: 'test',
    });
    expect(layer.premultipliedAlpha).toBe(true);

    const float = new Float32Array(COMPOSITOR_UNIFORM_FLOAT_COUNT);
    const u32 = new Uint32Array(float.buffer);
    writeLayerUniformData(layer as Layer, 16 / 9, 16 / 9, false, float, u32);
    expect(u32[1]).toBe(0 | COMPOSITOR_PREMULTIPLIED_SOURCE_FLAG);
    writeLayerUniformData({ ...layer, premultipliedAlpha: false, blendMode: 'plus' } as Layer, 16 / 9, 16 / 9, false, float, u32);
    expect(u32[1]).toBe(37);

    for (const file of ['src/shaders/composite.wgsl', 'src/engine/pipeline/compositor/externalCompositeShader.ts']) {
      const shader = readFileSync(path.join(process.cwd(), file), 'utf8');
      expect(shader).toContain('let blendMode = layer.blendMode & 0xFFu;');
      expect(shader).toContain('if (blendMode == 37u) {');
      expect(shader).toContain('min(baseColor.rgb + blended * plusAlpha, vec3f(1.0)), min(baseColor.a + plusAlpha, 1.0)');
      expect(shader).not.toMatch(/switch \(layer\.blendMode\)/);
    }
    expect(readFileSync(path.join(process.cwd(), 'src/shaders/composite.wgsl'), 'utf8'))
      .toContain('layerColor = vec4f(layerColor.rgb / layerColor.a, layerColor.a);');
  });

  it('uses equal-power audio gains', () => {
    const middle = getCrossfadeAudioGains(0.5);
    expect(middle.outgoing).toBeCloseTo(Math.SQRT1_2);
    expect(middle.incoming).toBeCloseTo(Math.SQRT1_2);
    for (const progress of [0, 0.1, 0.33, 0.9, 1]) {
      const gains = getCrossfadeAudioGains(progress);
      expect(gains.outgoing ** 2 + gains.incoming ** 2).toBeCloseTo(1);
    }
    expect(getCrossfadeAudioGains(-1)).toEqual({ outgoing: 1, incoming: 0 });
    expect(getCrossfadeAudioGains(2).incoming).toBe(1);
    expect(getCrossfadeAudioGains(Number.NaN)).toEqual({ outgoing: 1, incoming: 0 });
  });

  it('names audio crossfades the export does not render yet', () => {
    const clip = (id: string, startTime: number, type: 'audio' | 'video', extra: Partial<TimelineClip> = {}) => ({
      id, trackId: type, name: id, startTime, duration: 4, inPoint: 0, outPoint: 4,
      source: { type }, effects: [], ...extra,
    }) as unknown as TimelineClip;
    const crossfade = (linkedClipId: string, includeAudio?: boolean) => ({
      id: `x-${linkedClipId}`, type: 'crossfade' as const, duration: 2, linkedClipId,
      ...(includeAudio === undefined ? {} : { params: { includeAudio } }),
    });
    const clips = [
      clip('a1', 0, 'audio', { transitionOut: crossfade('a2') }),
      clip('a2', 4, 'audio'),
      clip('v1', 10, 'video', { linkedClipId: 'va1', transitionOut: crossfade('v2', true) }),
      clip('v2', 14, 'video', { linkedClipId: 'va2' }),
      clip('va1', 10, 'audio', { linkedClipId: 'v1' }),
      clip('va2', 14, 'audio', { linkedClipId: 'v2' }),
      clip('w1', 20, 'video', { linkedClipId: 'wa1', transitionOut: crossfade('w2', false) }),
      clip('w2', 24, 'video', { linkedClipId: 'wa2' }),
      clip('wa1', 20, 'audio', { linkedClipId: 'w1' }),
      clip('wa2', 24, 'audio', { linkedClipId: 'w2' }),
    ];
    expect(findUnrenderedAudioCrossfades(clips, 0, 30).map(({ outgoingClipId, kind, junctionTime }) => [outgoingClipId, kind, junctionTime]))
      .toEqual([['a1', 'audio-clips', 4], ['v1', 'linked-audio', 14]]);
    expect(findUnrenderedAudioCrossfades(clips, 5.5, 12)).toEqual([]);
  });
});
