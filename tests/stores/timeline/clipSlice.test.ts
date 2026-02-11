import { describe, it, expect, beforeEach } from 'vitest';
import { createTestTimelineStore } from '../../helpers/storeFactory';
import { createMockClip, createMockTrack, createMockTransform, resetIdCounter } from '../../helpers/mockData';

describe('clipSlice', () => {
  let store: ReturnType<typeof createTestTimelineStore>;

  beforeEach(() => {
    resetIdCounter();
    store = createTestTimelineStore();
  });

  // ========== updateClip ==========

  describe('updateClip', () => {
    it('updates an existing clip with partial data', () => {
      const clip = createMockClip({ id: 'clip-1', trackId: 'video-1', startTime: 0, duration: 5 });
      store = createTestTimelineStore({ clips: [clip] } as any);

      store.getState().updateClip('clip-1', { name: 'Renamed Clip', startTime: 2 });
      const updated = store.getState().clips.find(c => c.id === 'clip-1');

      expect(updated).toBeDefined();
      expect(updated!.name).toBe('Renamed Clip');
      expect(updated!.startTime).toBe(2);
      // Original fields remain unchanged
      expect(updated!.duration).toBe(5);
      expect(updated!.trackId).toBe('video-1');
    });

    it('does nothing when clip id does not exist', () => {
      const clip = createMockClip({ id: 'clip-1' });
      store = createTestTimelineStore({ clips: [clip] } as any);

      store.getState().updateClip('nonexistent', { name: 'Ghost' });
      const state = store.getState();

      expect(state.clips.length).toBe(1);
      expect(state.clips[0].name).toBe(clip.name);
    });
  });

  // ========== removeClip ==========

  describe('removeClip', () => {
    it('removes a single clip from the timeline', () => {
      const clip = createMockClip({ id: 'clip-1', trackId: 'video-1' });
      store = createTestTimelineStore({ clips: [clip] } as any);

      store.getState().removeClip('clip-1');
      expect(store.getState().clips.length).toBe(0);
    });

    it('removes clip from selectedClipIds when removed', () => {
      const clip = createMockClip({ id: 'clip-1', trackId: 'video-1' });
      store = createTestTimelineStore({
        clips: [clip],
        selectedClipIds: new Set(['clip-1']),
      } as any);

      store.getState().removeClip('clip-1');
      expect(store.getState().selectedClipIds.has('clip-1')).toBe(false);
    });

    it('removes linked clip when both are selected', () => {
      const videoClip = createMockClip({ id: 'clip-v', trackId: 'video-1', linkedClipId: 'clip-a' });
      const audioClip = createMockClip({ id: 'clip-a', trackId: 'audio-1', linkedClipId: 'clip-v' });
      store = createTestTimelineStore({
        clips: [videoClip, audioClip],
        selectedClipIds: new Set(['clip-v', 'clip-a']),
      } as any);

      store.getState().removeClip('clip-v');
      expect(store.getState().clips.length).toBe(0);
    });

    it('keeps linked clip when only one is selected', () => {
      const videoClip = createMockClip({ id: 'clip-v', trackId: 'video-1', linkedClipId: 'clip-a' });
      const audioClip = createMockClip({ id: 'clip-a', trackId: 'audio-1', linkedClipId: 'clip-v' });
      store = createTestTimelineStore({
        clips: [videoClip, audioClip],
        selectedClipIds: new Set(['clip-v']),
      } as any);

      store.getState().removeClip('clip-v');
      const state = store.getState();
      expect(state.clips.length).toBe(1);
      expect(state.clips[0].id).toBe('clip-a');
      // linkedClipId should be cleared on the surviving clip
      expect(state.clips[0].linkedClipId).toBeUndefined();
    });

    it('does nothing when clip does not exist', () => {
      const clip = createMockClip({ id: 'clip-1' });
      store = createTestTimelineStore({ clips: [clip] } as any);

      store.getState().removeClip('nonexistent');
      expect(store.getState().clips.length).toBe(1);
    });
  });

  // ========== trimClip ==========

  describe('trimClip', () => {
    it('updates inPoint, outPoint, and duration correctly', () => {
      const clip = createMockClip({ id: 'clip-1', startTime: 0, duration: 10, inPoint: 0, outPoint: 10 });
      store = createTestTimelineStore({ clips: [clip] } as any);

      store.getState().trimClip('clip-1', 2, 8);
      const trimmed = store.getState().clips.find(c => c.id === 'clip-1')!;

      expect(trimmed.inPoint).toBe(2);
      expect(trimmed.outPoint).toBe(8);
      expect(trimmed.duration).toBe(6); // outPoint - inPoint
    });

    it('preserves other clip properties when trimming', () => {
      const clip = createMockClip({ id: 'clip-1', name: 'My Clip', startTime: 5, duration: 10, inPoint: 0, outPoint: 10 });
      store = createTestTimelineStore({ clips: [clip] } as any);

      store.getState().trimClip('clip-1', 1, 7);
      const trimmed = store.getState().clips.find(c => c.id === 'clip-1')!;

      expect(trimmed.name).toBe('My Clip');
      expect(trimmed.startTime).toBe(5);
    });
  });

  // ========== splitClip ==========

  describe('splitClip', () => {
    it('splits a clip into two parts at the given time', () => {
      const clip = createMockClip({
        id: 'clip-1',
        trackId: 'video-1',
        startTime: 0,
        duration: 10,
        inPoint: 0,
        outPoint: 10,
      });
      store = createTestTimelineStore({ clips: [clip] } as any);

      store.getState().splitClip('clip-1', 4);
      const state = store.getState();

      // Original clip removed, two new clips created
      expect(state.clips.find(c => c.id === 'clip-1')).toBeUndefined();
      expect(state.clips.length).toBe(2);

      // Sort by startTime to identify first and second
      const sorted = [...state.clips].sort((a, b) => a.startTime - b.startTime);
      const first = sorted[0];
      const second = sorted[1];

      expect(first.startTime).toBe(0);
      expect(first.duration).toBe(4);
      expect(first.outPoint).toBe(4); // inPoint(0) + firstPartDuration(4)

      expect(second.startTime).toBe(4);
      expect(second.duration).toBe(6);
      expect(second.inPoint).toBe(4); // splitInSource
    });

    it('selects the second clip after splitting', () => {
      const clip = createMockClip({
        id: 'clip-1',
        trackId: 'video-1',
        startTime: 0,
        duration: 10,
        inPoint: 0,
        outPoint: 10,
      });
      store = createTestTimelineStore({ clips: [clip] } as any);

      store.getState().splitClip('clip-1', 5);
      const state = store.getState();

      // The second clip (starting at splitTime) should be selected
      const secondClip = state.clips.find(c => c.startTime === 5);
      expect(secondClip).toBeDefined();
      expect(state.selectedClipIds.has(secondClip!.id)).toBe(true);
    });

    it('does not split at the clip start edge', () => {
      const clip = createMockClip({ id: 'clip-1', startTime: 2, duration: 8, inPoint: 0, outPoint: 8 });
      store = createTestTimelineStore({ clips: [clip] } as any);

      store.getState().splitClip('clip-1', 2); // splitTime == startTime
      expect(store.getState().clips.length).toBe(1);
      expect(store.getState().clips[0].id).toBe('clip-1');
    });

    it('does not split at the clip end edge', () => {
      const clip = createMockClip({ id: 'clip-1', startTime: 2, duration: 8, inPoint: 0, outPoint: 8 });
      store = createTestTimelineStore({ clips: [clip] } as any);

      store.getState().splitClip('clip-1', 10); // splitTime == startTime + duration
      expect(store.getState().clips.length).toBe(1);
    });

    it('does not split outside clip range', () => {
      const clip = createMockClip({ id: 'clip-1', startTime: 2, duration: 8, inPoint: 0, outPoint: 8 });
      store = createTestTimelineStore({ clips: [clip] } as any);

      store.getState().splitClip('clip-1', 20); // way outside
      expect(store.getState().clips.length).toBe(1);
    });

    it('splits linked clips (video + audio) together', () => {
      const videoClip = createMockClip({
        id: 'clip-v',
        trackId: 'video-1',
        startTime: 0,
        duration: 10,
        inPoint: 0,
        outPoint: 10,
        linkedClipId: 'clip-a',
      });
      const audioClip = createMockClip({
        id: 'clip-a',
        trackId: 'audio-1',
        startTime: 0,
        duration: 10,
        inPoint: 0,
        outPoint: 10,
        linkedClipId: 'clip-v',
      });
      store = createTestTimelineStore({ clips: [videoClip, audioClip] } as any);

      store.getState().splitClip('clip-v', 5);
      const state = store.getState();

      // Both original clips removed, 4 new clips (2 video halves + 2 audio halves)
      expect(state.clips.find(c => c.id === 'clip-v')).toBeUndefined();
      expect(state.clips.find(c => c.id === 'clip-a')).toBeUndefined();
      expect(state.clips.length).toBe(4);

      // Video clips on video-1
      const videoClips = state.clips.filter(c => c.trackId === 'video-1');
      expect(videoClips.length).toBe(2);

      // Audio clips on audio-1
      const audioClips = state.clips.filter(c => c.trackId === 'audio-1');
      expect(audioClips.length).toBe(2);

      // Each video clip should be linked to a corresponding audio clip
      for (const vc of videoClips) {
        expect(vc.linkedClipId).toBeDefined();
        const linkedAudio = audioClips.find(ac => ac.id === vc.linkedClipId);
        expect(linkedAudio).toBeDefined();
        expect(linkedAudio!.linkedClipId).toBe(vc.id);
      }
    });

    it('preserves clip properties like name and trackId in split halves', () => {
      const clip = createMockClip({
        id: 'clip-1',
        trackId: 'video-1',
        name: 'Interview',
        startTime: 0,
        duration: 10,
        inPoint: 0,
        outPoint: 10,
      });
      store = createTestTimelineStore({ clips: [clip] } as any);

      store.getState().splitClip('clip-1', 3);
      const state = store.getState();

      for (const c of state.clips) {
        expect(c.name).toBe('Interview');
        expect(c.trackId).toBe('video-1');
      }
    });
  });

  // ========== splitClipAtPlayhead ==========

  describe('splitClipAtPlayhead', () => {
    it('splits clips at the current playhead position', () => {
      const clip = createMockClip({
        id: 'clip-1',
        trackId: 'video-1',
        startTime: 0,
        duration: 10,
        inPoint: 0,
        outPoint: 10,
      });
      store = createTestTimelineStore({
        clips: [clip],
        playheadPosition: 5,
      } as any);

      store.getState().splitClipAtPlayhead();
      const state = store.getState();

      expect(state.clips.find(c => c.id === 'clip-1')).toBeUndefined();
      expect(state.clips.length).toBe(2);

      const sorted = [...state.clips].sort((a, b) => a.startTime - b.startTime);
      expect(sorted[0].duration).toBe(5);
      expect(sorted[1].startTime).toBe(5);
      expect(sorted[1].duration).toBe(5);
    });

    it('does nothing when playhead is not over any clip', () => {
      const clip = createMockClip({
        id: 'clip-1',
        trackId: 'video-1',
        startTime: 0,
        duration: 5,
        inPoint: 0,
        outPoint: 5,
      });
      store = createTestTimelineStore({
        clips: [clip],
        playheadPosition: 10, // past the clip
      } as any);

      store.getState().splitClipAtPlayhead();
      expect(store.getState().clips.length).toBe(1);
      expect(store.getState().clips[0].id).toBe('clip-1');
    });

    it('only splits selected clips when some are selected', () => {
      const clip1 = createMockClip({
        id: 'clip-1',
        trackId: 'video-1',
        startTime: 0,
        duration: 10,
        inPoint: 0,
        outPoint: 10,
      });
      const clip2 = createMockClip({
        id: 'clip-2',
        trackId: 'video-1',
        startTime: 0, // overlapping for test purposes
        duration: 10,
        inPoint: 0,
        outPoint: 10,
      });
      store = createTestTimelineStore({
        clips: [clip1, clip2],
        playheadPosition: 5,
        selectedClipIds: new Set(['clip-1']), // only clip-1 selected
      } as any);

      store.getState().splitClipAtPlayhead();
      const state = store.getState();

      // clip-1 should be split (removed, 2 new)
      expect(state.clips.find(c => c.id === 'clip-1')).toBeUndefined();
      // clip-2 should remain intact
      expect(state.clips.find(c => c.id === 'clip-2')).toBeDefined();
    });
  });

  // ========== moveClip ==========

  describe('moveClip', () => {
    it('moves a clip to a new start time on the same track', () => {
      const clip = createMockClip({ id: 'clip-1', trackId: 'video-1', startTime: 0, duration: 5 });
      store = createTestTimelineStore({
        clips: [clip],
        snappingEnabled: false,
      } as any);

      store.getState().moveClip('clip-1', 10);
      const moved = store.getState().clips.find(c => c.id === 'clip-1')!;

      expect(moved.startTime).toBe(10);
      expect(moved.trackId).toBe('video-1');
    });

    it('prevents moving a clip to negative start time', () => {
      const clip = createMockClip({ id: 'clip-1', trackId: 'video-1', startTime: 5, duration: 5 });
      store = createTestTimelineStore({
        clips: [clip],
        snappingEnabled: false,
      } as any);

      store.getState().moveClip('clip-1', -10);
      const moved = store.getState().clips.find(c => c.id === 'clip-1')!;

      expect(moved.startTime).toBe(0); // clamped to 0
    });

    it('moves a clip to a different video track', () => {
      const track2 = createMockTrack({ id: 'video-2', type: 'video' });
      const clip = createMockClip({
        id: 'clip-1',
        trackId: 'video-1',
        startTime: 0,
        duration: 5,
        source: { type: 'video', naturalDuration: 5 } as any,
      });
      store = createTestTimelineStore({
        tracks: [
          { id: 'video-1', name: 'Video 1', type: 'video', height: 60, muted: false, visible: true, solo: false },
          track2,
          { id: 'audio-1', name: 'Audio 1', type: 'audio', height: 40, muted: false, visible: true, solo: false },
        ],
        clips: [clip],
        snappingEnabled: false,
      } as any);

      store.getState().moveClip('clip-1', 0, 'video-2');
      const moved = store.getState().clips.find(c => c.id === 'clip-1')!;

      expect(moved.trackId).toBe('video-2');
    });

    it('prevents moving video clip to audio track', () => {
      const clip = createMockClip({
        id: 'clip-1',
        trackId: 'video-1',
        startTime: 0,
        duration: 5,
        source: { type: 'video', naturalDuration: 5 } as any,
      });
      store = createTestTimelineStore({ clips: [clip] } as any);

      store.getState().moveClip('clip-1', 0, 'audio-1');
      const moved = store.getState().clips.find(c => c.id === 'clip-1')!;

      // Should not change track
      expect(moved.trackId).toBe('video-1');
    });

    it('moves linked clip in sync with the primary clip', () => {
      const videoClip = createMockClip({
        id: 'clip-v',
        trackId: 'video-1',
        startTime: 0,
        duration: 5,
        linkedClipId: 'clip-a',
      });
      const audioClip = createMockClip({
        id: 'clip-a',
        trackId: 'audio-1',
        startTime: 0,
        duration: 5,
        linkedClipId: 'clip-v',
      });
      store = createTestTimelineStore({
        clips: [videoClip, audioClip],
        snappingEnabled: false,
      } as any);

      store.getState().moveClip('clip-v', 10);
      const state = store.getState();

      const movedVideo = state.clips.find(c => c.id === 'clip-v')!;
      const movedAudio = state.clips.find(c => c.id === 'clip-a')!;

      expect(movedVideo.startTime).toBe(10);
      expect(movedAudio.startTime).toBe(10); // moved in sync
    });

    it('does not move linked clip when skipLinked is true', () => {
      const videoClip = createMockClip({
        id: 'clip-v',
        trackId: 'video-1',
        startTime: 0,
        duration: 5,
        linkedClipId: 'clip-a',
      });
      const audioClip = createMockClip({
        id: 'clip-a',
        trackId: 'audio-1',
        startTime: 0,
        duration: 5,
        linkedClipId: 'clip-v',
      });
      store = createTestTimelineStore({
        clips: [videoClip, audioClip],
        snappingEnabled: false,
      } as any);

      store.getState().moveClip('clip-v', 10, undefined, true); // skipLinked
      const state = store.getState();

      expect(state.clips.find(c => c.id === 'clip-v')!.startTime).toBe(10);
      expect(state.clips.find(c => c.id === 'clip-a')!.startTime).toBe(0); // unchanged
    });
  });

  // ========== updateClipTransform ==========

  describe('updateClipTransform', () => {
    it('updates clip transform with partial data', () => {
      const clip = createMockClip({ id: 'clip-1', trackId: 'video-1' });
      store = createTestTimelineStore({ clips: [clip] } as any);

      store.getState().updateClipTransform('clip-1', { opacity: 0.5 });
      const updated = store.getState().clips.find(c => c.id === 'clip-1')!;

      expect(updated.transform.opacity).toBe(0.5);
      // Other transform fields should remain at defaults
      expect(updated.transform.blendMode).toBe('normal');
    });

    it('deeply merges position updates', () => {
      const clip = createMockClip({ id: 'clip-1', trackId: 'video-1' });
      store = createTestTimelineStore({ clips: [clip] } as any);

      store.getState().updateClipTransform('clip-1', { position: { x: 100 } } as any);
      const updated = store.getState().clips.find(c => c.id === 'clip-1')!;

      expect(updated.transform.position.x).toBe(100);
      expect(updated.transform.position.y).toBe(0); // preserved
      expect(updated.transform.position.z).toBe(0); // preserved
    });

    it('deeply merges scale updates', () => {
      const clip = createMockClip({ id: 'clip-1', trackId: 'video-1' });
      store = createTestTimelineStore({ clips: [clip] } as any);

      store.getState().updateClipTransform('clip-1', { scale: { x: 2 } } as any);
      const updated = store.getState().clips.find(c => c.id === 'clip-1')!;

      expect(updated.transform.scale.x).toBe(2);
      expect(updated.transform.scale.y).toBe(1); // preserved
    });
  });

  // ========== toggleClipReverse ==========

  describe('toggleClipReverse', () => {
    it('toggles reversed flag from undefined to true', () => {
      const clip = createMockClip({ id: 'clip-1', trackId: 'video-1' });
      store = createTestTimelineStore({ clips: [clip] } as any);

      store.getState().toggleClipReverse('clip-1');
      expect(store.getState().clips.find(c => c.id === 'clip-1')!.reversed).toBe(true);
    });

    it('toggles reversed flag from true to false', () => {
      const clip = createMockClip({ id: 'clip-1', trackId: 'video-1', reversed: true });
      store = createTestTimelineStore({ clips: [clip] } as any);

      store.getState().toggleClipReverse('clip-1');
      expect(store.getState().clips.find(c => c.id === 'clip-1')!.reversed).toBe(false);
    });

    it('reverses thumbnail array when toggling', () => {
      const clip = createMockClip({
        id: 'clip-1',
        trackId: 'video-1',
        thumbnails: ['thumb-a', 'thumb-b', 'thumb-c'],
      });
      store = createTestTimelineStore({ clips: [clip] } as any);

      store.getState().toggleClipReverse('clip-1');
      expect(store.getState().clips.find(c => c.id === 'clip-1')!.thumbnails).toEqual([
        'thumb-c', 'thumb-b', 'thumb-a',
      ]);
    });
  });

  // ========== Effect operations ==========

  describe('addClipEffect', () => {
    it('adds an effect to a clip', () => {
      const clip = createMockClip({ id: 'clip-1', trackId: 'video-1', effects: [] });
      store = createTestTimelineStore({ clips: [clip] } as any);

      store.getState().addClipEffect('clip-1', 'blur');
      const updated = store.getState().clips.find(c => c.id === 'clip-1')!;

      expect(updated.effects.length).toBe(1);
      expect(updated.effects[0].type).toBe('blur');
      expect(updated.effects[0].name).toBe('blur');
      expect(updated.effects[0].enabled).toBe(true);
      expect(updated.effects[0].id).toBeTruthy();
    });

    it('adds multiple effects to the same clip', () => {
      const clip = createMockClip({ id: 'clip-1', trackId: 'video-1', effects: [] });
      store = createTestTimelineStore({ clips: [clip] } as any);

      store.getState().addClipEffect('clip-1', 'blur');
      store.getState().addClipEffect('clip-1', 'hue-shift');
      const updated = store.getState().clips.find(c => c.id === 'clip-1')!;

      expect(updated.effects.length).toBe(2);
      expect(updated.effects[0].type).toBe('blur');
      expect(updated.effects[1].type).toBe('hue-shift');
    });
  });

  describe('removeClipEffect', () => {
    it('removes an effect by id', () => {
      const clip = createMockClip({
        id: 'clip-1',
        trackId: 'video-1',
        effects: [
          { id: 'fx-1', name: 'blur', type: 'blur' as any, enabled: true, params: {} },
          { id: 'fx-2', name: 'invert', type: 'invert' as any, enabled: true, params: {} },
        ],
      });
      store = createTestTimelineStore({ clips: [clip] } as any);

      store.getState().removeClipEffect('clip-1', 'fx-1');
      const updated = store.getState().clips.find(c => c.id === 'clip-1')!;

      expect(updated.effects.length).toBe(1);
      expect(updated.effects[0].id).toBe('fx-2');
    });
  });

  describe('updateClipEffect', () => {
    it('updates effect params by merging', () => {
      const clip = createMockClip({
        id: 'clip-1',
        trackId: 'video-1',
        effects: [
          { id: 'fx-1', name: 'blur', type: 'blur' as any, enabled: true, params: { radius: 5, quality: 1 } },
        ],
      });
      store = createTestTimelineStore({ clips: [clip] } as any);

      store.getState().updateClipEffect('clip-1', 'fx-1', { radius: 10 });
      const updated = store.getState().clips.find(c => c.id === 'clip-1')!;

      expect(updated.effects[0].params.radius).toBe(10);
      expect(updated.effects[0].params.quality).toBe(1); // preserved
    });
  });

  describe('setClipEffectEnabled', () => {
    it('disables an effect', () => {
      const clip = createMockClip({
        id: 'clip-1',
        trackId: 'video-1',
        effects: [
          { id: 'fx-1', name: 'blur', type: 'blur' as any, enabled: true, params: {} },
        ],
      });
      store = createTestTimelineStore({ clips: [clip] } as any);

      store.getState().setClipEffectEnabled('clip-1', 'fx-1', false);
      const updated = store.getState().clips.find(c => c.id === 'clip-1')!;

      expect(updated.effects[0].enabled).toBe(false);
    });

    it('re-enables a disabled effect', () => {
      const clip = createMockClip({
        id: 'clip-1',
        trackId: 'video-1',
        effects: [
          { id: 'fx-1', name: 'blur', type: 'blur' as any, enabled: false, params: {} },
        ],
      });
      store = createTestTimelineStore({ clips: [clip] } as any);

      store.getState().setClipEffectEnabled('clip-1', 'fx-1', true);
      const updated = store.getState().clips.find(c => c.id === 'clip-1')!;

      expect(updated.effects[0].enabled).toBe(true);
    });
  });

  // ========== Linked group operations ==========

  describe('createLinkedGroup', () => {
    it('creates a linked group for multiple clips', () => {
      const clip1 = createMockClip({ id: 'clip-1', trackId: 'video-1', startTime: 0, duration: 5 });
      const clip2 = createMockClip({ id: 'clip-2', trackId: 'video-1', startTime: 10, duration: 5 });
      store = createTestTimelineStore({ clips: [clip1, clip2] } as any);

      const offsets = new Map<string, number>();
      offsets.set('clip-1', 0);
      offsets.set('clip-2', 10000); // 10 seconds in ms

      store.getState().createLinkedGroup(['clip-1', 'clip-2'], offsets);
      const state = store.getState();

      const c1 = state.clips.find(c => c.id === 'clip-1')!;
      const c2 = state.clips.find(c => c.id === 'clip-2')!;

      expect(c1.linkedGroupId).toBeDefined();
      expect(c1.linkedGroupId).toBe(c2.linkedGroupId);
    });
  });

  describe('unlinkGroup', () => {
    it('removes linkedGroupId from all clips in the group', () => {
      const clip1 = createMockClip({ id: 'clip-1', trackId: 'video-1', linkedGroupId: 'group-1' });
      const clip2 = createMockClip({ id: 'clip-2', trackId: 'video-1', linkedGroupId: 'group-1' });
      const clip3 = createMockClip({ id: 'clip-3', trackId: 'video-1', linkedGroupId: 'group-2' });
      store = createTestTimelineStore({ clips: [clip1, clip2, clip3] } as any);

      store.getState().unlinkGroup('clip-1');
      const state = store.getState();

      expect(state.clips.find(c => c.id === 'clip-1')!.linkedGroupId).toBeUndefined();
      expect(state.clips.find(c => c.id === 'clip-2')!.linkedGroupId).toBeUndefined();
      // clip-3 in a different group should remain unaffected
      expect(state.clips.find(c => c.id === 'clip-3')!.linkedGroupId).toBe('group-2');
    });

    it('does nothing when clip has no linkedGroupId', () => {
      const clip = createMockClip({ id: 'clip-1', trackId: 'video-1' });
      store = createTestTimelineStore({ clips: [clip] } as any);

      store.getState().unlinkGroup('clip-1');
      expect(store.getState().clips.find(c => c.id === 'clip-1')!.linkedGroupId).toBeUndefined();
    });
  });

  // ========== Clip parenting ==========

  describe('setClipParent', () => {
    it('sets a parent clip for a child clip', () => {
      const parent = createMockClip({ id: 'clip-parent', trackId: 'video-1' });
      const child = createMockClip({ id: 'clip-child', trackId: 'video-1' });
      store = createTestTimelineStore({ clips: [parent, child] } as any);

      store.getState().setClipParent('clip-child', 'clip-parent');
      expect(store.getState().clips.find(c => c.id === 'clip-child')!.parentClipId).toBe('clip-parent');
    });

    it('prevents self-parenting', () => {
      const clip = createMockClip({ id: 'clip-1', trackId: 'video-1' });
      store = createTestTimelineStore({ clips: [clip] } as any);

      store.getState().setClipParent('clip-1', 'clip-1');
      expect(store.getState().clips.find(c => c.id === 'clip-1')!.parentClipId).toBeUndefined();
    });

    it('prevents circular parent references', () => {
      const clipA = createMockClip({ id: 'clip-a', trackId: 'video-1', parentClipId: 'clip-b' });
      const clipB = createMockClip({ id: 'clip-b', trackId: 'video-1' });
      store = createTestTimelineStore({ clips: [clipA, clipB] } as any);

      // Try to parent clip-b to clip-a (which already parents to clip-b => cycle)
      store.getState().setClipParent('clip-b', 'clip-a');
      expect(store.getState().clips.find(c => c.id === 'clip-b')!.parentClipId).toBeUndefined();
    });

    it('clears parent when set to null', () => {
      const clip = createMockClip({ id: 'clip-1', trackId: 'video-1', parentClipId: 'clip-parent' });
      store = createTestTimelineStore({ clips: [clip] } as any);

      store.getState().setClipParent('clip-1', null);
      expect(store.getState().clips.find(c => c.id === 'clip-1')!.parentClipId).toBeUndefined();
    });
  });

  describe('getClipChildren', () => {
    it('returns clips that have this clip as parent', () => {
      const parent = createMockClip({ id: 'clip-parent', trackId: 'video-1' });
      const child1 = createMockClip({ id: 'clip-child1', trackId: 'video-1', parentClipId: 'clip-parent' });
      const child2 = createMockClip({ id: 'clip-child2', trackId: 'video-1', parentClipId: 'clip-parent' });
      const unrelated = createMockClip({ id: 'clip-other', trackId: 'video-1' });
      store = createTestTimelineStore({ clips: [parent, child1, child2, unrelated] } as any);

      const children = store.getState().getClipChildren('clip-parent');

      expect(children.length).toBe(2);
      expect(children.map(c => c.id).sort()).toEqual(['clip-child1', 'clip-child2']);
    });

    it('returns empty array when no children exist', () => {
      const clip = createMockClip({ id: 'clip-1', trackId: 'video-1' });
      store = createTestTimelineStore({ clips: [clip] } as any);

      expect(store.getState().getClipChildren('clip-1')).toEqual([]);
    });
  });

  // ========== setClipPreservesPitch ==========

  describe('setClipPreservesPitch', () => {
    it('sets preservesPitch flag on a clip', () => {
      const clip = createMockClip({ id: 'clip-1', trackId: 'video-1' });
      store = createTestTimelineStore({ clips: [clip] } as any);

      store.getState().setClipPreservesPitch('clip-1', true);
      expect(store.getState().clips.find(c => c.id === 'clip-1')!.preservesPitch).toBe(true);
    });

    it('can set preservesPitch to false', () => {
      const clip = createMockClip({ id: 'clip-1', trackId: 'video-1', preservesPitch: true });
      store = createTestTimelineStore({ clips: [clip] } as any);

      store.getState().setClipPreservesPitch('clip-1', false);
      expect(store.getState().clips.find(c => c.id === 'clip-1')!.preservesPitch).toBe(false);
    });
  });

  // ========== YouTube download helpers ==========

  describe('updateDownloadProgress', () => {
    it('updates download progress on a pending clip', () => {
      const clip = createMockClip({ id: 'yt-clip-1', trackId: 'video-1', isPendingDownload: true, downloadProgress: 0 });
      store = createTestTimelineStore({ clips: [clip] } as any);

      store.getState().updateDownloadProgress('yt-clip-1', 55);
      expect(store.getState().clips.find(c => c.id === 'yt-clip-1')!.downloadProgress).toBe(55);
    });

    it('updates progress to 100 percent', () => {
      const clip = createMockClip({ id: 'yt-clip-1', trackId: 'video-1', isPendingDownload: true, downloadProgress: 50 });
      store = createTestTimelineStore({ clips: [clip] } as any);

      store.getState().updateDownloadProgress('yt-clip-1', 100);
      expect(store.getState().clips.find(c => c.id === 'yt-clip-1')!.downloadProgress).toBe(100);
    });

    it('does not crash when clip does not exist', () => {
      store = createTestTimelineStore({ clips: [] } as any);
      // Should not throw
      store.getState().updateDownloadProgress('nonexistent', 50);
      expect(store.getState().clips.length).toBe(0);
    });
  });

  describe('setDownloadError', () => {
    it('sets error and clears pending state', () => {
      const clip = createMockClip({ id: 'yt-clip-1', trackId: 'video-1', isPendingDownload: true });
      store = createTestTimelineStore({ clips: [clip] } as any);

      store.getState().setDownloadError('yt-clip-1', 'Network error');
      const updated = store.getState().clips.find(c => c.id === 'yt-clip-1')!;

      expect(updated.downloadError).toBe('Network error');
      expect(updated.isPendingDownload).toBe(false);
    });

    it('does not crash when clip does not exist', () => {
      store = createTestTimelineStore({ clips: [] } as any);
      // Should not throw
      store.getState().setDownloadError('nonexistent', 'Error');
      expect(store.getState().clips.length).toBe(0);
    });
  });

  // ========== Additional updateClip edge cases ==========

  describe('updateClip (additional)', () => {
    it('updates multiple properties at once', () => {
      const clip = createMockClip({ id: 'clip-1', trackId: 'video-1', startTime: 0, duration: 5, name: 'Original' });
      store = createTestTimelineStore({ clips: [clip] } as any);

      store.getState().updateClip('clip-1', { name: 'Updated', startTime: 3, duration: 10 });
      const updated = store.getState().clips.find(c => c.id === 'clip-1')!;

      expect(updated.name).toBe('Updated');
      expect(updated.startTime).toBe(3);
      expect(updated.duration).toBe(10);
    });

    it('does not affect other clips when updating one', () => {
      const clip1 = createMockClip({ id: 'clip-1', trackId: 'video-1', name: 'Clip 1' });
      const clip2 = createMockClip({ id: 'clip-2', trackId: 'video-1', name: 'Clip 2' });
      store = createTestTimelineStore({ clips: [clip1, clip2] } as any);

      store.getState().updateClip('clip-1', { name: 'Modified' });

      expect(store.getState().clips.find(c => c.id === 'clip-1')!.name).toBe('Modified');
      expect(store.getState().clips.find(c => c.id === 'clip-2')!.name).toBe('Clip 2');
    });
  });

  // ========== Additional removeClip edge cases ==========

  describe('removeClip (additional)', () => {
    it('removes only the target clip from multiple clips', () => {
      const clip1 = createMockClip({ id: 'clip-1', trackId: 'video-1' });
      const clip2 = createMockClip({ id: 'clip-2', trackId: 'video-1' });
      const clip3 = createMockClip({ id: 'clip-3', trackId: 'video-1' });
      store = createTestTimelineStore({ clips: [clip1, clip2, clip3] } as any);

      store.getState().removeClip('clip-2');
      const state = store.getState();

      expect(state.clips.length).toBe(2);
      expect(state.clips.map(c => c.id).sort()).toEqual(['clip-1', 'clip-3']);
    });

    it('clears selection for all removed clip ids', () => {
      const videoClip = createMockClip({ id: 'clip-v', trackId: 'video-1', linkedClipId: 'clip-a' });
      const audioClip = createMockClip({ id: 'clip-a', trackId: 'audio-1', linkedClipId: 'clip-v' });
      store = createTestTimelineStore({
        clips: [videoClip, audioClip],
        selectedClipIds: new Set(['clip-v', 'clip-a']),
      } as any);

      store.getState().removeClip('clip-v');
      const state = store.getState();

      expect(state.selectedClipIds.has('clip-v')).toBe(false);
      expect(state.selectedClipIds.has('clip-a')).toBe(false);
      expect(state.selectedClipIds.size).toBe(0);
    });

    it('clears linkedClipId on surviving clip when linked partner is removed', () => {
      const videoClip = createMockClip({ id: 'clip-v', trackId: 'video-1', linkedClipId: 'clip-a' });
      const audioClip = createMockClip({ id: 'clip-a', trackId: 'audio-1', linkedClipId: 'clip-v' });
      store = createTestTimelineStore({
        clips: [videoClip, audioClip],
        selectedClipIds: new Set(['clip-a']),
      } as any);

      // Remove audio clip only (video not selected)
      store.getState().removeClip('clip-a');
      const state = store.getState();

      expect(state.clips.length).toBe(1);
      expect(state.clips[0].id).toBe('clip-v');
      expect(state.clips[0].linkedClipId).toBeUndefined();
    });
  });

  // ========== Additional trimClip edge cases ==========

  describe('trimClip (additional)', () => {
    it('does not affect other clips when trimming one', () => {
      const clip1 = createMockClip({ id: 'clip-1', startTime: 0, duration: 10, inPoint: 0, outPoint: 10 });
      const clip2 = createMockClip({ id: 'clip-2', startTime: 10, duration: 10, inPoint: 0, outPoint: 10 });
      store = createTestTimelineStore({ clips: [clip1, clip2] } as any);

      store.getState().trimClip('clip-1', 2, 6);

      const trimmed = store.getState().clips.find(c => c.id === 'clip-1')!;
      const untouched = store.getState().clips.find(c => c.id === 'clip-2')!;

      expect(trimmed.duration).toBe(4);
      expect(untouched.duration).toBe(10);
      expect(untouched.inPoint).toBe(0);
      expect(untouched.outPoint).toBe(10);
    });

    it('allows trimming to a very small duration', () => {
      const clip = createMockClip({ id: 'clip-1', startTime: 0, duration: 10, inPoint: 0, outPoint: 10 });
      store = createTestTimelineStore({ clips: [clip] } as any);

      store.getState().trimClip('clip-1', 4.99, 5.01);
      const trimmed = store.getState().clips.find(c => c.id === 'clip-1')!;

      expect(trimmed.inPoint).toBe(4.99);
      expect(trimmed.outPoint).toBe(5.01);
      expect(trimmed.duration).toBeCloseTo(0.02, 5);
    });
  });

  // ========== Additional splitClip edge cases ==========

  describe('splitClip (additional)', () => {
    it('does nothing when clip does not exist', () => {
      const clip = createMockClip({ id: 'clip-1', trackId: 'video-1', startTime: 0, duration: 10, inPoint: 0, outPoint: 10 });
      store = createTestTimelineStore({ clips: [clip] } as any);

      store.getState().splitClip('nonexistent', 5);
      expect(store.getState().clips.length).toBe(1);
      expect(store.getState().clips[0].id).toBe('clip-1');
    });

    it('does not split before the clip range', () => {
      const clip = createMockClip({ id: 'clip-1', startTime: 5, duration: 5, inPoint: 0, outPoint: 5 });
      store = createTestTimelineStore({ clips: [clip] } as any);

      store.getState().splitClip('clip-1', 2); // before clip start
      expect(store.getState().clips.length).toBe(1);
    });

    it('correctly handles split with non-zero inPoint', () => {
      const clip = createMockClip({
        id: 'clip-1',
        trackId: 'video-1',
        startTime: 0,
        duration: 6,
        inPoint: 2,
        outPoint: 8,
      });
      store = createTestTimelineStore({ clips: [clip] } as any);

      store.getState().splitClip('clip-1', 3); // 3 seconds into the clip
      const state = store.getState();

      expect(state.clips.length).toBe(2);
      const sorted = [...state.clips].sort((a, b) => a.startTime - b.startTime);

      const first = sorted[0];
      const second = sorted[1];

      // First part: startTime=0, duration=3, outPoint should be inPoint + 3 = 5
      expect(first.startTime).toBe(0);
      expect(first.duration).toBe(3);
      expect(first.outPoint).toBe(5); // clip.inPoint(2) + firstPartDuration(3)

      // Second part: startTime=3, duration=3, inPoint should be splitInSource = 2 + 3 = 5
      expect(second.startTime).toBe(3);
      expect(second.duration).toBe(3);
      expect(second.inPoint).toBe(5);
    });

    it('preserves effects when splitting', () => {
      const clip = createMockClip({
        id: 'clip-1',
        trackId: 'video-1',
        startTime: 0,
        duration: 10,
        inPoint: 0,
        outPoint: 10,
        effects: [
          { id: 'fx-1', name: 'blur', type: 'blur' as any, enabled: true, params: { radius: 5 } },
        ],
      });
      store = createTestTimelineStore({ clips: [clip] } as any);

      store.getState().splitClip('clip-1', 5);
      const state = store.getState();

      for (const c of state.clips) {
        expect(c.effects.length).toBe(1);
        expect(c.effects[0].type).toBe('blur');
        expect(c.effects[0].params.radius).toBe(5);
      }
    });

    it('deep clones effects so split halves are independent', () => {
      const clip = createMockClip({
        id: 'clip-1',
        trackId: 'video-1',
        startTime: 0,
        duration: 10,
        inPoint: 0,
        outPoint: 10,
        effects: [
          { id: 'fx-1', name: 'blur', type: 'blur' as any, enabled: true, params: { radius: 5 } },
        ],
      });
      store = createTestTimelineStore({ clips: [clip] } as any);

      store.getState().splitClip('clip-1', 5);
      const state = store.getState();
      const sorted = [...state.clips].sort((a, b) => a.startTime - b.startTime);

      // Effects should be independent objects (not shared references)
      expect(sorted[0].effects[0]).not.toBe(sorted[1].effects[0]);
    });

    it('preserves transform when splitting', () => {
      const clip = createMockClip({
        id: 'clip-1',
        trackId: 'video-1',
        startTime: 0,
        duration: 10,
        inPoint: 0,
        outPoint: 10,
        transform: {
          opacity: 0.5,
          blendMode: 'multiply' as any,
          position: { x: 100, y: 200, z: 0 },
          scale: { x: 2, y: 2 },
          rotation: { x: 0, y: 0, z: 45 },
        },
      });
      store = createTestTimelineStore({ clips: [clip] } as any);

      store.getState().splitClip('clip-1', 5);
      const state = store.getState();

      for (const c of state.clips) {
        expect(c.transform.opacity).toBe(0.5);
        expect(c.transform.position.x).toBe(100);
        expect(c.transform.position.y).toBe(200);
        expect(c.transform.scale.x).toBe(2);
        expect(c.transform.rotation.z).toBe(45);
      }
    });

    it('does not leave other clips on the same track affected', () => {
      const clip1 = createMockClip({
        id: 'clip-1', trackId: 'video-1', startTime: 0, duration: 10, inPoint: 0, outPoint: 10,
      });
      const clip2 = createMockClip({
        id: 'clip-2', trackId: 'video-1', startTime: 20, duration: 5, inPoint: 0, outPoint: 5,
      });
      store = createTestTimelineStore({ clips: [clip1, clip2] } as any);

      store.getState().splitClip('clip-1', 5);
      const state = store.getState();

      // clip-2 should remain completely unchanged
      const c2 = state.clips.find(c => c.id === 'clip-2')!;
      expect(c2).toBeDefined();
      expect(c2.startTime).toBe(20);
      expect(c2.duration).toBe(5);
    });

    it('clears transitionOut on first half and transitionIn on second half', () => {
      const clip = createMockClip({
        id: 'clip-1',
        trackId: 'video-1',
        startTime: 0,
        duration: 10,
        inPoint: 0,
        outPoint: 10,
        transitionIn: { type: 'fade', duration: 0.5 } as any,
        transitionOut: { type: 'fade', duration: 0.5 } as any,
      });
      store = createTestTimelineStore({ clips: [clip] } as any);

      store.getState().splitClip('clip-1', 5);
      const state = store.getState();
      const sorted = [...state.clips].sort((a, b) => a.startTime - b.startTime);

      // First half should keep transitionIn but lose transitionOut
      expect(sorted[0].transitionOut).toBeUndefined();
      // Second half should keep transitionOut but lose transitionIn
      expect(sorted[1].transitionIn).toBeUndefined();
    });
  });

  // ========== Additional splitClipAtPlayhead edge cases ==========

  describe('splitClipAtPlayhead (additional)', () => {
    it('splits all clips at playhead when none are selected', () => {
      const clip1 = createMockClip({
        id: 'clip-1', trackId: 'video-1', startTime: 0, duration: 10, inPoint: 0, outPoint: 10,
      });
      const clip2 = createMockClip({
        id: 'clip-2', trackId: 'audio-1', startTime: 0, duration: 10, inPoint: 0, outPoint: 10,
      });
      store = createTestTimelineStore({
        clips: [clip1, clip2],
        playheadPosition: 5,
        selectedClipIds: new Set(), // no selection
      } as any);

      store.getState().splitClipAtPlayhead();
      const state = store.getState();

      // Both clips should be split = 4 new clips total
      expect(state.clips.find(c => c.id === 'clip-1')).toBeUndefined();
      expect(state.clips.find(c => c.id === 'clip-2')).toBeUndefined();
      expect(state.clips.length).toBe(4);
    });

    it('does not split at exact clip start', () => {
      const clip = createMockClip({
        id: 'clip-1', trackId: 'video-1', startTime: 5, duration: 10, inPoint: 0, outPoint: 10,
      });
      store = createTestTimelineStore({
        clips: [clip],
        playheadPosition: 5, // exactly at clip start
      } as any);

      store.getState().splitClipAtPlayhead();
      // playhead is NOT strictly inside clip (condition is > startTime, not >=)
      expect(store.getState().clips.length).toBe(1);
    });

    it('does not split at exact clip end', () => {
      const clip = createMockClip({
        id: 'clip-1', trackId: 'video-1', startTime: 0, duration: 5, inPoint: 0, outPoint: 5,
      });
      store = createTestTimelineStore({
        clips: [clip],
        playheadPosition: 5, // exactly at clip end
      } as any);

      store.getState().splitClipAtPlayhead();
      // playhead is NOT strictly inside clip (condition is < startTime + duration, not <=)
      expect(store.getState().clips.length).toBe(1);
    });

    it('splits linked video+audio when only the video clip is selected', () => {
      const videoClip = createMockClip({
        id: 'clip-v', trackId: 'video-1', startTime: 0, duration: 10,
        inPoint: 0, outPoint: 10, linkedClipId: 'clip-a',
      });
      const audioClip = createMockClip({
        id: 'clip-a', trackId: 'audio-1', startTime: 0, duration: 10,
        inPoint: 0, outPoint: 10, linkedClipId: 'clip-v',
      });
      store = createTestTimelineStore({
        clips: [videoClip, audioClip],
        playheadPosition: 5,
        selectedClipIds: new Set(['clip-v']), // only video selected
      } as any);

      store.getState().splitClipAtPlayhead();
      const state = store.getState();

      // splitClip for clip-v also splits the linked clip-a
      expect(state.clips.find(c => c.id === 'clip-v')).toBeUndefined();
      expect(state.clips.find(c => c.id === 'clip-a')).toBeUndefined();
      expect(state.clips.length).toBe(4);

      const videoClips = state.clips.filter(c => c.trackId === 'video-1');
      const audioClips = state.clips.filter(c => c.trackId === 'audio-1');
      expect(videoClips.length).toBe(2);
      expect(audioClips.length).toBe(2);
    });

    it('falls back to all clips at playhead when selected clips are not at playhead', () => {
      const clip1 = createMockClip({
        id: 'clip-1', trackId: 'video-1', startTime: 0, duration: 10, inPoint: 0, outPoint: 10,
      });
      const clip2 = createMockClip({
        id: 'clip-2', trackId: 'video-1', startTime: 20, duration: 10, inPoint: 0, outPoint: 10,
      });
      store = createTestTimelineStore({
        clips: [clip1, clip2],
        playheadPosition: 5,
        selectedClipIds: new Set(['clip-2']), // clip-2 is NOT at playhead
      } as any);

      store.getState().splitClipAtPlayhead();
      const state = store.getState();

      // clip-2 is selected but not at playhead, so fallback to splitting clip-1
      expect(state.clips.find(c => c.id === 'clip-1')).toBeUndefined();
      expect(state.clips.find(c => c.id === 'clip-2')).toBeDefined();
    });
  });

  // ========== Additional moveClip edge cases ==========

  describe('moveClip (additional)', () => {
    it('does nothing when clip does not exist', () => {
      const clip = createMockClip({ id: 'clip-1', trackId: 'video-1', startTime: 0, duration: 5 });
      store = createTestTimelineStore({ clips: [clip], snappingEnabled: false } as any);

      store.getState().moveClip('nonexistent', 10);

      const c = store.getState().clips.find(c => c.id === 'clip-1')!;
      expect(c.startTime).toBe(0); // unchanged
    });

    it('preserves clip duration when moving', () => {
      const clip = createMockClip({ id: 'clip-1', trackId: 'video-1', startTime: 0, duration: 7 });
      store = createTestTimelineStore({ clips: [clip], snappingEnabled: false } as any);

      store.getState().moveClip('clip-1', 15);
      const moved = store.getState().clips.find(c => c.id === 'clip-1')!;

      expect(moved.startTime).toBe(15);
      expect(moved.duration).toBe(7); // unchanged
    });

    it('prevents moving audio clip to video track', () => {
      const clip = createMockClip({
        id: 'clip-1',
        trackId: 'audio-1',
        startTime: 0,
        duration: 5,
        source: { type: 'audio', naturalDuration: 5 } as any,
      });
      store = createTestTimelineStore({ clips: [clip], snappingEnabled: false } as any);

      store.getState().moveClip('clip-1', 0, 'video-1');
      const moved = store.getState().clips.find(c => c.id === 'clip-1')!;

      expect(moved.trackId).toBe('audio-1'); // should not change
    });

    it('moves linked group clips together when skipGroup is false', () => {
      const clip1 = createMockClip({
        id: 'clip-1', trackId: 'video-1', startTime: 0, duration: 5, linkedGroupId: 'group-1',
      });
      const clip2 = createMockClip({
        id: 'clip-2', trackId: 'video-1', startTime: 5, duration: 5, linkedGroupId: 'group-1',
      });
      store = createTestTimelineStore({
        clips: [clip1, clip2],
        snappingEnabled: false,
      } as any);

      store.getState().moveClip('clip-1', 10, undefined, false, false);
      const state = store.getState();

      // clip-1 should move to 10
      expect(state.clips.find(c => c.id === 'clip-1')!.startTime).toBe(10);
      // clip-2 should also move by the same delta (10 - 0 = +10 => 5 + 10 = 15)
      expect(state.clips.find(c => c.id === 'clip-2')!.startTime).toBe(15);
    });

    it('does not move group clips when skipGroup is true', () => {
      const clip1 = createMockClip({
        id: 'clip-1', trackId: 'video-1', startTime: 0, duration: 5, linkedGroupId: 'group-1',
      });
      const clip2 = createMockClip({
        id: 'clip-2', trackId: 'video-1', startTime: 5, duration: 5, linkedGroupId: 'group-1',
      });
      store = createTestTimelineStore({
        clips: [clip1, clip2],
        snappingEnabled: false,
      } as any);

      store.getState().moveClip('clip-1', 10, undefined, false, true); // skipGroup = true
      const state = store.getState();

      expect(state.clips.find(c => c.id === 'clip-1')!.startTime).toBe(10);
      expect(state.clips.find(c => c.id === 'clip-2')!.startTime).toBe(5); // unchanged
    });

    it('prevents moving image clip to audio track', () => {
      const clip = createMockClip({
        id: 'clip-1',
        trackId: 'video-1',
        startTime: 0,
        duration: 5,
        source: { type: 'image', naturalDuration: 5 } as any,
      });
      store = createTestTimelineStore({ clips: [clip], snappingEnabled: false } as any);

      store.getState().moveClip('clip-1', 0, 'audio-1');
      const moved = store.getState().clips.find(c => c.id === 'clip-1')!;

      expect(moved.trackId).toBe('video-1'); // should not change
    });
  });

  // ========== Additional updateClipTransform edge cases ==========

  describe('updateClipTransform (additional)', () => {
    it('deeply merges rotation updates', () => {
      const clip = createMockClip({ id: 'clip-1', trackId: 'video-1' });
      store = createTestTimelineStore({ clips: [clip] } as any);

      store.getState().updateClipTransform('clip-1', { rotation: { z: 90 } } as any);
      const updated = store.getState().clips.find(c => c.id === 'clip-1')!;

      expect(updated.transform.rotation.z).toBe(90);
      expect(updated.transform.rotation.x).toBe(0); // preserved
      expect(updated.transform.rotation.y).toBe(0); // preserved
    });

    it('updates blendMode while preserving other transform fields', () => {
      const clip = createMockClip({
        id: 'clip-1',
        trackId: 'video-1',
        transform: {
          opacity: 0.8,
          blendMode: 'normal',
          position: { x: 10, y: 20, z: 0 },
          scale: { x: 1.5, y: 1.5 },
          rotation: { x: 0, y: 0, z: 0 },
        },
      });
      store = createTestTimelineStore({ clips: [clip] } as any);

      store.getState().updateClipTransform('clip-1', { blendMode: 'multiply' } as any);
      const updated = store.getState().clips.find(c => c.id === 'clip-1')!;

      expect(updated.transform.blendMode).toBe('multiply');
      expect(updated.transform.opacity).toBe(0.8);
      expect(updated.transform.position.x).toBe(10);
      expect(updated.transform.scale.x).toBe(1.5);
    });

    it('handles multiple sequential transform updates', () => {
      const clip = createMockClip({ id: 'clip-1', trackId: 'video-1' });
      store = createTestTimelineStore({ clips: [clip] } as any);

      store.getState().updateClipTransform('clip-1', { opacity: 0.5 });
      store.getState().updateClipTransform('clip-1', { position: { x: 50 } } as any);
      store.getState().updateClipTransform('clip-1', { scale: { y: 3 } } as any);

      const updated = store.getState().clips.find(c => c.id === 'clip-1')!;

      expect(updated.transform.opacity).toBe(0.5);
      expect(updated.transform.position.x).toBe(50);
      expect(updated.transform.position.y).toBe(0);
      expect(updated.transform.scale.x).toBe(1);
      expect(updated.transform.scale.y).toBe(3);
    });

    it('does not affect other clips', () => {
      const clip1 = createMockClip({ id: 'clip-1', trackId: 'video-1' });
      const clip2 = createMockClip({ id: 'clip-2', trackId: 'video-1' });
      store = createTestTimelineStore({ clips: [clip1, clip2] } as any);

      store.getState().updateClipTransform('clip-1', { opacity: 0.3 });

      expect(store.getState().clips.find(c => c.id === 'clip-1')!.transform.opacity).toBe(0.3);
      expect(store.getState().clips.find(c => c.id === 'clip-2')!.transform.opacity).toBe(1); // unchanged
    });
  });

  // ========== Additional toggleClipReverse edge cases ==========

  describe('toggleClipReverse (additional)', () => {
    it('preserves undefined thumbnails when toggling reverse', () => {
      const clip = createMockClip({ id: 'clip-1', trackId: 'video-1' });
      // thumbnails should be undefined by default
      store = createTestTimelineStore({ clips: [clip] } as any);

      store.getState().toggleClipReverse('clip-1');
      const updated = store.getState().clips.find(c => c.id === 'clip-1')!;

      expect(updated.reversed).toBe(true);
      expect(updated.thumbnails).toBeUndefined();
    });

    it('double toggle returns to original state', () => {
      const clip = createMockClip({
        id: 'clip-1', trackId: 'video-1',
        thumbnails: ['a', 'b', 'c'],
      });
      store = createTestTimelineStore({ clips: [clip] } as any);

      store.getState().toggleClipReverse('clip-1');
      store.getState().toggleClipReverse('clip-1');

      const updated = store.getState().clips.find(c => c.id === 'clip-1')!;
      expect(updated.reversed).toBe(false);
      expect(updated.thumbnails).toEqual(['a', 'b', 'c']);
    });
  });

  // ========== Additional effect edge cases ==========

  describe('addClipEffect (additional)', () => {
    it('generates unique effect ids for each added effect', () => {
      const clip = createMockClip({ id: 'clip-1', trackId: 'video-1', effects: [] });
      store = createTestTimelineStore({ clips: [clip] } as any);

      store.getState().addClipEffect('clip-1', 'blur');
      store.getState().addClipEffect('clip-1', 'blur');

      const updated = store.getState().clips.find(c => c.id === 'clip-1')!;
      expect(updated.effects.length).toBe(2);
      expect(updated.effects[0].id).not.toBe(updated.effects[1].id);
    });

    it('appends to existing effects array', () => {
      const clip = createMockClip({
        id: 'clip-1',
        trackId: 'video-1',
        effects: [
          { id: 'fx-existing', name: 'invert', type: 'invert' as any, enabled: true, params: {} },
        ],
      });
      store = createTestTimelineStore({ clips: [clip] } as any);

      store.getState().addClipEffect('clip-1', 'blur');
      const updated = store.getState().clips.find(c => c.id === 'clip-1')!;

      expect(updated.effects.length).toBe(2);
      expect(updated.effects[0].id).toBe('fx-existing');
      expect(updated.effects[1].type).toBe('blur');
    });
  });

  describe('removeClipEffect (additional)', () => {
    it('does nothing when effect id does not match', () => {
      const clip = createMockClip({
        id: 'clip-1',
        trackId: 'video-1',
        effects: [
          { id: 'fx-1', name: 'blur', type: 'blur' as any, enabled: true, params: {} },
        ],
      });
      store = createTestTimelineStore({ clips: [clip] } as any);

      store.getState().removeClipEffect('clip-1', 'nonexistent-fx');
      const updated = store.getState().clips.find(c => c.id === 'clip-1')!;

      expect(updated.effects.length).toBe(1);
      expect(updated.effects[0].id).toBe('fx-1');
    });

    it('removes all effects when removing the last one', () => {
      const clip = createMockClip({
        id: 'clip-1',
        trackId: 'video-1',
        effects: [
          { id: 'fx-1', name: 'blur', type: 'blur' as any, enabled: true, params: {} },
        ],
      });
      store = createTestTimelineStore({ clips: [clip] } as any);

      store.getState().removeClipEffect('clip-1', 'fx-1');
      const updated = store.getState().clips.find(c => c.id === 'clip-1')!;

      expect(updated.effects.length).toBe(0);
    });
  });

  describe('updateClipEffect (additional)', () => {
    it('does not affect other effects on the same clip', () => {
      const clip = createMockClip({
        id: 'clip-1',
        trackId: 'video-1',
        effects: [
          { id: 'fx-1', name: 'blur', type: 'blur' as any, enabled: true, params: { radius: 5 } },
          { id: 'fx-2', name: 'hue-shift', type: 'hue-shift' as any, enabled: true, params: { amount: 180 } },
        ],
      });
      store = createTestTimelineStore({ clips: [clip] } as any);

      store.getState().updateClipEffect('clip-1', 'fx-1', { radius: 20 });
      const updated = store.getState().clips.find(c => c.id === 'clip-1')!;

      expect(updated.effects[0].params.radius).toBe(20);
      expect(updated.effects[1].params.amount).toBe(180); // unchanged
    });
  });

  describe('setClipEffectEnabled (additional)', () => {
    it('does not affect other effects on the same clip', () => {
      const clip = createMockClip({
        id: 'clip-1',
        trackId: 'video-1',
        effects: [
          { id: 'fx-1', name: 'blur', type: 'blur' as any, enabled: true, params: {} },
          { id: 'fx-2', name: 'invert', type: 'invert' as any, enabled: true, params: {} },
        ],
      });
      store = createTestTimelineStore({ clips: [clip] } as any);

      store.getState().setClipEffectEnabled('clip-1', 'fx-1', false);
      const updated = store.getState().clips.find(c => c.id === 'clip-1')!;

      expect(updated.effects[0].enabled).toBe(false);
      expect(updated.effects[1].enabled).toBe(true); // unchanged
    });
  });

  // ========== Additional linked group edge cases ==========

  describe('createLinkedGroup (additional)', () => {
    it('does nothing when clipIds array is empty', () => {
      const clip = createMockClip({ id: 'clip-1', trackId: 'video-1' });
      store = createTestTimelineStore({ clips: [clip] } as any);

      store.getState().createLinkedGroup([], new Map());
      expect(store.getState().clips.find(c => c.id === 'clip-1')!.linkedGroupId).toBeUndefined();
    });

    it('does nothing when no clips match the provided ids', () => {
      const clip = createMockClip({ id: 'clip-1', trackId: 'video-1' });
      store = createTestTimelineStore({ clips: [clip] } as any);

      const offsets = new Map<string, number>();
      offsets.set('nonexistent', 0);
      store.getState().createLinkedGroup(['nonexistent'], offsets);

      expect(store.getState().clips.find(c => c.id === 'clip-1')!.linkedGroupId).toBeUndefined();
    });

    it('adjusts startTime based on master clip offset', () => {
      const clip1 = createMockClip({ id: 'clip-1', trackId: 'video-1', startTime: 0, duration: 5 });
      const clip2 = createMockClip({ id: 'clip-2', trackId: 'video-1', startTime: 10, duration: 5 });
      store = createTestTimelineStore({ clips: [clip1, clip2] } as any);

      const offsets = new Map<string, number>();
      offsets.set('clip-1', 0); // master clip (offset 0)
      offsets.set('clip-2', 5000); // 5 seconds offset in ms

      store.getState().createLinkedGroup(['clip-1', 'clip-2'], offsets);
      const state = store.getState();

      // clip-1 has offset 0 => it's the master, its startTime is 0
      // clip-2 gets startTime = masterStartTime(0) - offset(5000)/1000 = 0 - 5 = -5, clamped to 0
      const c1 = state.clips.find(c => c.id === 'clip-1')!;
      const c2 = state.clips.find(c => c.id === 'clip-2')!;

      expect(c1.linkedGroupId).toBeDefined();
      expect(c1.startTime).toBe(0);
      expect(c2.startTime).toBe(0); // clamped to 0 (Math.max(0, ...))
    });
  });

  describe('unlinkGroup (additional)', () => {
    it('does not affect clips not in the group', () => {
      const clip1 = createMockClip({ id: 'clip-1', trackId: 'video-1', linkedGroupId: 'group-1' });
      const clip2 = createMockClip({ id: 'clip-2', trackId: 'video-1' }); // no group
      store = createTestTimelineStore({ clips: [clip1, clip2] } as any);

      store.getState().unlinkGroup('clip-1');
      const state = store.getState();

      expect(state.clips.find(c => c.id === 'clip-1')!.linkedGroupId).toBeUndefined();
      expect(state.clips.find(c => c.id === 'clip-2')!.linkedGroupId).toBeUndefined();
    });

    it('does nothing when clip does not exist', () => {
      const clip = createMockClip({ id: 'clip-1', trackId: 'video-1', linkedGroupId: 'group-1' });
      store = createTestTimelineStore({ clips: [clip] } as any);

      store.getState().unlinkGroup('nonexistent');
      // Nothing should change
      expect(store.getState().clips.find(c => c.id === 'clip-1')!.linkedGroupId).toBe('group-1');
    });
  });

  // ========== Additional setClipParent edge cases ==========

  describe('setClipParent (additional)', () => {
    it('prevents deeply nested circular references (A->B->C, then C->A)', () => {
      const clipA = createMockClip({ id: 'clip-a', trackId: 'video-1', parentClipId: 'clip-b' });
      const clipB = createMockClip({ id: 'clip-b', trackId: 'video-1', parentClipId: 'clip-c' });
      const clipC = createMockClip({ id: 'clip-c', trackId: 'video-1' });
      store = createTestTimelineStore({ clips: [clipA, clipB, clipC] } as any);

      // Try C -> A, which would create a cycle: C -> A -> B -> C
      store.getState().setClipParent('clip-c', 'clip-a');
      expect(store.getState().clips.find(c => c.id === 'clip-c')!.parentClipId).toBeUndefined();
    });

    it('allows setting parent when no cycle exists', () => {
      const clipA = createMockClip({ id: 'clip-a', trackId: 'video-1' });
      const clipB = createMockClip({ id: 'clip-b', trackId: 'video-1' });
      const clipC = createMockClip({ id: 'clip-c', trackId: 'video-1' });
      store = createTestTimelineStore({ clips: [clipA, clipB, clipC] } as any);

      store.getState().setClipParent('clip-b', 'clip-a');
      store.getState().setClipParent('clip-c', 'clip-b');

      expect(store.getState().clips.find(c => c.id === 'clip-b')!.parentClipId).toBe('clip-a');
      expect(store.getState().clips.find(c => c.id === 'clip-c')!.parentClipId).toBe('clip-b');
    });

    it('can reassign parent to a different clip', () => {
      const clipA = createMockClip({ id: 'clip-a', trackId: 'video-1' });
      const clipB = createMockClip({ id: 'clip-b', trackId: 'video-1' });
      const child = createMockClip({ id: 'clip-child', trackId: 'video-1', parentClipId: 'clip-a' });
      store = createTestTimelineStore({ clips: [clipA, clipB, child] } as any);

      store.getState().setClipParent('clip-child', 'clip-b');
      expect(store.getState().clips.find(c => c.id === 'clip-child')!.parentClipId).toBe('clip-b');
    });
  });

  // ========== Additional setClipPreservesPitch edge cases ==========

  describe('setClipPreservesPitch (additional)', () => {
    it('does not affect other clips', () => {
      const clip1 = createMockClip({ id: 'clip-1', trackId: 'video-1' });
      const clip2 = createMockClip({ id: 'clip-2', trackId: 'video-1' });
      store = createTestTimelineStore({ clips: [clip1, clip2] } as any);

      store.getState().setClipPreservesPitch('clip-1', true);

      expect(store.getState().clips.find(c => c.id === 'clip-1')!.preservesPitch).toBe(true);
      expect(store.getState().clips.find(c => c.id === 'clip-2')!.preservesPitch).toBeUndefined();
    });
  });

  // ========== addPendingDownloadClip ==========

  describe('addPendingDownloadClip', () => {
    it('creates a pending download clip on a video track', () => {
      store = createTestTimelineStore({ clips: [] } as any);

      const clipId = store.getState().addPendingDownloadClip('video-1', 0, 'yt-123', 'Test Video', 'http://example.com/thumb.jpg', 30);

      expect(clipId).toBeTruthy();
      const state = store.getState();
      const clip = state.clips.find(c => c.id === clipId)!;

      expect(clip).toBeDefined();
      expect(clip.name).toBe('Test Video');
      expect(clip.isPendingDownload).toBe(true);
      expect(clip.downloadProgress).toBe(0);
      expect(clip.youtubeVideoId).toBe('yt-123');
      expect(clip.youtubeThumbnail).toBe('http://example.com/thumb.jpg');
      expect(clip.duration).toBe(30);
      expect(clip.trackId).toBe('video-1');
      expect(clip.source).toBeNull();
      expect(clip.isLoading).toBe(false);
    });

    it('returns empty string when track does not exist', () => {
      store = createTestTimelineStore({ clips: [] } as any);

      const clipId = store.getState().addPendingDownloadClip('nonexistent', 0, 'yt-123', 'Test', 'thumb.jpg');
      expect(clipId).toBe('');
    });

    it('returns empty string when track is audio type', () => {
      store = createTestTimelineStore({ clips: [] } as any);

      const clipId = store.getState().addPendingDownloadClip('audio-1', 0, 'yt-123', 'Test', 'thumb.jpg');
      expect(clipId).toBe('');
    });

    it('uses default estimated duration of 30 when not provided', () => {
      store = createTestTimelineStore({ clips: [] } as any);

      const clipId = store.getState().addPendingDownloadClip('video-1', 0, 'yt-123', 'Test', 'thumb.jpg');

      const clip = store.getState().clips.find(c => c.id === clipId)!;
      expect(clip.duration).toBe(30);
    });
  });
});
