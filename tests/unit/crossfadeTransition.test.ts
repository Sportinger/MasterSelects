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
import { getCrossfadeAudioGains } from '../../src/transitions';
import { resolveTransitionCompositionBlend } from '../../src/services/layerBuilder/transitionCompositionBlend';
import { Logger } from '../../src/services/logger';
import type { Composition } from '../../src/stores/mediaStore';
import type { BlendMode } from '../../src/types/blendMode';
import type { Layer } from '../../src/types/layers';
import type { SerializableClip, TimelineClip } from '../../src/types/timeline';

vi.mock('../../src/services/compositionRenderer', () => ({
  compositionRenderer: { invalidateCompositionAndParents: vi.fn() },
}));

function serializableClip(id: string, startTime: number, opacity = 1, blendMode: BlendMode = 'normal'): SerializableClip {
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
      blendMode,
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

function buildComposition(
  type: string,
  outgoingOpacity = 1,
  incomingOpacity = 1,
  blendModes: [BlendMode, BlendMode] = ['normal', 'normal'],
): Composition {
  const serializableClips = [
    serializableClip('out', 0, outgoingOpacity, blendModes[0]),
    serializableClip('in', 2, incomingOpacity, blendModes[1]),
  ];
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

  it('upgrades stored crossfade compositions in place and keeps the user\'s changes inside them', () => {
    const current = buildComposition('crossfade');
    expect(JSON.parse(current.transitionComp?.templateParamsKey ?? '')).toEqual({ params: [], revision: [1, 1] });
    expect(JSON.parse(buildComposition('wipe-left').transitionComp?.templateParamsKey ?? '')).toEqual({ params: [], revision: [1, 0] });

    const generated = { timelineData: current.timelineData!, link: { ...current.transitionComp!, materialized: true } };
    const outgoingId = 'transition-comp:transition-1:outgoing';
    const userKeyframe = { id: 'kf_user_scale', clipId: outgoingId, property: 'scale.x' as const, time: 0.5, value: 1.2, easing: 'linear' as const };
    const userEffect = { id: 'user-blur', name: 'Blur', type: 'blur', enabled: true, params: { radius: 4 } } as SerializableClip['effects'][number];
    const titleClip = { ...serializableClip('user-title', 0), trackId: 'user-track', name: 'Title' };
    // A composition from before the revision: old key, old recipe keyframes, plus edits made inside it.
    const stale: Composition = {
      ...current,
      transitionComp: { ...current.transitionComp!, templateParamsKey: JSON.stringify({ params: [] }) },
      timelineData: {
        ...current.timelineData!,
        clips: [
          ...current.timelineData!.clips.map((clip) => clip.id === outgoingId
            ? { ...clip, keyframes: [userKeyframe], effects: [userEffect], transitionRecipeBlendWindows: undefined }
            : { ...clip, transitionRecipeBlendWindows: undefined }),
          titleClip,
        ],
      },
    };
    Logger.clear();

    const upgraded = reuseExistingTimelineData(stale, generated, true);
    const upgradedOutgoing = upgraded.clips.find((clip) => clip.id === outgoingId)!;
    const upgradedIncoming = upgraded.clips.find((clip) => clip.id === 'transition-comp:transition-1:incoming')!;

    expect(upgraded).not.toBe(generated.timelineData);
    expect(upgraded.clips.map((clip) => clip.id)).toContain('user-title');
    expect(upgradedOutgoing.effects).toEqual([userEffect]);
    expect(upgradedOutgoing.keyframes).toContainEqual(userKeyframe);
    expect(opacityAt(upgradedOutgoing, 0.25)).toBeCloseTo(0.75);
    expect(upgradedIncoming.transitionRecipeBlendWindows).toEqual([{ compStart: 0, compEnd: 1, blendMode: 'plus' }]);

    // A parameter change still rebuilds the composition, and says so.
    const changedParams = {
      ...stale,
      transitionComp: { ...stale.transitionComp!, templateParamsKey: JSON.stringify({ params: [['includeAudio', true]] }) },
    };
    expect(reuseExistingTimelineData(changedParams, generated, true)).toBe(generated.timelineData);
    expect(Logger.search('changes made inside it were replaced').map((entry) => entry.data))
      .toEqual([expect.objectContaining({ reason: 'transition parameters changed' })]);
  });

  it('carries the clips\' shared blend mode through the transition instead of a transparent background', () => {
    const composition = buildComposition('crossfade', 1, 1, ['screen', 'screen']);
    const layer = (id: string, blendMode: BlendMode, opacity: number) =>
      ({ id, sourceClipId: id, blendMode, opacity, visible: true }) as Layer;
    const nestedLayers = [
      layer('transition-comp:transition-1:incoming', 'plus', 0.5),
      layer('transition-comp:transition-1:outgoing', 'screen', 0.5),
    ];
    const transitionLayer = createTransitionNestedCompositionLayer({
      transition: { id: 'transition-1', type: 'crossfade', duration: 1, linkedClipId: 'in' },
      composition,
      compositionTime: 0.5,
      nestedLayers,
      layerIndex: 0,
      layerIdPrefix: 'test',
    });
    const nested = transitionLayer.source?.nestedComposition?.layers ?? [];

    // Screen blends the finished dissolve over the lower tracks; inside, the clips dissolve plainly.
    expect(transitionLayer.blendMode).toBe('screen');
    expect(transitionLayer.premultipliedAlpha).toBe(true);
    expect(nested.map((candidate) => candidate.blendMode)).toEqual(['plus', 'normal']);
    expect(nested.map((candidate) => candidate.opacity)).toEqual([0.5, 0.5]);

    // Multiply would turn black over the transparent composition background, so it moves out too.
    expect(resolveTransitionCompositionBlend({
      transitionId: 'transition-1',
      composition: buildComposition('crossfade', 1, 1, ['multiply', 'multiply']),
      nestedLayers: [layer('transition-comp:transition-1:outgoing', 'multiply', 1)],
    })).toMatchObject({ blendMode: 'multiply', nestedLayers: [{ blendMode: 'normal' }] });
    // Normal clips are untouched.
    expect(resolveTransitionCompositionBlend({ transitionId: 'transition-1', composition: buildComposition('crossfade'), nestedLayers }))
      .toMatchObject({ blendMode: 'normal', nestedLayers });
  });

  it('falls back to Normal for clips with different blend modes and says so', () => {
    Logger.clear();
    const warnings = () => Logger.search('different blend modes');
    const resolution = resolveTransitionCompositionBlend({
      transitionId: 'transition-mixed',
      composition: buildComposition('crossfade', 1, 1, ['normal', 'screen']),
      nestedLayers: [{ id: 'in', sourceClipId: 'transition-comp:transition-1:incoming', blendMode: 'screen', opacity: 1, visible: true } as Layer],
    });
    expect(resolution).toMatchObject({ blendMode: 'normal', fallback: 'mixed-blend-modes', nestedLayers: [{ blendMode: 'normal' }] });
    expect(warnings()).toHaveLength(1);
    resolveTransitionCompositionBlend({
      transitionId: 'transition-mixed',
      composition: buildComposition('crossfade', 1, 1, ['normal', 'screen']),
      nestedLayers: [],
    });
    expect(warnings()).toHaveLength(1);
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
});
