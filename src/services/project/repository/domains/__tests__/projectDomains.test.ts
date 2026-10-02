import { describe, expect, it } from 'vitest';
import type { ProjectFile } from '../../../types/project.types';
import { encodeProjectDomains, decodeProjectDomains, encodeCompositionClip } from '../projectDomains';
import { decodeAggregate, encodeAggregate, entityKey, domainJson } from '../jsonBoundary';
import { importRawLegacyHistory } from '../../import/legacyHistory';

function fixture(): ProjectFile {
  return {
    version: 1, name: 'Document and video project', createdAt: '2026-09-30', updatedAt: 'save-1',
    settings: { width: 1920, height: 1080, frameRate: 25, sampleRate: 48000 },
    media: [{ id: 'source', name: 'source.mp4', type: 'video', sourcePath: 'C:/media/source.mp4', fileHash: 'quick-fingerprint', hasProxy: false, folderId: null, importedAt: '2026-09-30' }],
    folders: [], activeCompositionId: 'one', openCompositionIds: ['one'], expandedFolderIds: [],
    compositions: ['one', 'two'].map((id) => ({ id, name: id, width: 1920, height: 1080, frameRate: 25, duration: 10, backgroundColor: '#000', folderId: null,
      tracks: [{ id: 'shared-track-id', name: 'Video', type: 'video', height: 70, locked: false, visible: true, muted: false, solo: false }],
      clips: [{ id: 'shared-clip-id', trackId: 'shared-track-id', mediaId: 'source', startTime: 0, duration: 10, inPoint: 0, outPoint: 10, effects: [], masks: [], keyframes: [], volume: 1, audioEnabled: true, reversed: false, disabled: false, transform: { x: 0, y: 0, z: 0, scaleX: 1, scaleY: 1, rotation: 0, rotationX: 0, rotationY: 0, anchorX: 0, anchorY: 0, opacity: 1, blendMode: 'normal' } } as unknown as ProjectFile['compositions'][number]['clips'][number]],
      masterAudioState: { volumeDb: id === 'one' ? -3 : -9, limiterEnabled: false, truePeakCeilingDb: -1 }, markers: [] })),
    uiState: { compositionViewState: { one: { playheadPosition: 1, zoom: 3, inPoint: 2, outPoint: 8 } }, midi: { isEnabled: true, transportBindings: { stop: { channel: 1, note: 60 } } } },
  };
}
const values = (project: ProjectFile) => [...encodeProjectDomains(project).entities].map(([key, value]) => [key, JSON.stringify(value)] as [string, string]);

describe('project domain registry', () => {
  it('gives duplicate clip IDs distinct composition owners and preserves each master', () => {
    const encoded = encodeProjectDomains(fixture());
    expect(encoded.entities.has(entityKey('clip', 'one', 'shared-clip-id'))).toBe(true);
    expect(encoded.entities.has(entityKey('clip', 'two', 'shared-clip-id'))).toBe(true);
    const restored = decodeProjectDomains(encoded.entities, encoded.workspace, encoded.journals);
    expect(restored.compositions.map((composition) => composition.masterAudioState!.volumeDb)).toEqual([-3, -9]);
    expect(restored.uiState!.compositionViewState!.one.inPoint).toBe(2);
    expect(restored.media[0].sourcePath).toBe('C:/media/source.mp4');
    expect(restored.media[0].fileHash).toBe('quick-fingerprint');
  });
  it('does not create canonical changes for tabs, playback, track height, save time or cache hydration', () => {
    const before = fixture(), after = fixture();
    after.updatedAt = 'save-2'; after.activeCompositionId = 'two'; after.openCompositionIds = ['one', 'two'];
    after.compositions[0].tracks[0].height = 190;
    after.uiState!.compositionViewState!.one.zoom = 9;
    after.uiState!.compositionViewState!.one.playheadPosition = 7;
    after.media[0].hasProxy = true; after.media[0].waveform = [0.1, 0.2];
    after.uiState!.midi!.isEnabled = false;
    expect(values(after)).toEqual(values(before));
  });
  it('changes one clip without invalidating siblings or composition membership', () => {
    const project = fixture(), before = new Map(values(project));
    project.compositions[0].clips[0].startTime = 2;
    const after = new Map(values(project));
    const changed = [...after].filter(([key, value]) => before.get(key) !== value).map(([key]) => key);
    expect(changed).toEqual([entityKey('clip', 'one', 'shared-clip-id')]);
    const touched = encodeCompositionClip('one', project.compositions[0].clips[0]);
    expect([...touched.keys()]).toEqual([entityKey('clip', 'one', 'shared-clip-id')]);
  });
  it.each([1, 2])('preserves inline document schema %s without treating it as a manifest', (schemaVersion) => {
    const project = fixture();
    project.documents = { schemaVersion: schemaVersion as 1 | 2, activeDocumentId: 'doc', documents: [{ id: 'doc', title: 'Script', kind: 'screenplay', schemaVersion: 2, revision: 3, createdAt: 1, updatedAt: 2, blocks: [{ id: 'p', kind: 'dialogue', text: 'Hello' }], links: [], comments: [], screenplay: { pageSize: 'a4', sceneNumbers: true, revisions: [], pageLocks: [{ blockId: 'p', offset: 0, label: '1A' }] } }] };
    const encoded = encodeProjectDomains(project), restored = decodeProjectDomains(encoded.entities, encoded.workspace);
    expect(restored.documents).toEqual(project.documents);
  });
  it.each([2, 3])('preserves manifest document schema %s and original dependency', (schemaVersion) => {
    const project = fixture();
    project.documents = { schemaVersion: schemaVersion as 2 | 3, artifacts: [{ documentId: 'doc', revision: 1, fileName: 'doc.json', digest: 'd'.repeat(64), original: { fileName: 'original.pdf', digest: 'a'.repeat(64) } }] };
    const encoded = encodeProjectDomains(project), restored = decodeProjectDomains(encoded.entities, encoded.workspace);
    expect(restored.documents).toEqual(project.documents);
  });
  it('stores large curves and strings in bounded reversible blocks', () => {
    const source = { curve: Array.from({ length: 20_000 }, (_, index) => ({ time: index, value: index / 3 })), text: '🎬'.repeat(90_000) };
    const encoded = encodeAggregate('curves/clip/a', 'curves', source);
    expect(decodeAggregate('curves/clip/a', encoded)).toEqual(source);
    expect(Math.max(...[...encoded.values()].map((entity) => new TextEncoder().encode(JSON.stringify(entity.value)).length))).toBeLessThan(256 * 1024);
  });
  it('rejects runtime objects, cycles, holes, nonfinite values and accessors', () => {
    for (const value of [new Map(), new Float32Array(1), new Date(), { value: Infinity }, Array(2), { get value() { return 1; } }]) expect(() => domainJson(value)).toThrow();
    const cycle: { child?: unknown } = {}; cycle.child = cycle;
    expect(() => domainJson(cycle)).toThrow();
  });
});

describe('raw legacy history import', () => {
  const provenance = { sourceId: 'source', sourcePath: 'project.json' };
  it('preserves every root/branch and never invents missing composition context', () => {
    const source = { schemaVersion: 2, activeNodeId: 'child', nodes: [{ id: 'a', parentId: null, snapshot: { label: 'A', timeline: {} } }, { id: 'b', parentId: null, snapshot: { label: 'B', timeline: {} } }, { id: 'child', parentId: 'a', snapshot: { label: 'C', timeline: {} } }] };
    const before = JSON.stringify(source), imported = importRawLegacyHistory(source, provenance);
    expect(imported.roots).toEqual(['a', 'b']); expect(imported.nodes).toHaveLength(3);
    expect(imported.nodes.every((node) => node.navigation === 'ambiguous')).toBe(true);
    expect(imported.original).toEqual(source); expect(JSON.stringify(source)).toBe(before);
  });
  it('retains v1 stacks and branch base evidence with unproven parentage', () => {
    const imported = importRawLegacyHistory({ schemaVersion: 1, undoStack: [{ activeCompositionId: 'one' }], redoStack: [{}], currentSnapshot: {}, branches: [{ id: 'old', baseSnapshot: {}, baseUndoStack: [{}], snapshots: [{}, {}] }] }, provenance);
    expect(imported.nodes).toHaveLength(7);
    expect(imported.nodes.every((node) => node.parentId === null)).toBe(true);
    expect(imported.issues).toContain('legacy-v1-branch-parentage-not-inferred');
  });
  it('retains duplicate/orphan/cyclic nodes as invalid evidence instead of dropping them', () => {
    const imported = importRawLegacyHistory({ schemaVersion: 2, activeNodeId: null, nodes: [{ id: 'a', parentId: 'a', snapshot: {} }, { id: 'a', parentId: null, snapshot: {} }, { id: 'orphan', parentId: 'missing', snapshot: {} }] }, provenance);
    expect(imported.nodes).toHaveLength(3);
    expect(imported.nodes.every((node) => node.navigation === 'invalid')).toBe(true);
  });
});
