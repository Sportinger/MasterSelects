import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  handleApplyMotionTemplate,
  handleSaveMotionTemplate,
} from '../../src/services/aiTools/handlers/motionDesign';
import {
  MOTION_TEMPLATE_LIBRARY_CAP,
  listMotionTemplates,
  saveMotionTemplateToLibrary,
} from '../../src/services/motionDesign/motionTemplateLibrary';
import { decodeMotionTemplateEnvelope } from '../../src/services/motionDesign/templates/codec';
import { inventoryMotionTemplateDependencies } from '../../src/services/motionDesign/templates/dependencyInventory';
import { createLinearGradientAppearance } from '../../src/types/motionDesign';
import {
  initHistoryStoreRefs,
  setHistoryCallbacks,
  setHistoryDisabledForDebug,
  useHistoryStore,
} from '../../src/stores/historyStore';
import { useMediaStore } from '../../src/stores/mediaStore';
import { useTimelineStore } from '../../src/stores/timeline';

const initialTimelineState = useTimelineStore.getState();
const track = { id: 'video-1', name: 'Video', type: 'video' as const, height: 70, muted: false, visible: true, solo: false };

function reset(): string {
  useTimelineStore.setState({ ...initialTimelineState, clips: [], tracks: [track], clipKeyframes: new Map() });
  setHistoryDisabledForDebug(false);
  setHistoryCallbacks({
    flushPendingCapture: () => undefined,
    suppressCaptures: () => undefined,
  });
  initHistoryStoreRefs({
    timeline: {
      getState: useTimelineStore.getState,
      setState: useTimelineStore.setState,
    },
    media: {
      getState: useMediaStore.getState,
      setState: useMediaStore.setState,
    },
    dock: {
      getState: () => ({ layout: null }),
      setState: () => undefined,
    },
  });
  useHistoryStore.getState().clearHistory();
  localStorage.clear();
  return useTimelineStore.getState().addMotionShapeClip(track.id, 0, { primitive: 'rectangle', duration: 5 })!;
}

const defaultMediaGetState = vi.mocked(useMediaStore.getState).getMockImplementation();

function installMedia(files: Array<{ id: string; name: string }>): void {
  // Base the fixture on the global mock's default state: the history
  // snapshot machinery reads media collections (compositions, folders, …)
  // during capture/undo and crashes on a minimal object.
  vi.mocked(useMediaStore.getState).mockReturnValue({
    ...(defaultMediaGetState?.() ?? {}),
    activeCompositionId: 'composition-1',
    files,
  } as never);
}

describe('MD8 motion clip templates', () => {
  beforeEach(() => { installMedia([{ id: 'media-1', name: 'texture.png' }]); });
  afterEach(() => {
    localStorage.clear();
    vi.mocked(useMediaStore.getState).mockReturnValue({} as never);
    useTimelineStore.setState(initialTimelineState);
  });

  it('captures, encodes, and decodes an ID-free motion clip with keyframes and texture dependencies', async () => {
    const sourceId = reset();
    useTimelineStore.getState().updateMotionLayer(sourceId, (motion) => ({
      ...motion,
      appearance: { ...motion.appearance!, items: [
        ...motion.appearance!.items,
        { ...motion.appearance!.items[0], id: 'texture-source', kind: 'texture-fill', mediaFileId: 'media-1', fit: 'cover', transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0 } } as never,
      ] },
    }));
    useTimelineStore.getState().addKeyframe(sourceId, 'shape.size.w' as never, 640, 1, 'easeIn');
    const saved = await handleSaveMotionTemplate({ clipId: sourceId, name: 'Texture Shape' }, useTimelineStore.getState());
    expect(saved.success).toBe(true);
    const template = listMotionTemplates().templates[0];
    const decoded = decodeMotionTemplateEnvelope(template);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.envelope.entities.find((entity) => entity.kind === 'motion-clip')?.payload).toMatchObject({ shape: { primitive: 'rectangle' } });
    expect(decoded.envelope.entities.find((entity) => entity.kind === 'keyframes')?.payload).toMatchObject({ byPath: { 'shape.size.w': [{ time: 1, value: 640 }] } });
    const inventory = inventoryMotionTemplateDependencies(decoded.envelope, [{ dependencyId: 'media-0', resolvedProjectId: 'media-1' }]);
    expect(inventory.ok && inventory.plan.entries).toMatchObject([{ sourceProjectId: 'media-1', status: 'resolved' }]);
  });

  it('applies with fresh nested IDs, preserved clip-local keyframes, and one undo entry', async () => {
    const sourceId = reset();
    useTimelineStore.getState().updateMotionLayer(sourceId, (motion) => ({
      ...motion,
      appearance: { ...motion.appearance!, items: [...motion.appearance!.items, createLinearGradientAppearance()] },
    }));
    const modifierAdded = await import('../../src/services/aiTools/handlers/motionDesign').then(({ handleEditMotionModifier }) => handleEditMotionModifier({
      clipId: sourceId, operation: 'add', kind: 'noise', targetPath: 'replicator.offset.opacity', targetOperation: 'add', targetAmount: 0.5,
    }, useTimelineStore.getState()));
    expect(modifierAdded.error ?? null).toBeNull();
    useTimelineStore.getState().addKeyframe(sourceId, 'shape.size.w' as never, 500, 2, 'easeOut');
    await handleSaveMotionTemplate({ clipId: sourceId, name: 'Full Shape' }, useTimelineStore.getState());
    const source = useTimelineStore.getState().clips.find((clip) => clip.id === sourceId)!;
    useHistoryStore.getState().clearHistory();
    const result = await handleApplyMotionTemplate({ templateId: listMotionTemplates().templates[0].templateId, trackId: track.id, startTime: 12 }, useTimelineStore.getState());
    expect(result.error ?? null).toBeNull();
    expect(result.success).toBe(true);
    const appliedId = (result.data as { clipId: string }).clipId;
    const applied = useTimelineStore.getState().clips.find((clip) => clip.id === appliedId)!;
    expect(applied.startTime).toBe(12);
    expect(applied.id).not.toBe(source.id);
    expect(applied.motion!.appearance!.items.map((item) => item.id)).not.toEqual(source.motion!.appearance!.items.map((item) => item.id));
    const sourceGradient = source.motion!.appearance!.items.find((item) => item.kind === 'linear-gradient')!;
    const appliedGradient = applied.motion!.appearance!.items.find((item) => item.kind === 'linear-gradient')!;
    if (sourceGradient.kind === 'linear-gradient' && appliedGradient.kind === 'linear-gradient') expect(appliedGradient.stops.map((stop) => stop.id)).not.toEqual(sourceGradient.stops.map((stop) => stop.id));
    expect(applied.motion!.modifierStack!.modifiers.map((modifier) => modifier.id)).not.toEqual(source.motion!.modifierStack!.modifiers.map((modifier) => modifier.id));
    expect(useTimelineStore.getState().clipKeyframes.get(appliedId)?.map((keyframe) => keyframe.time)).toContain(2);
    useHistoryStore.getState().undo();
    expect(useTimelineStore.getState().clips.some((clip) => clip.id === appliedId)).toBe(false);
    expect(useTimelineStore.getState().clipKeyframes.has(appliedId)).toBe(false);
  });

  it('continues when a texture dependency is missing and clears only that media binding', async () => {
    const sourceId = reset();
    useTimelineStore.getState().updateMotionLayer(sourceId, (motion) => ({
      ...motion,
      appearance: { ...motion.appearance!, items: [{ ...motion.appearance!.items[0], kind: 'texture-fill', mediaFileId: 'media-1', fit: 'contain', transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0 } } as never] },
    }));
    await handleSaveMotionTemplate({ clipId: sourceId, name: 'Missing Texture' }, useTimelineStore.getState());
    installMedia([]);
    const result = await handleApplyMotionTemplate({ templateId: listMotionTemplates().templates[0].templateId, trackId: track.id, startTime: 8 }, useTimelineStore.getState());
    expect(result.success).toBe(true);
    expect((result.data as { missingDependencies: Array<{ id: string }> }).missingDependencies).toHaveLength(1);
    const applied = useTimelineStore.getState().clips.find((clip) => clip.id === (result.data as { clipId: string }).clipId)!;
    const appliedItem = applied.motion!.appearance!.items[0];
    expect(appliedItem.kind).toBe('texture-fill');
    expect((appliedItem as { mediaFileId?: string }).mediaFileId).toBeUndefined();
  });

  it('skips corrupt library entries and evicts the oldest template at the cap', async () => {
    const sourceId = reset();
    await handleSaveMotionTemplate({ clipId: sourceId, name: 'First' }, useTimelineStore.getState());
    localStorage.setItem('masterselects.motionTemplates', JSON.stringify({ version: 1, templates: ['bad json'] }));
    expect(listMotionTemplates().warnings).toContain('Skipped corrupt motion template at index 0');
    localStorage.clear();
    await handleSaveMotionTemplate({ clipId: sourceId, name: 'Reusable' }, useTimelineStore.getState());
    const saved = listMotionTemplates().templates[0];
    // Eviction is by the timestamp encoded in the templateId, not insertion
    // order: the loop ids carry synthetic timestamps 0..cap, so the smallest
    // ones are evicted while the freshly captured template (real Date.now())
    // is the newest entry and survives.
    for (let index = 0; index <= MOTION_TEMPLATE_LIBRARY_CAP; index += 1) {
      saveMotionTemplateToLibrary({ ...saved, templateId: `motion-template_${index}_entry`, name: `Template ${index}` });
    }
    expect(listMotionTemplates().templates).toHaveLength(MOTION_TEMPLATE_LIBRARY_CAP);
    expect(listMotionTemplates().templates.some((item) => item.templateId === 'motion-template_0_entry')).toBe(false);
    expect(listMotionTemplates().templates.some((item) => item.templateId === saved.templateId)).toBe(true);
  });
});
