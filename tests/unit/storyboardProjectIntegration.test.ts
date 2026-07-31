import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyStoryboardProjectState } from '../../src/services/project/storyboard';
import {
  getStoryboardProjectSnapshot,
  hydrateStoryboardProjectState,
  resetStoryboardProjectState,
} from '../../src/stores/storyboardStore';
import { createHistorySnapshot } from '../../src/stores/historyStore/snapshotCapture';
import { applyHistorySnapshot } from '../../src/stores/historyStore/snapshotApply';

describe('storyboard project and history integration', () => {
  beforeEach(() => {
    resetStoryboardProjectState();
  });

  it('captures and restores the complete normalized storyboard state', () => {
    const state = createEmptyStoryboardProjectState();
    state.plans['plan-1'] = {
      schemaVersion: 1,
      id: 'plan-1',
      title: 'Launch film',
      sceneIds: [],
      createdAt: 1,
      updatedAt: 2,
    };
    hydrateStoryboardProjectState(state);

    const snapshot = createHistorySnapshot('Storyboard plan', {
      getStoryboardState: getStoryboardProjectSnapshot,
    });
    expect(snapshot.storyboard?.plans['plan-1']?.title).toBe('Launch film');

    resetStoryboardProjectState();
    applyHistorySnapshot(snapshot, {
      setStoryboardState: hydrateStoryboardProjectState,
    });

    expect(getStoryboardProjectSnapshot().plans['plan-1']).toEqual(
      expect.objectContaining({ id: 'plan-1', title: 'Launch film' }),
    );
  });

  it('does not erase live storyboard state when restoring a legacy history snapshot', () => {
    const state = createEmptyStoryboardProjectState();
    state.plans['legacy-safe'] = {
      schemaVersion: 1,
      id: 'legacy-safe',
      title: 'Keep me',
      sceneIds: [],
      createdAt: 1,
      updatedAt: 1,
    };
    hydrateStoryboardProjectState(state);

    const legacySnapshot = createHistorySnapshot('Legacy', {});
    delete legacySnapshot.storyboard;
    applyHistorySnapshot(legacySnapshot, {
      setStoryboardState: hydrateStoryboardProjectState,
    });

    expect(getStoryboardProjectSnapshot().plans['legacy-safe']?.title).toBe('Keep me');
  });
});
