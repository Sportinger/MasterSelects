import { beforeEach, describe, expect, it } from 'vitest';

import { executeToolInternal } from '../../src/services/aiTools/handlers';
import { checkToolAccess, getToolPolicy } from '../../src/services/aiTools/policy';
import { getToolRegistrySnapshot } from '../../src/services/aiTools/registrySnapshot';
import { MODIFYING_TOOLS } from '../../src/services/aiTools/types';
import {
  initHistoryStoreRefs,
  setHistoryCallbacks,
  useHistoryStore,
} from '../../src/stores/historyStore';
import { useMediaStore } from '../../src/stores/mediaStore';
import { useTimelineStore } from '../../src/stores/timeline';
import {
  getStoryboardProjectSnapshot,
  resetStoryboardProjectState,
} from '../../src/stores/storyboardStore';
import type { TimelineTrack } from '../../src/types/timeline';

const videoTrack: TimelineTrack = {
  id: 'video-storyboard',
  name: 'Storyboard',
  type: 'video',
  height: 80,
  muted: false,
  visible: true,
  solo: false,
};

function initializeHistory(): void {
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
}

async function execute(name: string, args: Record<string, unknown>) {
  return executeToolInternal(
    name,
    args,
    useTimelineStore.getState(),
    useMediaStore.getState(),
    'internal',
  );
}

describe('storyboard semantic AI tools', () => {
  beforeEach(() => {
    initializeHistory();
    useHistoryStore.getState().clearHistory();
    resetStoryboardProjectState();
    useTimelineStore.setState({
      tracks: [videoTrack],
      clips: [],
      playheadPosition: 4,
      selectedClipIds: new Set(),
      primarySelectedClipId: null,
      propertiesSelection: null,
      isExporting: false,
    });
  });

  it('creates, updates, and lists real scene cards through the registered handlers', async () => {
    const added = await execute('addStoryboardScene', {
      planId: 'plan-tools',
      title: 'Opening beat',
      description: 'A train enters the station.',
      visualDirection: 'Wide blue-hour establishing shot.',
      targetDurationSeconds: 7,
      durationSeconds: 5,
      status: 'ready',
    });
    expect(added).toMatchObject({
      success: true,
      data: {
        planId: 'plan-tools',
        title: 'Opening beat',
        visualDirection: 'Wide blue-hour establishing shot.',
        startTime: 4,
        durationSeconds: 5,
      },
    });

    const first = useTimelineStore.getState().clips[0];
    expect(first.source?.type).toBe('storyboard');
    expect(getStoryboardProjectSnapshot()).toMatchObject({
      plans: {
        'plan-tools': {
          sceneIds: [first.storyboardProperties!.sceneId],
        },
      },
      scenes: {
        [first.storyboardProperties!.sceneId]: {
          title: 'Opening beat',
          description: 'A train enters the station.',
          targetDurationSeconds: 7,
          status: 'ready',
        },
      },
    });
    useTimelineStore.setState({
      clips: [
        first,
        {
          ...first,
          id: 'copied-storyboard-card',
          startTime: 12,
          storyboardProperties: {
            ...first.storyboardProperties!,
          },
        },
      ],
    });

    const updated = await execute('updateStoryboardScene', {
      sceneId: first.storyboardProperties!.sceneId,
      title: 'Opening revised',
      notes: 'Keep the arrival wide.',
    });
    expect(updated).toMatchObject({
      success: true,
      data: { updatedClipCount: 2 },
    });
    expect(useTimelineStore.getState().clips.map(clip => clip.name))
      .toEqual(['Opening revised', 'Opening revised']);
    expect(
      getStoryboardProjectSnapshot().scenes[first.storyboardProperties!.sceneId],
    ).toMatchObject({
      title: 'Opening revised',
      notes: 'Keep the arrival wide.',
    });

    const listed = await execute('listStoryboardScenes', { planId: 'plan-tools' });
    expect(listed).toMatchObject({
      success: true,
      data: {
        count: 2,
        scenes: [
          { startTime: 4, title: 'Opening revised' },
          { startTime: 12, title: 'Opening revised' },
        ],
      },
    });
  });

  it('registers policy/definition/handler/modifying parity and blocks snapshot restore in Plan mode', () => {
    const registry = getToolRegistrySnapshot();
    for (const name of ['addStoryboardScene', 'updateStoryboardScene', 'listStoryboardScenes']) {
      expect(registry.definitionNames).toContain(name);
      expect(registry.handlerNames).toContain(name);
      expect(registry.policyNames).toContain(name);
    }
    expect(MODIFYING_TOOLS.has('addStoryboardScene')).toBe(true);
    expect(MODIFYING_TOOLS.has('updateStoryboardScene')).toBe(true);
    expect(MODIFYING_TOOLS.has('listStoryboardScenes')).toBe(false);
    expect(getToolPolicy('listStoryboardScenes')?.readOnly).toBe(true);
    expect(getToolPolicy('addStoryboardScene')?.riskLevel).toBe('medium');
    expect(checkToolAccess('addStoryboardScene', 'chat', { executionMode: 'plan' }).allowed)
      .toBe(true);
    expect(checkToolAccess('undo', 'chat', { executionMode: 'plan' }))
      .toMatchObject({ allowed: false });
    expect(checkToolAccess('redo', 'chat', { executionMode: 'plan' }))
      .toMatchObject({ allowed: false });
  });
});
