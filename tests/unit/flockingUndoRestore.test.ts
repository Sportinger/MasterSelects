// Undo and redo in a project restage the timeline from the repository (stageEditorTimeline). A clip
// with a Flocking effect must come back with its swarm graph: it used to return without `flock`, so
// the card said "no flock definition", the swarm vanished and getFlockClip failed after one Undo.
import { expect, it, vi } from 'vitest';
import type { Composition, MediaState } from '../../src/stores/mediaStore/types';
import type { SerializableClip, TimelineStore } from '../../src/stores/timeline/types';
import { DEFAULT_TRANSFORM } from '../../src/stores/timeline/constants';
import { stageEditorTimeline } from '../../src/services/project/repository/transaction/editorTimelineRestore';
import { createFlockPresetDefinition } from '../../src/services/flock/presets/flockPresets';

it('restages a clip with a Flocking effect together with its swarm graph', async () => {
  const flock = createFlockPresetDefinition('krill-cloud');
  const clip: SerializableClip = {
    id: 'solid-with-swarm', trackId: 'video', name: 'Black', mediaFileId: '',
    startTime: 0, duration: 10, inPoint: 0, outPoint: 10, transform: DEFAULT_TRANSFORM,
    sourceType: 'solid', solidColor: '#000000',
    effects: [{ id: 'fx-flock', name: 'Flocking', type: 'flocking', enabled: true, params: {} }],
    flock,
  } as SerializableClip;
  const composition = { id: 'comp', name: 'Main', type: 'composition', width: 64, height: 36, frameRate: 30, duration: 10,
    timelineData: { tracks: [{ id: 'video', name: 'Video', type: 'video', visible: true }], clips: [clip], duration: 10 } } as unknown as Composition;
  const media = { activeCompositionId: 'comp', compositions: [composition], files: [] } as unknown as MediaState;
  const current = { timelineSessionId: 1, clips: [], selectedClipIds: new Set(), selectedKeyframeIds: new Set(),
    clipKeyframes: new Map(), thumbnailsEnabled: false } as unknown as TimelineStore;

  const staged = await stageEditorTimeline(current, media, composition, new AbortController().signal, vi.fn(), () => current);
  const restored = staged.state.clips!.find(item => item.id === 'solid-with-swarm');
  expect(restored?.effects.map(effect => effect.type)).toEqual(['flocking']);
  expect(restored?.flock?.presetId).toBe('krill-cloud');
  expect(restored?.flock?.nodes.map(node => node.id)).toEqual(flock.nodes.map(node => node.id));
  staged.abandon();
});
