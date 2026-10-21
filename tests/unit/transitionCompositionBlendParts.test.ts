import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildTransitionCompositionLayersForExport } from '../../src/engine/export/layerBuilder/nestedLayers';
import { cleanupLayerBuilder } from '../../src/engine/export/ExportLayerBuilder';
import { resolveTransitionCompositionBlend } from '../../src/services/layerBuilder/transitionCompositionBlend';
import { ensureTransitionCompositionForPair } from '../../src/services/timeline/transitionCompositionService';
import { Logger } from '../../src/services/logger';
import { useMediaStore, type Composition } from '../../src/stores/mediaStore';
import { DEFAULT_TRANSFORM, useTimelineStore } from '../../src/stores/timeline';
import { planTransition } from '../../src/stores/timeline/editOperations/transitionPlanner';
import type { BlendMode } from '../../src/types/blendMode';
import type { Layer } from '../../src/types/layers';
import type { SerializableClip, TimelineClip } from '../../src/types/timeline';

vi.mock('../../src/services/compositionRenderer', () => ({
  compositionRenderer: { invalidateCompositionAndParents: vi.fn() },
}));

const initialTimelineState = useTimelineStore.getState();
const initialMediaState = useMediaStore.getState();

function serializableClip(id: string, startTime: number, blendMode: BlendMode): SerializableClip {
  return {
    id, trackId: 'track-1', name: id, mediaFileId: `${id}-media`, startTime, duration: 2, inPoint: 0, outPoint: 2,
    sourceType: 'video', naturalDuration: 2,
    transform: { opacity: 1, blendMode, position: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, rotation: { x: 0, y: 0, z: 0 } },
    effects: [],
  };
}

function buildComposition(type: string, blendModes: [BlendMode, BlendMode]): Composition {
  const serializableClips = [serializableClip('out', 0, blendModes[0]), serializableClip('in', 2, blendModes[1])];
  const timelineClips = serializableClips.map((clip) => ({
    ...clip,
    file: new File([], `${clip.id}.mp4`),
    source: { type: 'video', mediaFileId: clip.mediaFileId, naturalDuration: clip.naturalDuration },
  }) as TimelineClip);
  timelineClips[0].transitionOut = { id: 'transition-1', type, duration: 1, linkedClipId: 'in' };
  timelineClips[1].transitionIn = { id: 'transition-1', type, duration: 1, linkedClipId: 'out' };
  const parent: Composition = {
    id: 'parent', name: 'Parent', type: 'composition', parentId: null, createdAt: 1,
    width: 1920, height: 1080, frameRate: 30, duration: 8, backgroundColor: '#000000',
    timelineData: { tracks: [], clips: serializableClips, duration: 8 },
  };
  const compositions: Composition[] = [parent];
  const id = ensureTransitionCompositionForPair({
    outgoingClipId: 'out', transitionId: 'transition-1', timelineClips, serializableClips, parentComposition: parent, compositions,
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
  return compositions.find((candidate) => candidate.id === id)!;
}

/** Layers as the export path names them, top first, in the composition's track order. */
function exportLayers(composition: Composition): Layer[] {
  const clipsByTrack = new Map(composition.timelineData!.clips.map((clip) => [clip.trackId, clip]));
  return composition.timelineData!.tracks.flatMap((track) => {
    const clip = clipsByTrack.get(track.id);
    return clip ? [{
      id: `nested-export-${clip.id}`, sourceClipId: clip.id, name: clip.name, visible: true, opacity: 1,
      blendMode: clip.transform.blendMode, source: null, effects: [],
      position: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1 }, rotation: { x: 0, y: 0, z: 0 },
    } as Layer] : [];
  });
}

const partSummary = (composition: Composition, time = 0.5) =>
  resolveTransitionCompositionBlend({ transitionId: 'transition-1', composition, nestedLayers: exportLayers(composition), compositionTime: time })
    .parts.map((part) => [part.blendMode, part.nestedLayers.map((layer) => `${layer.id.split(':').pop()}:${layer.blendMode}`)]);

describe('transition composition blend parts', () => {
  it('keeps a dip black between two Screen clips: the solid is its own Normal part', () => {
    expect(partSummary(buildComposition('dip-to-black', ['screen', 'screen']))).toEqual([
      ['normal', ['solid:normal']],
      ['screen', ['incoming:normal', 'outgoing:normal']],
    ]);
  });

  it('keeps a light streak screening between two Multiply clips instead of multiplying it away', () => {
    expect(partSummary(buildComposition('light-leak', ['multiply', 'multiply']))).toEqual([
      ['screen', ['light-streak:normal']],
      ['multiply', ['incoming:normal', 'outgoing:normal']],
    ]);
    // Between Normal clips nothing changes: one part, as authored.
    expect(partSummary(buildComposition('light-leak', ['normal', 'normal']))).toEqual([
      ['normal', ['light-streak:screen', 'incoming:normal', 'outgoing:normal']],
    ]);
  });

  it('keeps clips added below the transition\'s clips out of the Crossfade\'s plus: they are their own part', () => {
    const composition = buildComposition('crossfade', ['normal', 'normal']);
    // Evaluated mid-transition, the incoming clip's recipe window draws it with 'plus'.
    const evaluated = () => exportLayers(composition).map((layer) =>
      layer.id.endsWith(':incoming') ? { ...layer, blendMode: 'plus' as const } : layer);
    const summary = () => resolveTransitionCompositionBlend({
      transitionId: 'transition-1', composition, nestedLayers: evaluated(), compositionTime: 0.5,
    }).parts.map((part) => [part.blendMode, part.nestedLayers.map((layer) => `${layer.id.split(':').pop()}:${layer.blendMode}`)]);
    expect(summary()).toEqual([['normal', ['incoming:plus', 'outgoing:normal']]]);
    const timelineData = composition.timelineData!;
    const background = { ...serializableClip('user-background', 0, 'normal'), trackId: 'user-track', startTime: 0, duration: 1 };
    composition.timelineData = {
      ...timelineData,
      tracks: [...timelineData.tracks, { ...timelineData.tracks[timelineData.tracks.length - 1], id: 'user-track', name: 'Background' }],
      clips: [...timelineData.clips, background],
    };
    // BG + out·(1−t) + in·t would overexpose; the dissolve is composited over the background instead.
    expect(summary()).toEqual([
      ['normal', ['incoming:plus', 'outgoing:normal']],
      ['normal', ['nested-export-user-background:normal']],
    ]);
  });

  it('adds the upper clip when the incoming track was moved below the outgoing one inside the composition', () => {
    const composition = buildComposition('crossfade', ['normal', 'normal']);
    // Track order swapped: outgoing on top, the incoming (recipe 'plus') below it.
    const swapped = exportLayers(composition).toReversed().map((layer) =>
      layer.id.endsWith(':incoming') ? { ...layer, blendMode: 'plus' as const } : layer);
    Logger.clear();
    Logger.setLevel('INFO');
    const parts = resolveTransitionCompositionBlend({ transitionId: 'transition-1', composition, nestedLayers: swapped, compositionTime: 0.5 })
      .parts.map((part) => part.nestedLayers.map((layer) => `${layer.id.split(':').pop()}:${layer.blendMode}`));
    Logger.setLevel('WARN');
    // Lower clip over transparency, upper clip added: (1−t)·A + t·B, as before the move.
    expect(parts).toEqual([['outgoing:plus', 'incoming:normal']]);
    expect(Logger.search('adds the upper clip')).toHaveLength(1);
  });

  it('says so when the transition\'s clips are not found among the layers instead of blending twice', () => {
    const composition = buildComposition('crossfade', ['screen', 'screen']);
    const anonymous = exportLayers(composition).map((layer, index) => ({ ...layer, id: `layer-${index}`, sourceClipId: undefined }));
    Logger.clear();
    const resolved = resolveTransitionCompositionBlend({ transitionId: 'lost-1', composition, nestedLayers: anonymous, compositionTime: 0.5 });
    expect(resolved.fallback).toBe('participants-not-found');
    expect(resolved.parts.map((part) => part.blendMode)).toEqual(['normal']);
    expect(Logger.search('were not found among its layers')).toHaveLength(1);
  });

  it('keeps a recipe mode that equals the clips\' own mode (Additive Dissolve between two Add clips)', () => {
    const composition = buildComposition('additive-dissolve', ['add', 'add']);
    expect(partSummary(composition)).toEqual([['add', ['incoming:add', 'outgoing:normal']]]);
    // Before the recipe window opens, the clip's own Add moves to the part.
    expect(partSummary(composition, 0.01)).toEqual([['add', ['incoming:normal', 'outgoing:normal']]]);
  });
});

describe('transition blend parts in the export layer builder', () => {
  beforeEach(() => {
    cleanupLayerBuilder();
    useTimelineStore.setState(initialTimelineState);
    useMediaStore.setState({ ...initialMediaState, files: [], compositions: [] });
  });
  afterEach(() => {
    useTimelineStore.setState(initialTimelineState);
    useMediaStore.setState(initialMediaState);
  });

  const imageClip = (id: string, startTime: number, inPoint: number, blendMode: BlendMode): TimelineClip => ({
    id, trackId: 'track-v1', name: id, file: new File([], `${id}.png`), startTime, duration: 8, inPoint, outPoint: inPoint + 8,
    source: { type: 'image', imageElement: document.createElement('img'), naturalDuration: 120 },
    transform: { ...structuredClone(DEFAULT_TRANSFORM), blendMode }, effects: [], isLoading: false,
  });
  const exportCrossfade = (id: string, modes: [BlendMode, BlendMode]) => {
    const outgoing = { ...imageClip('clip-a', 0, 0, modes[0]), transitionOut: { id, type: 'crossfade', duration: 2, linkedClipId: 'clip-b' } };
    const incoming = { ...imageClip('clip-b', 8, 4, modes[1]), transitionIn: { id, type: 'crossfade', duration: 2, linkedClipId: 'clip-a' } };
    const plan = planTransition({
      outgoingClip: outgoing, incomingClip: incoming, transitionType: 'crossfade', requestedDuration: 2,
      placement: 'center', edgePolicy: 'hold', junctionTime: 8, getMediaDuration: () => 120,
    })!;
    return buildTransitionCompositionLayersForExport({
      activeTransition: { plan, outgoingClip: outgoing, incomingClip: incoming },
      layerIndex: 0, parentCompositionId: 'export', parentTime: 8.5, layerIdPrefix: 'export',
      clipStates: new Map(), parallelDecoder: null, useParallelDecode: false, mediaFiles: [], mediaCompositions: [],
      outputWidth: 1920, outputHeight: 1080, frameRate: 30,
    });
  };

  it('blends a Screen → Screen crossfade once: the export layer is Screen, the clips inside dissolve in Normal and plus', () => {
    Logger.clear();
    const layers = exportCrossfade('screen-fade', ['screen', 'screen']);
    expect(layers.map((layer) => [layer.id, layer.blendMode, layer.premultipliedAlpha])).toEqual([
      ['export_transition_comp_0_screen-fade', 'screen', true],
    ]);
    const nested = layers[0].source?.nestedComposition?.layers ?? [];
    expect(nested.map((layer) => [layer.id.split(':').pop(), layer.blendMode])).toEqual([
      ['incoming', 'plus'],
      ['outgoing', 'normal'],
    ]);
    expect(Logger.search('were not found among its layers')).toHaveLength(0);
  });

  it('draws a Normal → Screen crossfade as two export layers with the clips\' own modes', () => {
    const layers = exportCrossfade('mixed-fade', ['normal', 'screen']);

    expect(layers.map((layer) => [layer.id, layer.blendMode, layer.premultipliedAlpha])).toEqual([
      ['export_transition_comp_0_mixed-fade', 'screen', true],
      ['export_transition_comp_0_mixed-fade_part1', 'normal', true],
    ]);
    const nested = layers.map((layer) => layer.source?.nestedComposition?.layers ?? []);
    expect(nested.map((part) => part.map((layer) => layer.id))).toEqual([
      [expect.stringMatching(/^nested-export-.*:incoming$/)],
      [expect.stringMatching(/^nested-export-.*:outgoing$/)],
    ]);
    // Alone in its part, the Crossfade's 'plus' is drawn Normal; opacities keep the dissolve (0.75 at 8.5 s).
    expect(nested[0][0]).toMatchObject({ blendMode: 'normal' });
    expect(nested[0][0].opacity).toBeCloseTo(0.75);
    expect(nested[1][0].opacity).toBeCloseTo(0.25);
  });
});
