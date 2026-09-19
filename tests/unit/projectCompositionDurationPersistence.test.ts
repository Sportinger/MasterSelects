import { describe, expect, it } from 'vitest';

import { convertProjectCompositionToStore } from '../../src/services/project/load/loadTimelineHydration';
import type { ProjectComposition } from '../../src/services/project/projectFileService';
import type { ProjectClip } from '../../src/services/project/types';

function projectClip(duration: number): ProjectClip {
  return {
    id: 'clip-1',
    trackId: 'video-1',
    name: 'Long video',
    mediaId: 'media-1',
    sourceType: 'video',
    naturalDuration: duration,
    startTime: 0,
    duration,
    inPoint: 0,
    outPoint: duration,
    transform: {
      x: 0,
      y: 0,
      z: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      rotationX: 0,
      rotationY: 0,
      anchorX: 0.5,
      anchorY: 0.5,
      opacity: 1,
      blendMode: 'normal',
    },
    effects: [],
    masks: [],
    keyframes: [],
    volume: 1,
    audioEnabled: true,
    reversed: false,
    disabled: false,
  };
}

function projectComposition(
  duration: number,
  clipDuration: number,
  durationLocked?: boolean,
): ProjectComposition {
  return {
    id: 'comp-1',
    name: 'Long video Comp',
    width: 1920,
    height: 1080,
    frameRate: 25,
    duration,
    durationLocked,
    backgroundColor: '#000000',
    folderId: null,
    tracks: [{
      id: 'video-1',
      name: 'Video 1',
      type: 'video',
      height: 60,
      locked: false,
      visible: true,
      muted: false,
      solo: false,
    }],
    clips: [projectClip(clipDuration)],
    markers: [],
  };
}

describe('project composition duration persistence', () => {
  it('restores an explicitly locked video-length composition on its frame grid', () => {
    const [composition] = convertProjectCompositionToStore([
      projectComposition(4321.23356, 4321.23356, true),
    ]);

    expect(composition.duration).toBe(4321.24);
    expect(composition.timelineData?.duration).toBe(4321.24);
    expect(composition.timelineData?.clips[0].duration).toBe(4321.2);
    expect(composition.timelineData?.durationLocked).toBe(true);
  });

  it('repairs legacy 60-second compositions whose clips are longer', () => {
    const [composition] = convertProjectCompositionToStore([
      projectComposition(60, 4321.23356),
    ]);

    expect(composition.duration).toBe(4321.2);
    expect(composition.timelineData?.duration).toBe(4321.2);
    expect(composition.timelineData?.durationLocked).toBe(true);
  });

  it('keeps legacy auto-duration compositions unlocked', () => {
    const [composition] = convertProjectCompositionToStore([
      projectComposition(130, 120),
    ]);

    expect(composition.duration).toBe(130);
    expect(composition.timelineData?.durationLocked).toBe(false);
  });

  it('uses the referenced composition duration before quantizing legacy split video and audio wrappers', () => {
    const splitTime = 0.8727257702515707;
    const child = { ...projectComposition(540, 300, true), id: 'nested-source', frameRate: 60 };
    const parent = {
      ...projectComposition(550, 540, false),
      frameRate: 30,
      clips: (['video', 'audio'] as const).map(sourceType => ({
        ...projectClip(540 - splitTime),
        id: `split-${sourceType}`,
        sourceType,
        naturalDuration: sourceType === 'video' ? 540 - splitTime : 300,
        linkedClipId: sourceType === 'video' ? 'split-audio' : 'split-video',
        startTime: splitTime,
        inPoint: splitTime,
        outPoint: 540,
        isComposition: true,
        compositionId: child.id,
      })),
    };

    const [restored] = convertProjectCompositionToStore([parent, child]);
    const clips = restored.timelineData!.clips;
    expect(clips).toHaveLength(2);
    for (const clip of clips) {
      expect(clip.naturalDuration).toBe(540);
      expect(clip.startTime).toBe(26 / 30);
      // Keep the authored source in-point; 16173 full frames remain before 540s.
      expect(clip.duration).toBe(16173 / 30);
      expect(clip.inPoint).toBe(splitTime);
      expect(clip.outPoint).toBe(splitTime + 16173 / 30);
    }
    expect(restored.duration).toBe(550);
    expect(restored.timelineData?.durationLocked).toBe(false);
    expect(parent.clips.map(clip => clip.naturalDuration)).toEqual([540 - splitTime, 300]);
  });
});
