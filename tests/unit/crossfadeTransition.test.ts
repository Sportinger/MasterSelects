import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { ensureTransitionCompositionForPair } from '../../src/services/timeline/transitionCompositionService';
import { reuseExistingTimelineData } from '../../src/services/timeline/transitionCompositionReuse';
import { resolveTransitionRecipeBlendMode } from '../../src/services/timeline/transitionRecipeBlendWindows';
import { evaluateTransitionMappedAnimation } from '../../src/services/compositionRender/transitionMappedAnimation';
import { createTransitionNestedCompositionLayers } from '../../src/services/layerBuilder/transitionNestedCompositionLayer';
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
import type { CompositionTimelineData, SerializableClip, TimelineClip } from '../../src/types/timeline';

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
  return buildCompositionFrom(type, [
    serializableClip('out', 0, outgoingOpacity, blendModes[0]),
    serializableClip('in', 2, incomingOpacity, blendModes[1]),
  ]);
}

function buildCompositionFrom(type: string, serializableClips: SerializableClip[]): Composition {
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
  // Info entries reach the log buffer only at the INFO level.
  beforeAll(() => Logger.setLevel('INFO'));
  afterAll(() => Logger.setLevel('WARN'));

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

  it('still fades a clip at static opacity 0 that its own opacity keyframes make visible', () => {
    const serializableClips = [serializableClip('out', 0, 0), serializableClip('in', 2)];
    // Visible only through keyframes: the static value stays 0.
    serializableClips[0].keyframes = [0, 2].map((time) => ({
      id: `own-${time}`, clipId: 'out', time, property: 'opacity' as const, value: 1, easing: 'linear' as const,
    }));
    const composition = buildCompositionFrom('crossfade', serializableClips);
    const outgoing = source(composition, 'outgoing');

    expect(opacityAt(outgoing, 0)).toBeCloseTo(1);
    expect(opacityAt(outgoing, 0.5)).toBeCloseTo(0.5);
    expect(opacityAt(outgoing, 1)).toBeCloseTo(0);
    // Without generated opacity keyframes (a wipe), the clip keeps its own animation.
    const wipeOutgoing = source(buildCompositionFrom('wipe-left', serializableClips), 'outgoing');
    expect(opacityAt(wipeOutgoing, 0.5)).toBeCloseTo(1);
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

    // A parameter that changes the picture still rebuilds the composition, and says so.
    const changedParams = {
      ...stale,
      transitionComp: { ...stale.transitionComp!, templateParamsKey: JSON.stringify({ params: [['color', '#ff0000']], revision: [1, 1] }) },
    };
    expect(reuseExistingTimelineData(changedParams, generated, true)).toBe(generated.timelineData);
    expect(Logger.search('changes made inside it were replaced').map((entry) => entry.data))
      .toEqual([expect.objectContaining({ reason: 'transition parameters changed' })]);
  });

  it('keeps changes made inside the composition when only a sound setting changes', () => {
    const current = buildComposition('crossfade');
    const outgoingId = 'transition-comp:transition-1:outgoing';
    const userEffect = { id: 'user-grade', name: 'Brightness', type: 'brightness', enabled: true, params: { amount: 0.2 } } as SerializableClip['effects'][number];
    const edited: Composition = {
      ...current,
      timelineData: {
        ...current.timelineData!,
        clips: current.timelineData!.clips.map((clip) => clip.id === outgoingId ? { ...clip, effects: [userEffect] } : clip),
      },
    };
    const keyWith = (params: unknown[]) => JSON.stringify({ params, revision: [1, 1] });
    // Include audio and the audio curve leave the template key, also in keys stored before this rule.
    const generated = {
      timelineData: current.timelineData!,
      link: { ...current.transitionComp!, templateParamsKey: keyWith([['audioCurve', 'equal-gain'], ['includeAudio', true]]), materialized: true },
    };
    expect(JSON.parse(current.transitionComp!.templateParamsKey!)).toEqual({ params: [], revision: [1, 1] });
    const stored = { ...edited, transitionComp: { ...edited.transitionComp!, templateParamsKey: keyWith([['includeAudio', false]]) } };
    Logger.clear();
    const reused = reuseExistingTimelineData(stored, generated, true);
    expect(reused).not.toBe(generated.timelineData);
    expect(reused.clips.find((clip) => clip.id === outgoingId)?.effects).toEqual([userEffect]);
    expect(Logger.search('Rebuilt a transition composition')).toHaveLength(0);
  });

  it('keeps generated keyframes the user edited when a stored composition is upgraded', () => {
    for (const type of ['crossfade', 'wipe-left']) {
      const current = buildComposition(type);
      const generated = { timelineData: current.timelineData!, link: { ...current.transitionComp!, materialized: true } };
      const generatedKeys = current.timelineData!.clips.flatMap((clip) => (clip.keyframes ?? []).map((keyframe) => ({ clip, keyframe })));
      expect(generatedKeys.length).toBeGreaterThan(1);
      const [edited, untouched] = generatedKeys;
      const editedKeyframe = { ...edited.keyframe, easing: 'ease-in-out' as const, value: edited.keyframe.value + 0.25 };
      const stale: Composition = {
        ...current,
        transitionComp: { ...current.transitionComp!, templateParamsKey: JSON.stringify({ params: [] }) },
        timelineData: {
          ...current.timelineData!,
          clips: current.timelineData!.clips.map((clip) => ({
            ...clip,
            keyframes: clip.keyframes?.map((keyframe) => keyframe.id === edited.keyframe.id ? editedKeyframe : keyframe),
          })),
        },
      };
      Logger.clear();
      const upgraded = reuseExistingTimelineData(stale, generated, true);
      const keyframes = upgraded.clips.flatMap((clip) => clip.keyframes ?? []);
      expect(keyframes.find((keyframe) => keyframe.id === edited.keyframe.id), type).toEqual(editedKeyframe);
      expect(keyframes.find((keyframe) => keyframe.id === untouched.keyframe.id), type).toEqual(untouched.keyframe);
      expect(keyframes.filter((keyframe) => keyframe.id === edited.keyframe.id), type).toHaveLength(1);
      expect(Logger.search('generated items edited inside it were kept').map((entry) => entry.data), type)
        .toEqual([expect.objectContaining({ keptEditedItems: [edited.keyframe.id] })]);
    }
  });

  it('upgrades a generated keyframe written before the opacity scaling and does not mistake it for an edit', () => {
    const current = buildComposition('crossfade', 0.5, 1);
    const outgoingId = 'transition-comp:transition-1:outgoing';
    const generated = { timelineData: current.timelineData!, link: { ...current.transitionComp!, materialized: true } };
    // Revision 0 wrote recipe opacity unscaled: 1 → 0 instead of 0.5 → 0.
    const stale: Composition = {
      ...current,
      transitionComp: { ...current.transitionComp!, templateParamsKey: JSON.stringify({ params: [] }) },
      timelineData: {
        ...current.timelineData!,
        clips: current.timelineData!.clips.map((clip) => clip.id === outgoingId
          ? { ...clip, keyframes: clip.keyframes?.map((keyframe) => ({ ...keyframe, value: keyframe.value / 0.5 })) }
          : clip),
      },
    };
    Logger.clear();
    const upgraded = reuseExistingTimelineData(stale, generated, true);
    expect(opacityAt(upgraded.clips.find((clip) => clip.id === outgoingId)!, 0)).toBeCloseTo(0.5);
    expect(Logger.search('generated items edited inside it were kept')).toHaveLength(0);
  });

  it('does not report changes inside a rebuilt composition that only carries the source clip\'s own effects', () => {
    const current = buildComposition('crossfade');
    const outgoingId = 'transition-comp:transition-1:outgoing';
    const sourceGrade = { id: 'source-grade', name: 'Brightness', type: 'brightness', enabled: true, params: { amount: 0.2 } } as SerializableClip['effects'][number];
    const withSourceEffect = (composition: Composition): CompositionTimelineData => ({
      ...composition.timelineData!,
      clips: composition.timelineData!.clips.map((clip) => clip.id === outgoingId
        ? { ...clip, effects: [sourceGrade, ...clip.effects] }
        : clip),
    });
    const generated = { timelineData: withSourceEffect(current), link: { ...current.transitionComp!, materialized: true } };
    const stored = {
      ...current,
      timelineData: withSourceEffect(current),
      transitionComp: { ...current.transitionComp!, templateParamsKey: JSON.stringify({ params: [['color', '#00ff00']], revision: [1, 1] }) },
    };
    Logger.clear();
    expect(reuseExistingTimelineData(stored, generated, true)).toBe(generated.timelineData);
    expect(Logger.search('changes made inside it were replaced')).toHaveLength(0);
    expect(Logger.search('Rebuilt a transition composition from its template')).toHaveLength(1);
  });

  it('carries the clips\' shared blend mode through the transition instead of a transparent background', () => {
    const composition = buildComposition('crossfade', 1, 1, ['screen', 'screen']);
    const layer = (id: string, blendMode: BlendMode, opacity: number) =>
      ({ id, sourceClipId: id, blendMode, opacity, visible: true }) as Layer;
    const nestedLayers = [
      layer('transition-comp:transition-1:incoming', 'plus', 0.5),
      layer('transition-comp:transition-1:outgoing', 'screen', 0.5),
    ];
    const transitionLayers = createTransitionNestedCompositionLayers({
      transition: { id: 'transition-1', type: 'crossfade', duration: 1, linkedClipId: 'in' },
      composition,
      compositionTime: 0.5,
      nestedLayers,
      layerIndex: 0,
      layerIdPrefix: 'test',
    });
    expect(transitionLayers).toHaveLength(1);
    const [transitionLayer] = transitionLayers;
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
    }).parts).toMatchObject([{ blendMode: 'multiply', nestedLayers: [{ blendMode: 'normal' }] }]);
    // Normal clips are untouched.
    expect(resolveTransitionCompositionBlend({ transitionId: 'transition-1', composition: buildComposition('crossfade'), nestedLayers }).parts)
      .toEqual([{ blendMode: 'normal', nestedLayers }]);
  });

  it('draws clips with different blend modes as two parts, each in its own mode, and says so', () => {
    Logger.clear();
    const notes = () => Logger.search('different blend modes');
    const incoming = { id: 'nested-export-transition-comp:transition-1:incoming', sourceClipId: 'x', blendMode: 'plus', opacity: 0.25, visible: true } as Layer;
    const outgoing = { id: 'nested-export-transition-comp:transition-1:outgoing', sourceClipId: 'y', blendMode: 'normal', opacity: 0.75, visible: true } as Layer;
    const resolution = resolveTransitionCompositionBlend({
      transitionId: 'transition-mixed',
      composition: buildComposition('crossfade', 1, 1, ['normal', 'screen']),
      nestedLayers: [incoming, outgoing],
      compositionTime: 0.25,
    });
    // Top first: the incoming clip screens over the outgoing clip drawn Normal over the lower tracks.
    expect(resolution.fallback).toBe('mixed-blend-modes');
    expect(resolution.parts).toEqual([
      { blendMode: 'screen', nestedLayers: [{ ...incoming, blendMode: 'normal' }] },
      { blendMode: 'normal', nestedLayers: [outgoing] },
    ]);
    expect(notes()).toHaveLength(1);
    resolveTransitionCompositionBlend({
      transitionId: 'transition-mixed',
      composition: buildComposition('crossfade', 1, 1, ['normal', 'screen']),
      nestedLayers: [],
    });
    expect(notes()).toHaveLength(1);

    const layers = createTransitionNestedCompositionLayers({
      transition: { id: 'transition-1', type: 'crossfade', duration: 1, linkedClipId: 'in' },
      composition: buildComposition('crossfade', 1, 1, ['normal', 'screen']),
      compositionTime: 0.25,
      nestedLayers: [incoming, outgoing],
      layerIndex: 2,
      layerIdPrefix: 'export',
    });
    expect(layers.map((candidate) => [candidate.id, candidate.blendMode])).toEqual([
      ['export_transition_comp_2_transition-1', 'screen'],
      ['export_transition_comp_2_transition-1_part1', 'normal'],
    ]);
  });

  it('composites transition compositions as premultiplied sources', () => {
    const [layer] = createTransitionNestedCompositionLayers({
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

  it('dissolves to (1−t)·A + t·B on the CPU reference of the composite rules, also for transparent clips', () => {
    // RGBA in 0..1. The rules follow composite.wgsl (guarded by the test above):
    // normal: rgb = mix(base, layer, a·opacity), alpha = max(base.a, a·opacity);
    // plus: rgb = base + layer·a·opacity, alpha = base.a + a·opacity (both clamped);
    // a premultiplied source is straightened (rgb / a) before blending.
    type Rgba = [number, number, number, number];
    const clamp1 = (value: number) => Math.min(1, value);
    const straighten = ([r, g, b, a]: Rgba): Rgba => a > 0 ? [r / a, g / a, b / a, a] : [r, g, b, a];
    const normal = (base: Rgba, layer: Rgba, opacity: number, premultiplied = false): Rgba => {
      const source = premultiplied ? straighten(layer) : layer;
      const alpha = source[3] * opacity;
      return [0, 1, 2].map((channel) => base[channel] + (source[channel] - base[channel]) * alpha)
        .concat(Math.max(base[3], alpha)) as Rgba;
    };
    const plus = (base: Rgba, layer: Rgba, opacity: number): Rgba => {
      const alpha = layer[3] * opacity;
      return [0, 1, 2].map((channel) => clamp1(base[channel] + layer[channel] * alpha))
        .concat(clamp1(base[3] + alpha)) as Rgba;
    };
    const transparent: Rgba = [0, 0, 0, 0];
    // The transition composition: outgoing Normal at (1−t), incoming plus at t; then the parent draws it premultiplied.
    const crossfadeOver = (background: Rgba, a: Rgba, b: Rgba, t: number, premultiplied = true) =>
      normal(background, plus(normal(transparent, a, 1 - t), b, t), 1, premultiplied);
    const expectRgb = (actual: Rgba, expected: number[]) =>
      expected.forEach((value, channel) => expect(actual[channel]).toBeCloseTo(value, 6));

    const harbour: Rgba = [0.2, 0.5, 0.9, 1];
    const stage: Rgba = [0.9, 0.3, 0.1, 1];
    const background: Rgba = [0.1, 0.1, 0.1, 1];
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      expectRgb(crossfadeOver(background, harbour, stage, t), [0, 1, 2].map((c) => (1 - t) * harbour[c] + t * stage[c]));
    }

    // A title (60 % alpha) dissolving into a keyed clip (30 % alpha) over the lower tracks:
    // each clip as it looks alone over the background, mixed by t.
    const title: Rgba = [1, 1, 1, 0.6];
    const keyed: Rgba = [0.2, 0.8, 0.3, 0.3];
    const over = (layer: Rgba) => normal(background, layer, 1);
    for (const t of [0.25, 0.5, 0.75]) {
      const expected = [0, 1, 2].map((c) => (1 - t) * over(title)[c] + t * over(keyed)[c]);
      expectRgb(crossfadeOver(background, title, keyed, t), expected);
      // Without straightening, partial alpha would be applied twice and darken the dissolve.
      expect(crossfadeOver(background, title, keyed, t, false)[0]).toBeLessThan(expected[0] - 0.01);
    }
    // A title dissolving into an empty frame leaves only the background at the end.
    expectRgb(crossfadeOver(background, title, transparent, 1), background.slice(0, 3));
  });

  it('offers an equal-gain audio curve for fades within one recording', () => {
    expect(getCrossfadeAudioGains(0.25, 'equal-gain')).toEqual({ outgoing: 0.75, incoming: 0.25 });
    expect(getCrossfadeAudioGains(2, 'equal-gain')).toEqual({ outgoing: 0, incoming: 1 });
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
