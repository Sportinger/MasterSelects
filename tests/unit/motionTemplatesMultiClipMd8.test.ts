import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  handleApplyMotionTemplate,
  handleEditMotionModifier,
  handleListMotionTemplates,
  handleSaveMotionTemplate,
  handleSetMotionExpression,
} from '../../src/services/aiTools/handlers/motionDesign';
import { decodeMotionTemplateEnvelope, encodeMotionTemplateEnvelope } from '../../src/services/motionDesign/templates/codec';
import { listMotionTemplates } from '../../src/services/motionDesign/motionTemplateLibrary';
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
const defaultMediaGetState = vi.mocked(useMediaStore.getState).getMockImplementation();

function reset(): void {
  useTimelineStore.setState({ ...initialTimelineState, clips: [], tracks: [track], clipKeyframes: new Map() });
  setHistoryDisabledForDebug(false);
  setHistoryCallbacks({ flushPendingCapture: () => undefined, suppressCaptures: () => undefined });
  initHistoryStoreRefs({
    timeline: { getState: useTimelineStore.getState, setState: useTimelineStore.setState },
    media: { getState: useMediaStore.getState, setState: useMediaStore.setState },
    dock: { getState: () => ({ layout: null }), setState: () => undefined },
  });
  useHistoryStore.getState().clearHistory();
  localStorage.clear();
}

function installMedia(): void {
  vi.mocked(useMediaStore.getState).mockReturnValue({
    ...(defaultMediaGetState?.() ?? {}),
    activeCompositionId: 'composition-1',
    files: [],
  } as never);
}

function addShape(startTime: number): string {
  return useTimelineStore.getState().addMotionShapeClip(
    track.id,
    startTime,
    { primitive: 'rectangle', duration: 5 },
  )!;
}

describe('MD8 multi-clip motion templates', () => {
  beforeEach(() => { installMedia(); reset(); });
  afterEach(() => {
    localStorage.clear();
    vi.mocked(useMediaStore.getState).mockReturnValue({} as never);
    useTimelineStore.setState(initialTimelineState);
  });

  it('captures and replays parented clips with owned operations, expressions, tracks, and one undo', async () => {
    const parentId = addShape(2);
    const childId = addShape(4);
    useTimelineStore.getState().setClipParent(childId, parentId);
    useTimelineStore.getState().addKeyframe(parentId, 'shape.size.w' as never, 420, 1, 'easeIn');
    useTimelineStore.getState().addKeyframe(childId, 'shape.size.h' as never, 220, 2, 'easeOut');
    expect((await handleEditMotionModifier({
      clipId: parentId, operation: 'add', kind: 'noise', targetPath: 'replicator.offset.opacity', targetOperation: 'add', targetAmount: 0.25,
    }, useTimelineStore.getState())).success).toBe(true);
    expect((await handleSetMotionExpression({
      clipId: childId, operation: 'set', path: 'replicator.offset.position.x', source: 'time * 10', fallback: 7, enabled: true,
    }, useTimelineStore.getState())).success).toBe(true);

    const saved = await handleSaveMotionTemplate({ clipIds: [childId, parentId], name: 'Parented pair' }, useTimelineStore.getState());
    expect(saved.success).toBe(true);
    const decoded = decodeMotionTemplateEnvelope(listMotionTemplates().templates[0]!);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    const motionClips = decoded.envelope.entities.filter(entity => entity.kind === 'motion-clip');
    const opEntities = decoded.envelope.entities.filter(entity => entity.kind.endsWith('-op') || entity.kind === 'keyframes');
    expect(motionClips).toHaveLength(2);
    expect(decoded.envelope.relationships.filter(relationship => relationship.kind === 'owns-op')).toHaveLength(opEntities.length);
    expect(decoded.envelope.relationships.filter(relationship => relationship.kind === 'motion-parent')).toHaveLength(1);
    expect(decoded.envelope.entities.find(entity => entity.kind === 'expression-op')?.payload).toEqual({
      path: 'replicator.offset.position.x', source: 'time * 10', fallback: 7, enabled: true,
    });
    const encoded = encodeMotionTemplateEnvelope(decoded.envelope);
    expect(encoded.ok).toBe(true);
    expect(encoded.ok && decodeMotionTemplateEnvelope(encoded.json).ok).toBe(true);

    useHistoryStore.getState().clearHistory();
    const applied = await handleApplyMotionTemplate({ templateId: decoded.envelope.templateId, trackId: track.id, startTime: 10 }, useTimelineStore.getState());
    expect(applied.success).toBe(true);
    const data = applied.data as { clipId: string; clipIds: string[]; createdTrackIds: string[] };
    expect(data.clipId).toBe(data.clipIds[0]);
    expect(data.clipIds).toHaveLength(2);
    expect(data.createdTrackIds).toHaveLength(1);
    const created = data.clipIds.map(id => useTimelineStore.getState().clips.find(clip => clip.id === id)!);
    expect(created.map(clip => clip.startTime)).toEqual([10, 12]);
    expect(created[1]!.trackId).toBe(data.createdTrackIds[0]);
    expect(created.find(clip => clip.startTime === 12)?.parentClipId).toBe(created.find(clip => clip.startTime === 10)?.id);
    expect(created.find(clip => clip.startTime === 12)?.motion?.expressions?.bindings[0]).toMatchObject({ path: 'replicator.offset.position.x', source: 'time * 10' });
    expect(created.find(clip => clip.startTime === 12)?.motion?.expressions?.bindings[0]?.id).toBeTruthy();
    expect(useTimelineStore.getState().clipKeyframes.get(created[0]!.id)).toHaveLength(1);
    expect(useTimelineStore.getState().clipKeyframes.get(created[1]!.id)).toHaveLength(1);
    useHistoryStore.getState().undo();
    expect(data.clipIds.every(id => !useTimelineStore.getState().clips.some(clip => clip.id === id))).toBe(true);
    expect(data.clipIds.every(id => !useTimelineStore.getState().clipKeyframes.has(id))).toBe(true);
    expect(data.createdTrackIds.every(id => !useTimelineStore.getState().tracks.some(item => item.id === id))).toBe(true);
  });

  it('reports parent links outside the captured selection as dropped', async () => {
    const parentId = addShape(0);
    const childId = addShape(1);
    useTimelineStore.getState().setClipParent(childId, parentId);
    const saved = await handleSaveMotionTemplate({ clipIds: [childId], name: 'Orphaned parent' }, useTimelineStore.getState());
    expect(saved.success).toBe(true);
    expect((saved.data as { droppedParentLinks: unknown[] }).droppedParentLinks).toEqual([{ clipId: childId, parentClipId: parentId }]);
  });

  it('lists saved categories and defaults legacy saves to motion-clip', async () => {
    const sourceId = addShape(0);
    await handleSaveMotionTemplate({ clipId: sourceId, name: 'Lower third', category: 'lower-thirds' }, useTimelineStore.getState());
    await handleSaveMotionTemplate({ clipId: sourceId, name: 'Default category' }, useTimelineStore.getState());
    const listed = await handleListMotionTemplates();
    expect((listed.data as { templates: Array<{ name: string; category: string }> }).templates).toEqual(expect.arrayContaining([
      { name: 'Lower third', category: 'lower-thirds', id: expect.any(String), createdAt: expect.any(Number), entityCounts: expect.any(Object), dependencies: [] },
      { name: 'Default category', category: 'motion-clip', id: expect.any(String), createdAt: expect.any(Number), entityCounts: expect.any(Object), dependencies: [] },
    ]));
  });

  it('keeps single-clip envelopes compatible while capturing expressions', async () => {
    const sourceId = addShape(0);
    await handleSetMotionExpression({
      clipId: sourceId, operation: 'set', path: 'replicator.offset.scale.x', source: '2', fallback: 1, enabled: true,
    }, useTimelineStore.getState());
    await handleSaveMotionTemplate({ clipId: sourceId, name: 'Single expression' }, useTimelineStore.getState());
    const applied = await handleApplyMotionTemplate({ templateId: listMotionTemplates().templates[0]!.templateId, trackId: track.id, startTime: 8 }, useTimelineStore.getState());
    expect(applied.success).toBe(true);
    const clip = useTimelineStore.getState().clips.find(item => item.id === (applied.data as { clipId: string }).clipId)!;
    expect(clip.motion?.expressions?.bindings).toMatchObject([{ path: 'replicator.offset.scale.x', source: '2', fallback: 1, enabled: true }]);
  });
});
