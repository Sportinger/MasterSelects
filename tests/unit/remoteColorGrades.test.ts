import { describe, expect, it, vi } from 'vitest';

import { createRemoteColorGradeMediaPatch } from '../../src/services/colorGrades/remoteColorGradeMediaState';
import { initializeRemoteColorGradeCoordinator } from '../../src/services/colorGrades/remoteColorGradeCoordinator';
import { convertMediaFiles } from '../../src/services/project/projectMediaSerialization';
import type { Composition, MediaFile, MediaState } from '../../src/stores/mediaStore/types';
import { applyCommonRestoredClipFields } from '../../src/stores/timeline/serialization/loadStateCommonClipRestore';
import { createRestoredMediaClip } from '../../src/stores/timeline/serialization/loadStateMediaClipData';
import { createSerializableTimelineState } from '../../src/stores/timeline/serialization/serializableTimelineState';
import {
  applyRemoteColorGrade,
  extractRemoteColorGrade,
  synchronizeRemoteGradeClips,
  updateClipColorCorrectionWithRemoteSync,
  type RemoteColorGradeClipLike,
} from '../../src/types/colorGradeOwnership';
import {
  createDefaultColorCorrectionState,
  getActiveColorVersion,
  setColorNodeParamValue,
  type ColorCorrectionState,
} from '../../src/types/colorCorrection';
import type { TimelineClip } from '../../src/types/timeline';

function correction(exposure: number, viewportX = 0): ColorCorrectionState {
  const initial = createDefaultColorCorrectionState();
  const version = getActiveColorVersion(initial)!;
  const primary = version.nodes.find(node => node.type === 'primary')!;
  const updated = setColorNodeParamValue(initial, version.id, primary.id, 'exposure', exposure);
  return {
    ...updated,
    ui: {
      ...updated.ui,
      workspaceViewport: { x: viewportX, y: 0, zoom: 1 },
    },
  };
}

function exposure(state: ColorCorrectionState | undefined): number {
  const version = getActiveColorVersion(state!);
  return version?.nodes.find(node => node.type === 'primary')?.params.exposure as number;
}

function timelineClip(
  id: string,
  state: ColorCorrectionState,
  mode: 'local' | 'remote' = 'remote',
): TimelineClip {
  return {
    id,
    mediaFileId: 'media-1',
    colorGradeMode: mode,
    colorCorrection: state,
  } as TimelineClip;
}

describe('remote color grade ownership', () => {
  it('applies source grade data while preserving clip-local editor UI', () => {
    const local = correction(0.5, 17);
    const source = extractRemoteColorGrade(correction(2, 99));

    const applied = applyRemoteColorGrade(local, source);

    expect(exposure(applied)).toBe(2);
    expect(applied.ui.workspaceViewport?.x).toBe(17);
  });

  it('synchronizes only remote occurrences of the same media source', () => {
    const clips: RemoteColorGradeClipLike[] = [
      { mediaFileId: 'media-1', colorGradeMode: 'remote', colorCorrection: correction(0) },
      { mediaFileId: 'media-1', colorGradeMode: 'local', colorCorrection: correction(0) },
      { mediaFileId: 'media-2', colorGradeMode: 'remote', colorCorrection: correction(0) },
    ];

    const synchronized = synchronizeRemoteGradeClips(
      clips,
      'media-1',
      extractRemoteColorGrade(correction(3)),
    );

    expect(exposure(synchronized[0].colorCorrection)).toBe(3);
    expect(exposure(synchronized[1].colorCorrection)).toBe(0);
    expect(exposure(synchronized[2].colorCorrection)).toBe(0);
  });

  it('synchronizes a direct color editor update without relying on store initialization', () => {
    const clips = [
      timelineClip('clip-a', correction(0, 10)),
      timelineClip('clip-b', correction(0, 20)),
    ];

    const updated = updateClipColorCorrectionWithRemoteSync(
      clips,
      'clip-b',
      () => correction(3, 20),
    );

    expect(exposure(updated[0].colorCorrection)).toBe(3);
    expect(exposure(updated[1].colorCorrection)).toBe(3);
    expect(updated[0].colorCorrection?.ui.workspaceViewport?.x).toBe(10);
    expect(updated[1].colorCorrection?.ui.workspaceViewport?.x).toBe(20);
  });

  it('updates the media owner and inactive remote composition clips together', () => {
    const sourceGrade = extractRemoteColorGrade(correction(4));
    const remoteClip = timelineClip('remote', correction(0));
    const localClip = timelineClip('local', correction(0), 'local');
    const composition = {
      id: 'composition-1',
      timelineData: {
        tracks: [],
        clips: [remoteClip, localClip],
        playheadPosition: 0,
        duration: 10,
        zoom: 1,
        scrollX: 0,
        inPoint: null,
        outPoint: null,
        loopPlayback: false,
      },
    } as unknown as Composition;
    const state = {
      files: [{ id: 'media-1' } as MediaFile],
      compositions: [composition],
    } as Pick<MediaState, 'files' | 'compositions'>;

    const patch = createRemoteColorGradeMediaPatch(state, 'media-1', sourceGrade)!;

    expect(patch.files[0].remoteColorGrade).toEqual(sourceGrade);
    expect(exposure(patch.compositions[0].timelineData?.clips[0].colorCorrection)).toBe(4);
    expect(exposure(patch.compositions[0].timelineData?.clips[1].colorCorrection)).toBe(0);
  });

  it('serializes source ownership and the preserved local grade', () => {
    const remoteGrade = extractRemoteColorGrade(correction(4));
    const localGrade = correction(1);
    const [serializedMedia] = convertMediaFiles([{
      id: 'media-1',
      name: 'source.mp4',
      type: 'video',
      parentId: null,
      createdAt: 1,
      url: 'blob:source',
      remoteColorGrade: remoteGrade,
    } as MediaFile]);
    const serializedTimeline = createSerializableTimelineState({
      tracks: [],
      clips: [{
        ...timelineClip('clip-a', applyRemoteColorGrade(localGrade, remoteGrade)),
        colorGradeMode: 'remote',
        localColorCorrection: localGrade,
      }],
      playheadPosition: 0,
      duration: 4,
      durationLocked: false,
      zoom: 10,
      scrollX: 0,
      inPoint: null,
      outPoint: null,
      loopPlayback: false,
      clipKeyframes: new Map(),
      markers: [],
      tempoMap: undefined,
      rulerLanes: [],
      activeRulerLaneId: null,
      videoBakeRegions: [],
      masterAudioState: undefined,
    } as unknown as Parameters<typeof createSerializableTimelineState>[0]);

    expect(serializedMedia.remoteColorGrade).toEqual(remoteGrade);
    expect(serializedMedia.remoteColorGrade).not.toBe(remoteGrade);
    expect(serializedTimeline.clips[0].colorGradeMode).toBe('remote');
    expect(exposure(serializedTimeline.clips[0].localColorCorrection)).toBe(1);
  });

  it('restores ownership fields when durable clips become runtime clips', () => {
    const localGrade = correction(1);
    const serializedClip = {
      ...timelineClip('clip-a', correction(4)),
      trackId: 'video-1',
      name: 'source.mp4',
      sourceType: 'video' as const,
      startTime: 0,
      duration: 4,
      inPoint: 0,
      outPoint: 4,
      transform: {},
      effects: [],
      masks: [],
      colorGradeMode: 'remote' as const,
      localColorCorrection: localGrade,
    };
    const mediaFile = {
      id: 'media-1',
      name: 'source.mp4',
      type: 'video',
    } as MediaFile;

    const commonFields = applyCommonRestoredClipFields(serializedClip);
    const runtimeClip = createRestoredMediaClip({
      file: new File([], 'source.mp4'),
      initialSource: {
        type: 'video',
        mediaFileId: 'media-1',
        naturalDuration: 4,
      },
      mediaFile,
      needsReload: false,
      serializedClip,
    });

    expect(commonFields.colorGradeMode).toBe('remote');
    expect(exposure(commonFields.localColorCorrection)).toBe(1);
    expect(runtimeClip.colorGradeMode).toBe('remote');
    expect(exposure(runtimeClip.localColorCorrection)).toBe(1);
    expect(runtimeClip.localColorCorrection).not.toBe(localGrade);
  });

  it('hydrates loaded remote clips and propagates later editor changes', () => {
    let clips = [
      timelineClip('clip-a', correction(0, 10)),
      timelineClip('clip-b', correction(0, 20)),
    ];
    let ownedGrade = extractRemoteColorGrade(correction(2));
    let listener: ((next: TimelineClip[], previous: TimelineClip[]) => void) | undefined;
    const commitGrade = vi.fn((_mediaFileId: string, grade: typeof ownedGrade) => {
      ownedGrade = grade;
    });

    initializeRemoteColorGradeCoordinator({
      getClips: () => clips,
      setClips: next => { clips = next; },
      subscribeClips: nextListener => {
        listener = nextListener;
        return () => { listener = undefined; };
      },
      invalidateCache: vi.fn(),
    }, {
      getGrade: () => ownedGrade,
      commitGrade,
    });

    expect(exposure(clips[0].colorCorrection)).toBe(2);
    expect(exposure(clips[1].colorCorrection)).toBe(2);
    expect(clips[0].colorCorrection?.ui.workspaceViewport?.x).toBe(10);

    const previous = clips;
    clips = [
      { ...clips[0], colorCorrection: correction(5, 10) },
      clips[1],
    ];
    listener?.(clips, previous);

    expect(commitGrade).toHaveBeenCalledWith('media-1', expect.any(Object));
    expect(exposure(clips[1].colorCorrection)).toBe(5);
    expect(clips[1].colorCorrection?.ui.workspaceViewport?.x).toBe(20);
  });
});
