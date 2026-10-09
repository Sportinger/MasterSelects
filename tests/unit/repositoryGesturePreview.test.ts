import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';
import { withRepositoryStoreMutation } from '../../src/services/project/repository/transaction/storeMutationBoundary';
import { installEditorRepositorySession, beginEditorTransaction, runEditorTransaction, commitEditorTransaction,
  cancelEditorTransaction, ownsEditorTransaction } from '../../src/services/project/repository/transaction/editorMutationRuntime';
import { ProjectTransactionCoordinator, type CoordinatorStorage, type TransactionToken } from '../../src/services/project/repository/transaction/ProjectTransactionCoordinator';
import type { RepositorySession } from '../../src/services/project/repository/RepositorySession';
import type { TimelineStore } from '../../src/stores/timeline/types';
import type { MediaState } from '../../src/stores/mediaStore/types';
import { encodeAggregate, entityKey } from '../../src/services/project/repository/domains/jsonBoundary';
import { encodeCompositionClip } from '../../src/services/project/repository/domains/projectDomains';
import * as serialization from '../../src/services/project/projectCompositionSerialization';
import { DEFAULT_TEXT_PROPERTIES } from '../../src/stores/timeline/constants';
import { editTextSelection } from '../../src/components/panels/properties/textSelectionEditing';
import { createMockClip, createMockKeyframe } from '../helpers/mockData';

vi.mock('../../src/services/project/repository/transaction/editorHistory', () => ({ refreshEditorHistoryAvailability: () => Promise.resolve() }));
vi.mock('../../src/services/project/repository/transaction/editorCompositionProjection', () => ({ projectTimelineMutationToComposition: vi.fn() }));
import { projectTimelineMutationToComposition } from '../../src/services/project/repository/transaction/editorCompositionProjection';

let cleanup: (() => void) | undefined;
const tokens: TransactionToken[] = [];
afterEach(() => {
  for (const token of tokens.splice(0)) if (ownsEditorTransaction(token)) cancelEditorTransaction(token);
  cleanup?.(); cleanup = undefined; vi.restoreAllMocks();
});
function fixture(text = false) {
  const clips = ['a', 'b'].map(id => createMockClip({ id, ...(text ? { source: { type: 'text' }, textProperties: { ...DEFAULT_TEXT_PROPERTIES } } : {}) }));
  const key = createMockKeyframe({ id: 'k', clipId: 'a', easing: 'ease-in-out' });
  const timeline = createStore<TimelineStore>()(withRepositoryStoreMutation('timeline', () => ({
    clips, tracks: [], clipKeyframes: new Map([['a', [key]]]), markers: [], videoBakeRegions: [], duration: 10,
    playheadPosition: 0, inPoint: null, outPoint: null, selectedClipIds: new Set(), selectedKeyframeIds: new Set(),
  } as unknown as TimelineStore)));
  createStore<MediaState>()(withRepositoryStoreMutation('media', () => ({ files: [], activeCompositionId: 'main',
    compositions: [{ id: 'main', name: 'Main', width: 1920, height: 1080, frameRate: 30, duration: 10 }],
  } as unknown as MediaState)));
  const reference = (key: string) => ({ $repositoryEntity: key });
  const entities = new Map([
    ...encodeAggregate(entityKey('membership', 'project', 'compositions'), 'membership', [reference(entityKey('composition', 'project', 'main'))]),
    ...encodeAggregate(entityKey('composition', 'project', 'main'), 'composition', { id: 'main' }),
    ...encodeAggregate(entityKey('membership', 'main', 'clips'), 'membership', clips.map(c => reference(entityKey('clip', 'main', c.id)))),
    ...encodeAggregate(entityKey('membership', 'main', 'tracks'), 'membership', []),
    ...clips.flatMap(clip => [...encodeCompositionClip('main', serialization.convertRuntimeProjectClip(clip, clip.id === 'a' ? [key] : []))]),
  ]);
  const storage: CoordinatorStorage = {
    publishRevision: vi.fn(async () => {}), publishNavigation: vi.fn(async () => {}), publishMetadata: vi.fn(async () => {}),
    publishJournal: vi.fn(async () => {}), loadProjection: vi.fn(async () => new Map()), getRevision: vi.fn(async () => null),
    getRedoChild: vi.fn(async () => null), flushViews: vi.fn(async () => {}), assertOwned: vi.fn(),
  };
  const coordinator = new ProjectTransactionCoordinator('preview-test', 'workspace', storage, { canActivate: () => true, activate: async () => {} });
  coordinator.restore({ entities, revisionId: 'base', generation: 0 }, 0);
  cleanup = installEditorRepositorySession({ coordinator, opening: { writable: true }, updateView: async () => 1 } as unknown as RepositorySession);
  const encode = vi.spyOn(serialization, 'convertRuntimeProjectClip');
  const write = vi.spyOn(coordinator, 'write');
  vi.mocked(projectTimelineMutationToComposition).mockClear();
  const begin = (source = 'gesture') => { const token = beginEditorTransaction('Drag', source); tokens.push(token); return token; };
  const move = (token: TransactionToken, value: number) => runEditorTransaction(token, () => timeline.setState({
    clipKeyframes: new Map([['a', [{ ...key, value }]]]),
  }));
  return { timeline, coordinator, storage, encode, write, begin, move, clips, key };
}
describe('gesture preview persistence', () => {
  it('updates live keys for 100 drag samples but encodes and saves only the final value', async () => {
    const f = fixture(), token = f.begin();
    for (let i = 0; i < 100; i++) f.move(token, i / 100);
    await Promise.resolve();
    expect(f.timeline.getState().clipKeyframes.get('a')![0].value).toBe(.99);
    expect(f.encode).not.toHaveBeenCalled(); expect(f.write).not.toHaveBeenCalled();
    expect(projectTimelineMutationToComposition).not.toHaveBeenCalled();
    expect(f.storage.publishRevision).not.toHaveBeenCalled();
    commitEditorTransaction(token); await f.coordinator.flush();
    expect(f.encode).toHaveBeenCalledTimes(1);
    expect(projectTimelineMutationToComposition).toHaveBeenCalledTimes(1);
    expect(f.storage.publishRevision).toHaveBeenCalledTimes(1);
    const revision = vi.mocked(f.storage.publishRevision).mock.calls[0][0];
    expect(JSON.stringify(revision.changes)).toContain('0.99');
    expect(revision.parentRevisionId).toBe('base');
  });
  it('cancels the live preview without writing a revision', async () => {
    const f = fixture(), token = f.begin();
    f.move(token, .2); f.move(token, .8); cancelEditorTransaction(token); await f.coordinator.flush();
    expect(f.timeline.getState().clipKeyframes.get('a')![0]).toBe(f.key);
    expect(f.encode).not.toHaveBeenCalled(); expect(f.storage.publishRevision).not.toHaveBeenCalled();
  });
  it('also defers clip transform drags until release', async () => {
    const f = fixture(), token = f.begin();
    for (let x = 1; x <= 30; x++) runEditorTransaction(token, () => f.timeline.setState({
      clips: f.timeline.getState().clips.map(clip => clip.id === 'a'
        ? { ...clip, transform: { ...clip.transform, position: { ...clip.transform.position, x } } } : clip),
    }));
    expect(f.timeline.getState().clips[0].transform.position.x).toBe(30);
    expect(f.encode).not.toHaveBeenCalled();
    commitEditorTransaction(token); await f.coordinator.flush();
    expect(f.encode).toHaveBeenCalledTimes(1); expect(f.storage.publishRevision).toHaveBeenCalledTimes(1);
  });
  it('reserves the touched clip and preserves an unrelated edit when cancelling', async () => {
    const f = fixture(), drag = f.begin(); f.move(drag, .7);
    const other = f.begin('background');
    expect(() => f.move(other, .9)).toThrow(/belongs to another transaction/);
    runEditorTransaction(other, () => f.timeline.setState({ clips: f.timeline.getState().clips.map(c => c.id === 'b' ? { ...c, name: 'Other edit' } : c) }));
    commitEditorTransaction(other); cancelEditorTransaction(drag); await f.coordinator.flush();
    expect(f.timeline.getState().clipKeyframes.get('a')![0]).toBe(f.key);
    expect(f.timeline.getState().clips[1].name).toBe('Other edit');
    expect(f.storage.publishRevision).toHaveBeenCalledTimes(1);
  });
  it('rolls back correctly when a structural edit follows preview samples', () => {
    const f = fixture(), token = f.begin(); f.move(token, .7);
    runEditorTransaction(token, () => f.timeline.setState({ clips: f.timeline.getState().clips.filter(c => c.id !== 'b') }));
    cancelEditorTransaction(token);
    expect(f.timeline.getState().clips.map(c => c.id)).toEqual(['a', 'b']);
    expect(f.timeline.getState().clipKeyframes.get('a')![0]).toBe(f.key);
  });
  it('does not create a saved revision for a drag that returns to its original value', async () => {
    const f = fixture(), token = f.begin(); f.move(token, .7); f.move(token, f.key.value);
    commitEditorTransaction(token); await f.coordinator.flush();
    expect(f.storage.publishRevision).not.toHaveBeenCalled();
  });
  it('preserves rollback ordering when structural edits precede value edits', () => {
    const f = fixture(), token = f.begin();
    runEditorTransaction(token, () => f.timeline.setState({ clips: f.timeline.getState().clips.filter(c => c.id !== 'b') }));
    f.move(token, .7); cancelEditorTransaction(token);
    expect(f.timeline.getState().clips.map(c => c.id)).toEqual(['a', 'b']);
    expect(f.timeline.getState().clipKeyframes.get('a')![0]).toBe(f.key);
  });
});


it('commits a multi-text inspector edit as one repository revision outside an input event', async () => {
  const f = fixture(true);
  f.timeline.setState({ selectedClipIds: new Set(['a', 'b']) });
  await f.coordinator.flush();
  vi.mocked(f.storage.publishRevision).mockClear();
  editTextSelection(f.timeline.getState(), 'a', true, clip => {
    f.timeline.setState({ clips: f.timeline.getState().clips.map(current => current.id === clip.id
      ? { ...current, textProperties: { ...current.textProperties!, fontFamily: 'Lato' } } : current) });
  });
  await f.coordinator.flush();
  expect(f.timeline.getState().clips.map(clip => clip.textProperties?.fontFamily)).toEqual(['Lato', 'Lato']);
  expect(f.storage.publishRevision).toHaveBeenCalledTimes(1);
  const revision = vi.mocked(f.storage.publishRevision).mock.calls[0][0];
  expect(revision.changes.filter(change => JSON.stringify(change).includes('Lato'))).toHaveLength(2);
});
