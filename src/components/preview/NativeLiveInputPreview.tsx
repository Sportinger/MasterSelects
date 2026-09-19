import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { useMediaStore, type MediaFile } from '../../stores/mediaStore';
import { DEFAULT_TRANSFORM } from '../../stores/timeline/constants';
import { useTimelineStore } from '../../stores/timeline';
import type { TimelineClip, TimelineTrack } from '../../types/timeline';
import { isMobileAppleWebKit } from '../../utils/mobileAppleWebKit';
import { LiveInputPreviewCanvas } from '../panels/media/LiveInputPreviewCanvas';

interface NativeLiveInputPreviewProps {
  canvasSize: { width: number; height: number };
  clips: TimelineClip[];
  enabled: boolean;
  tracks: TimelineTrack[];
}

interface ResolveNativeLiveInputPreviewIdInput {
  clipKeyframes: ReadonlyMap<string, readonly unknown[]>;
  clips: readonly TimelineClip[];
  mediaFiles: readonly MediaFile[];
  playheadPosition: number;
  tracks: readonly TimelineTrack[];
}

function hasDefaultTransform(clip: TimelineClip): boolean {
  const { transform } = clip;
  return transform.opacity === DEFAULT_TRANSFORM.opacity
    && transform.blendMode === DEFAULT_TRANSFORM.blendMode
    && transform.position.x === DEFAULT_TRANSFORM.position.x
    && transform.position.y === DEFAULT_TRANSFORM.position.y
    && transform.position.z === DEFAULT_TRANSFORM.position.z
    && transform.scale.x === DEFAULT_TRANSFORM.scale.x
    && transform.scale.y === DEFAULT_TRANSFORM.scale.y
    && transform.rotation.x === DEFAULT_TRANSFORM.rotation.x
    && transform.rotation.y === DEFAULT_TRANSFORM.rotation.y
    && transform.rotation.z === DEFAULT_TRANSFORM.rotation.z;
}

function isUnmodifiedLiveInputClip(
  clip: TimelineClip,
  clipKeyframes: ReadonlyMap<string, readonly unknown[]>,
): boolean {
  return Boolean(clip.source?.liveInputId)
    && clip.source?.type === 'video'
    && hasDefaultTransform(clip)
    && (clip.effects?.length ?? 0) === 0
    && (clip.masks?.length ?? 0) === 0
    && (clipKeyframes.get(clip.id)?.length ?? 0) === 0
    && !clip.sourceRect
    && !clip.transitionIn
    && !clip.transitionOut
    && !clip.transitionRender
    && !clip.colorCorrection
    && !clip.localColorCorrection
    && !clip.nodeGraph
    && !clip.parentClipId
    && !clip.is3D
    && !clip.isComposition
    && !clip.reversed
    && (clip.speed === undefined || clip.speed === 1);
}

export function resolveNativeLiveInputPreviewId({
  clipKeyframes,
  clips,
  mediaFiles,
  playheadPosition,
  tracks,
}: ResolveNativeLiveInputPreviewIdInput): string | null {
  const videoTracks = tracks.filter((track) => track.type === 'video' && track.visible !== false);
  const hasSoloTrack = videoTracks.some((track) => track.solo);
  const visibleTrackIds = new Set(
    videoTracks
      .filter((track) => !hasSoloTrack || track.solo)
      .map((track) => track.id),
  );
  const activeClips = clips.filter((clip) => (
    visibleTrackIds.has(clip.trackId)
    && playheadPosition + 1e-6 >= clip.startTime
    && playheadPosition < clip.startTime + clip.duration
    && clip.source?.type !== 'camera'
    && clip.source?.type !== 'motion-null'
    && clip.source?.type !== 'splat-effector'
  ));
  if (activeClips.length !== 1) return null;

  const clip = activeClips[0];
  if (!isUnmodifiedLiveInputClip(clip, clipKeyframes)) return null;
  const liveInputId = clip.source?.liveInputId;
  const mediaFile = mediaFiles.find((file) => file.id === liveInputId);
  if (
    !liveInputId
    || (mediaFile?.liveInput?.kind !== 'video-device' && mediaFile?.liveInput?.kind !== 'display')
  ) return null;
  return liveInputId;
}

/**
 * Safari can present a plain capture stream more reliably in a native video
 * element than through repeated video-to-canvas-to-WebGPU copies. The WebGPU
 * preview remains mounted underneath and is used whenever compositing matters.
 */
export function NativeLiveInputPreview({
  canvasSize,
  clips,
  enabled,
  tracks,
}: NativeLiveInputPreviewProps) {
  const { clipKeyframes, playheadPosition } = useTimelineStore(useShallow((state) => ({
    clipKeyframes: state.clipKeyframes,
    playheadPosition: state.playheadPosition,
  })));
  const mediaFiles = useMediaStore((state) => state.files);
  const liveInputId = useMemo(() => enabled && !isMobileAppleWebKit()
    ? resolveNativeLiveInputPreviewId({
        clipKeyframes,
        clips,
        mediaFiles,
        playheadPosition,
        tracks,
      })
    : null, [clipKeyframes, clips, enabled, mediaFiles, playheadPosition, tracks]);

  if (!liveInputId) return null;
  return (
    <div
      className="preview-native-live-input-frame"
      data-live-input-preview-id={liveInputId}
      style={{ width: canvasSize.width, height: canvasSize.height }}
    >
      <LiveInputPreviewCanvas
        className="preview-native-live-input-video"
        liveInputId={liveInputId}
        presentationRole="composition-preview"
      />
    </div>
  );
}
