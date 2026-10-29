import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const history = vi.hoisted(() => ({
  startBatch: vi.fn(() => ({ opened: true, batchId: 1 })),
  endBatch: vi.fn(),
  cancelHistoryBatch: vi.fn(),
  captureSnapshot: vi.fn(),
}));

vi.mock('../../src/stores/historyStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/stores/historyStore')>()),
  ...history,
}));

import { readPhoneVisualSelection } from '../../src/components/mobileSkin/effects/phoneEffectTargets';
import { createPhoneEffectsCommands } from '../../src/components/mobileSkin/effects/usePhoneEffectsCommands';
import { buildPhoneExportPlan } from '../../src/components/mobileSkin/export/phoneExportPlan';
import { getMotionAdjustmentDiagnostics } from '../../src/components/panels/properties/motionAdjustmentDiagnostics';
import { buildLayersAtTime, cleanupLayerBuilder, initializeLayerBuilder } from '../../src/engine/export/ExportLayerBuilder';
import type { FrameContext as ExportFrameContext } from '../../src/engine/export/types';
import { buildMotionAdjustmentLayerFromBase } from '../../src/services/layerBuilder/layerBuilderMotionAdjustment';
import { Logger } from '../../src/services/logger';
import { adjustmentLayerExportNotes, adjustmentLayerRenderReport } from '../../src/services/motionDesign/adjustment/adjustmentLayerExportNotes';
import { inspectAdjustmentLayerProperties } from '../../src/services/motionDesign/adjustment/adjustmentLayerRenderAdmission';
import { workerGpuUnsupportedAdjustmentEffectTypes } from '../../src/services/render/workerGpuAdjustmentPlanAdapter';
import { useMediaStore } from '../../src/stores/mediaStore';
import { DEFAULT_TRANSFORM, useTimelineStore } from '../../src/stores/timeline';
import type { Layer, TimelineClip, TimelineTrack } from '../../src/types';
import { compileRuntimeColorGrade, createDefaultColorCorrectionState } from '../../src/types/colorCorrection';
import { createDefaultMotionLayerDefinition } from '../../src/types/motionDesign';
import { createMockClip, createMockTrack } from '../helpers/mockData';

const initialTimelineState = useTimelineStore.getState();
// Module loggers share one prototype; spying on it sees the layer builder's warnings.
const log = Object.getPrototypeOf(Logger.create('probe')) as { warn: (message: string, data?: unknown) => void };

function adjustmentClip(id: string, patch: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id, trackId: 'video-2', name: id, file: new File([], `${id}.msmotion`), startTime: 0, duration: 5, inPoint: 0, outPoint: 5,
    source: { type: 'motion-adjustment', naturalDuration: 5 }, motion: createDefaultMotionLayerDefinition('adjustment'),
    transform: structuredClone(DEFAULT_TRANSFORM), effects: [], isLoading: false, ...patch,
  };
}

function exportContext(track: TimelineTrack, clip: TimelineClip): ExportFrameContext {
  const state = useTimelineStore.getState();
  return {
    time: 1, fps: 30, frameTolerance: 50_000, outputWidth: 1080, outputHeight: 1920,
    clipsAtTime: [clip], renderClipsAtTime: [clip], trackMap: new Map([[track.id, track]]), clipsByTrack: new Map([[track.id, clip]]),
    mediaFiles: [], mediaCompositions: useMediaStore.getState().compositions,
    getInterpolatedTransform: (clipId, time) => state.getInterpolatedTransform(clipId, time),
    getInterpolatedEffects: (clipId, time) => state.getInterpolatedEffects(clipId, time),
    getInterpolatedColorCorrection: (clipId, time) => state.getInterpolatedColorCorrection(clipId, time),
    getInterpolatedVectorAnimationSettings: () => ({}), getInterpolatedTextBounds: () => undefined,
    getSourceTimeForClip: (_clipId, localTime) => localTime, getInterpolatedSpeed: () => 1,
  };
}

function baseLayer(clip: TimelineClip, patch: Partial<Layer> = {}): Omit<Layer, 'source'> {
  return {
    id: `layer:${clip.id}`, name: clip.name, sourceClipId: clip.id, visible: true, opacity: 1, blendMode: 'normal',
    effects: clip.effects, position: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1 }, rotation: { x: 0, y: 0, z: 0 }, ...patch,
  };
}

const COMP = { width: 1080, height: 1920 };

describe('adjustment layer render admission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cleanupLayerBuilder();
  });

  afterEach(() => {
    cleanupLayerBuilder();
    useTimelineStore.setState(initialTimelineState);
  });

  it('exports the phone path: nothing selected, Pixel Sort Bands, switched off and on again (production 3.3.9 export abort)', async () => {
    const tracks = [createMockTrack({ id: 'video-2', type: 'video' }), createMockTrack({ id: 'video-1', type: 'video' })];
    useTimelineStore.setState({
      tracks,
      clips: [createMockClip({ id: 'a', trackId: 'video-1', startTime: 0, duration: 6, effects: [] })],
      clipKeyframes: new Map(), selectedClipIds: new Set(), primarySelectedClipId: null, playheadPosition: 1, isPlaying: false,
    });
    const commands = createPhoneEffectsCommands(readPhoneVisualSelection());
    const effectId = await commands.add('pixel-sort-bands');
    await commands.setEnabled(effectId!, false);
    await commands.setEnabled(effectId!, true);
    await commands.commit();
    const layerClip = useTimelineStore.getState().clips.find((clip) => clip.source?.type === 'motion-adjustment')!;
    // The bypass collapsed the effect's node group: node-graph layout data on the layer.
    expect(layerClip.nodeGraph?.groups?.[`effect:${effectId}`]).toEqual({ collapsed: true });

    initializeLayerBuilder(tracks);
    const layers = buildLayersAtTime(exportContext(tracks[0], layerClip), new Map(), null, false);
    expect(layers).toHaveLength(1);
    expect(layers[0].source?.type).toBe('motion-adjustment');
    expect(layers[0].effects.map((effect) => [effect.type, effect.enabled])).toEqual([['pixel-sort-bands', true]]);
    expect(inspectAdjustmentLayerProperties(layerClip)).toEqual([]);
    expect(adjustmentLayerExportNotes([layerClip])).toEqual([]);
  });

  it('renders the colour correction of an adjustment layer and keeps it for the compositor', () => {
    const grade = createDefaultColorCorrectionState();
    const clip = adjustmentClip('clip:graded', { colorCorrection: grade });
    const layer = buildMotionAdjustmentLayerFromBase({
      clip, baseLayer: baseLayer(clip, { colorCorrection: compileRuntimeColorGrade(grade) }), compositionSize: COMP, surface: 'export',
    });
    expect(layer?.colorCorrection).toEqual(compileRuntimeColorGrade(grade));
    expect(workerGpuUnsupportedAdjustmentEffectTypes([{ ...layer!, colorCorrection: { ...layer!.colorCorrection!, enabled: true } }]))
      .toEqual(['colour correction']);
  });

  it('skips what an adjustment layer cannot render, logs each once, and still exports the rest', () => {
    const warn = vi.spyOn(log, 'warn');
    const clip = adjustmentClip('clip:skipping', {
      is3D: true,
      sourceRect: { x: 0.1, y: 0, width: 0.5, height: 1 },
      nodeGraph: {
        version: 1, nodes: [], scene: { version: 1 } as never,
        customNodes: [{ id: 'node-1', label: 'Glitch AI', runtime: 'javascript', status: 'ready', inputs: [], outputs: [], ai: {} } as never],
      },
      effects: [{ id: 'effect:invert', name: 'Invert', type: 'invert', enabled: true, params: {} }],
    });
    const base = baseLayer(clip, {
      is3D: true, sourceRect: clip.sourceRect, opacity: 1.4, blendMode: 'difference',
      position: { x: 0.3, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0.5 }, sceneGraph: clip.nodeGraph!.scene,
    });
    for (let frame = 0; frame < 3; frame++) {
      const layer = buildMotionAdjustmentLayerFromBase({ clip, baseLayer: base, compositionSize: COMP, surface: 'export' })!;
      expect(layer).toMatchObject({ opacity: 1, blendMode: 'normal', position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } });
      expect(layer.is3D).toBeUndefined();
      expect(layer.sourceRect).toBeUndefined();
      expect(layer.sceneGraph).toBeUndefined();
      expect(layer.effects.map((effect) => effect.type)).toEqual(['invert']);
    }
    const skipped = warn.mock.calls.filter(([message]) => message === 'Adjustment layer property skipped; the rest of the layer renders')
      .map(([, data]) => (data as { property: string }).property);
    expect(skipped).toEqual(['transform', 'opacity', 'blend-mode', '3d', 'source-rect', 'scene-graph', 'custom-nodes']);
    warn.mockRestore();

    // The same reasons reach the inspector, the export notes and the tool results.
    const inspected = inspectAdjustmentLayerProperties(clip).map((item) => item.code);
    expect(inspected).toEqual(['3d', 'source-rect', 'scene-graph', 'custom-nodes']);
    const diagnostics = getMotionAdjustmentDiagnostics(clip.id, clip.effects, 'normal', { clip });
    expect(diagnostics.compatible).toBe(true);
    expect(diagnostics.skipped?.map((item) => item.code)).toEqual(inspected);
    expect(diagnostics.message).toContain('Skipped, the rest renders: It is set to 3D');
    expect(adjustmentLayerRenderReport(clip).skippedProperties.map((item) => item.code)).toEqual(inspected);
    const [note] = adjustmentLayerExportNotes([clip]);
    expect(note.note).toBe('Adjustment layer "clip:skipping" exports without 3D, its crop rectangle, its 3D scene graph, its custom nodes; select it to see why.');
  });

  it('names bypassed effects in the export notes and shows notes that overlap the phone export range', () => {
    const clip = adjustmentClip('clip:bypass', {
      startTime: 2, duration: 3, transitionRender: { kind: 'crossfade' } as never,
      effects: [{ id: 'effect:slit', name: 'Slit Scan', type: 'slit-scan', enabled: true, params: {} }],
    });
    const notes = adjustmentLayerExportNotes([clip, adjustmentClip('clip:clean')]);
    expect(notes.map((note) => note.note)).toEqual(['Adjustment layer "clip:bypass" exports without its transition, Slit Scan (bypassed); select it to see why.']);
    const plan = (layerNotes: typeof notes, inPoint: number | null, outPoint: number | null) => buildPhoneExportPlan({
      composition: { width: 1080, height: 1920, frameRate: 30 },
      clips: [{ trackId: 'video-1', startTime: 0, duration: 6 }],
      tracks: [{ id: 'video-1', type: 'video', visible: true, muted: false }],
      inPoint, outPoint, layerNotes,
      capabilities: { exporterSupported: true, h264: true, audioCodec: 'aac' },
    });
    const full = plan(notes, null, null);
    expect(full.supported && full.notice).toContain('exports without its transition');
    const before = plan(notes, 0, 1.5);
    expect(before.supported && before.notice).not.toContain('exports without');
  });

  it('stops only a broken layer definition: preview leaves it out, export names the layer', () => {
    const warn = vi.spyOn(log, 'warn');
    const clip = adjustmentClip('clip:broken', { motion: { ...createDefaultMotionLayerDefinition('adjustment'), kind: 'shape' } as never });
    expect(buildMotionAdjustmentLayerFromBase({ clip, baseLayer: baseLayer(clip), compositionSize: COMP, surface: 'preview' })).toBeNull();
    expect(() => buildMotionAdjustmentLayerFromBase({ clip, baseLayer: baseLayer(clip), compositionSize: COMP, surface: 'export' }))
      .toThrowError('Adjustment layer "clip:broken" cannot render: Invalid motion adjustment layer definition');
    expect(getMotionAdjustmentDiagnostics(clip.id, [], 'normal', { clip })).toMatchObject({ compatible: false, message: 'Invalid motion adjustment layer definition' });
    expect(warn).toHaveBeenCalledWith('Motion adjustment layer rejected by render admission', expect.objectContaining({ clipId: clip.id }));
    warn.mockRestore();
  });
});
