import { describe, expect, it, vi } from 'vitest';
import { prepareTimelineMutation } from '../../src/services/project/repository/transaction/domainAdapters/timelineAdapter';
import { prepareMediaMutation } from '../../src/services/project/repository/transaction/domainAdapters/mediaAdapter';
import type { MediaState } from '../../src/stores/mediaStore/types';
import { decodeProjectDomains, encodeProjectDomains } from '../../src/services/project/repository/domains/projectDomains';
import { entityKey } from '../../src/services/project/repository/domains/jsonBoundary';
import type { EntityDTO } from '../../src/services/project/repository/contracts';
import type { ProjectFile } from '../../src/services/project/types/project.types';
import type { TimelineStore } from '../../src/stores/timeline/types';
import type { Composition } from '../../src/stores/mediaStore/types';
import type { TimelineClip, TimelineTrack } from '../../src/types/timeline';

/** Entity keys referenced by the values a plan writes. */
function referencedKeys(value: unknown, out = new Set<string>()): Set<string> {
  if (!value || typeof value !== 'object') return out;
  if (Array.isArray(value)) { value.forEach(item => referencedKeys(item, out)); return out; }
  const record = value as Record<string, unknown>;
  if (typeof record.$repositoryEntity === 'string') out.add(record.$repositoryEntity);
  for (const child of Object.values(record)) referencedKeys(child, out);
  return out;
}
function project(): ProjectFile {
  return {
    version: 1, name: 'Dangling membership', createdAt: '2026-10-03', updatedAt: 'save-1',
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000 },
    media: [], folders: [], activeCompositionId: 'real', openCompositionIds: ['real'], expandedFolderIds: [],
    compositions: [{ id: 'real', name: 'Real', width: 1920, height: 1080, frameRate: 30, duration: 10, backgroundColor: '#000', folderId: null,
      tracks: [{ id: 'v1', name: 'Video', type: 'video', height: 70, locked: false, visible: true, muted: false, solo: false }],
      clips: [], markers: [] }],
  } as unknown as ProjectFile;
}
function timeline(patch: Partial<TimelineStore> = {}): TimelineStore {
  return {
    clips: [], tracks: [], clipKeyframes: new Map(), markers: [], duration: 60, durationLocked: false,
    masterAudioState: undefined, sharedSceneGraphs: undefined, compositionGraph: undefined,
    tempoMap: undefined, rulerLanes: undefined, activeRulerLaneId: undefined, videoBakeRegions: [],
    inPoint: null, outPoint: null, playheadPosition: 0, zoom: 50, scrollX: 0,
    selectedClipIds: new Set(), selectedKeyframeIds: new Set(), ...patch,
  } as unknown as TimelineStore;
}
const composition = (id: string, name = id) => ({ id, name, width: 1920, height: 1080, frameRate: 30, duration: 60,
  backgroundColor: '#000000', timelineData: undefined } as unknown as Composition);
const layoutChange = { compositionGraph: { version: 1, layout: { nodes: {}, collapsed: { x: true } } } } as Partial<TimelineStore>;
function written(plan: ReturnType<typeof prepareTimelineMutation>) {
  const values = new Map<string, unknown>();
  for (const aggregate of plan.aggregates) for (const [key, dto] of aggregate.after) values.set(key, (dto as EntityDTO).value);
  return values;
}

describe('repository timeline writes never reference absent member lists', () => {
  it('rejects content edits of a composition outside the open project (restore placeholder)', () => {
    const { entities } = encodeProjectDomains(project());
    expect(() => prepareTimelineMutation(timeline(), layoutChange, { entities, activeComposition: composition('comp-1', 'Comp 1') }))
      .toThrow(/not part of the open project/);
    // View-only state of the placeholder stays harmless and allowed.
    const view = prepareTimelineMutation(timeline(), { playheadPosition: 3 } as Partial<TimelineStore>, { entities, activeComposition: composition('comp-1') });
    expect(view.aggregates).toHaveLength(0);
    expect(view.views.map(entry => entry.key)).toEqual(['timeline/comp-1/playheadPosition']);
  });

  it('rewrites a listed composition completely when its member lists are missing', () => {
    const encoded = encodeProjectDomains(project());
    const entities = new Map(encoded.entities);
    entities.delete(entityKey('membership', 'real', 'clips'));
    entities.delete(entityKey('membership', 'real', 'tracks'));
    const tracks = [{ id: 'v1', name: 'Video', type: 'video', height: 70, locked: false, visible: true, muted: false, solo: false }] as unknown as TimelineTrack[];
    const clips = [{ id: 'c1', trackId: 'v1', name: 'Clip', startTime: 0, duration: 2, inPoint: 0, outPoint: 2, effects: [], source: { type: 'video' },
      transform: { position: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1 }, rotation: { x: 0, y: 0, z: 0 }, anchor: { x: 0, y: 0 }, opacity: 1, blendMode: 'normal' } }] as unknown as TimelineClip[];
    const before = timeline({ tracks, clips });
    const values = written(prepareTimelineMutation(before, layoutChange, { entities, activeComposition: composition('real', 'Real') }));
    const refs = new Set<string>(); for (const value of values.values()) referencedKeys(value, refs);
    const dangling = [...refs].filter(key => !values.has(key) && !entities.has(key));
    expect(dangling).toEqual([]);
    expect(values.has(entityKey('membership', 'real', 'clips'))).toBe(true);
    expect(values.has(entityKey('membership', 'real', 'tracks'))).toBe(true);
    expect(values.has(entityKey('clip', 'real', 'c1'))).toBe(true);
  });

  it('keeps an ordinary layout edit to a single composition record', () => {
    const { entities } = encodeProjectDomains(project());
    const values = written(prepareTimelineMutation(timeline(), layoutChange, { entities, activeComposition: composition('real', 'Real') }));
    expect([...values.keys()].filter(key => !key.includes('/block/'))).toEqual([entityKey('composition', 'project', 'real')]);
  });

  it('opens a project whose composition record points at a missing member list', () => {
    const encoded = encodeProjectDomains(project());
    const entities = new Map(encoded.entities);
    entities.delete(entityKey('membership', 'real', 'clips'));
    const missing = vi.fn();
    const restored = decodeProjectDomains(entities, encoded.workspace, encoded.journals, missing);
    expect(missing).toHaveBeenCalledWith(entityKey('membership', 'real', 'clips'));
    expect(restored.compositions[0].clips).toEqual([]);
    expect(restored.compositions[0].tracks).toHaveLength(1);
  });

  it('refuses to rewrite the project composition list from a store that does not know its entries', () => {
    const { entities } = encodeProjectDomains(project());
    const media = (compositions: Composition[]) => ({ files: [], folders: [], compositions, activeCompositionId: compositions[0]?.id ?? null,
      textItems: [], solidItems: [], meshItems: [], cameraItems: [], lightItems: [], splatEffectorItems: [], mathSceneItems: [], motionShapeItems: [],
      signalAssets: [], signalArtifacts: [], signalGraphs: [], signalOperators: [] } as unknown as MediaState);
    // Placeholder store ([comp-1]) adds a composition: the saved 'real' composition would be dropped.
    const placeholder = media([composition('comp-1', 'Comp 1')]);
    expect(() => prepareMediaMutation(placeholder, { compositions: [...placeholder.compositions, composition('new', 'New')] }, entities))
      .toThrow(/out of sync with the open project/);
    // A store that knows the saved composition may add and remove normally.
    const synced = media([composition('real', 'Real')]);
    expect(() => prepareMediaMutation(synced, { compositions: [...synced.compositions, composition('new', 'New')] }, entities)).not.toThrow();
    expect(() => prepareMediaMutation(synced, { compositions: [] }, entities)).not.toThrow();
  });
});
