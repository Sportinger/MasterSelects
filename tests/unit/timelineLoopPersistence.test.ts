import { describe, expect, it } from 'vitest';
import { convertProjectCompositionToStore } from '../../src/services/project/load/loadTimelineHydration';
import { prepareTimelineMutation } from '../../src/services/project/repository/transaction/domainAdapters/timelineAdapter';
import { encodeProjectDomains } from '../../src/services/project/repository/domains/projectDomains';
import type { ProjectComposition } from '../../src/services/project/projectFileService';
import type { ProjectFile } from '../../src/services/project/types/project.types';
import type { Composition } from '../../src/stores/mediaStore/types';
import type { TimelineStore } from '../../src/stores/timeline/types';

// The loop toggle of a composition survives a reload: it is saved as a view, never as a content revision.
const composition = { id: 'main', name: 'Main', width: 1920, height: 1080, frameRate: 30, duration: 10, backgroundColor: '#000', folderId: null,
  tracks: [{ id: 'v1', name: 'Video', type: 'video', height: 70, locked: false, visible: true, muted: false, solo: false }],
  clips: [], markers: [] } as unknown as ProjectComposition;
const project = { version: 1, name: 'Loop', createdAt: '2026-10-26', updatedAt: 'save-1',
  settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000 },
  media: [], folders: [], activeCompositionId: 'main', openCompositionIds: ['main'], expandedFolderIds: [],
  compositions: [composition] } as unknown as ProjectFile;
const timeline = { clips: [], tracks: [], clipKeyframes: new Map(), markers: [], duration: 10, durationLocked: false,
  videoBakeRegions: [], inPoint: null, outPoint: 6, playheadPosition: 0, zoom: 50, scrollX: 0, loopPlayback: false,
  selectedClipIds: new Set(), selectedKeyframeIds: new Set() } as unknown as TimelineStore;

describe('timeline loop persistence', () => {
  it('writes the loop toggle as a view of its composition', () => {
    const { entities } = encodeProjectDomains(project);
    const plan = prepareTimelineMutation(timeline, { loopPlayback: true }, { entities, activeComposition: { ...composition, timelineData: undefined } as unknown as Composition });
    expect(plan.aggregates).toHaveLength(0);
    expect(plan.views).toEqual([{ key: 'timeline/main/loopPlayback', value: true }]);
  });

  it('restores the saved loop toggle when the project opens', () => {
    expect(convertProjectCompositionToStore([composition], { main: { outPoint: 6, loopPlayback: true } })[0].timelineData?.loopPlayback).toBe(true);
    expect(convertProjectCompositionToStore([composition], { main: { outPoint: 6 } })[0].timelineData?.loopPlayback).toBe(false);
  });
});
