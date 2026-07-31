import type { MediaFile } from '../../../stores/mediaStore/types';
import type { TimelineClip, TimelineTrack } from '../../../types/timeline';
import { isStoryboardTimelineClip } from '../core/sceneCardOperations';
import { clampAnimaticProgress, resolveStillImageScale } from './stillTiming';
import type {
  StoryboardAnimaticFramePayload,
  StoryboardAnimaticResolveInput,
} from './types';

const DEFAULT_ACCENT = '#8b5cf6';

function isTrackVisible(trackId: string, tracks: readonly TimelineTrack[]): boolean {
  const track = tracks.find(candidate => candidate.id === trackId);
  return track?.visible !== false;
}

function activeSceneAtTime(input: StoryboardAnimaticResolveInput): TimelineClip | null {
  return input.clips
    .filter(isStoryboardTimelineClip)
    .filter(clip => isTrackVisible(clip.trackId, input.tracks))
    .filter(clip => input.time >= clip.startTime && input.time < clip.startTime + clip.duration)
    .toSorted((left, right) =>
      right.startTime - left.startTime ||
      left.trackId.localeCompare(right.trackId) ||
      left.id.localeCompare(right.id)
    )[0] ?? null;
}

function resolveFilledClip(
  scene: TimelineClip,
  clips: readonly TimelineClip[],
): TimelineClip | null {
  const ids = scene.storyboardProperties?.filledClipIds ?? [];
  const candidates = ids
    .map(id => clips.find(clip => clip.id === id))
    .filter((candidate): candidate is TimelineClip =>
      !!candidate &&
      !!candidate.source &&
      !['audio', 'midi', 'storyboard'].includes(candidate.source.type)
    );
  return candidates.find(candidate => candidate.source?.type !== 'image')
    ?? candidates.find(candidate => candidate.source?.type === 'image')
    ?? null;
}

function resolveMediaFile(
  clip: TimelineClip,
  files: readonly MediaFile[],
): MediaFile | null {
  const id = clip.source?.mediaFileId ?? clip.mediaFileId;
  return id ? files.find(file => file.id === id) ?? null : null;
}

function resolveImageUrl(clip: TimelineClip, mediaFile: MediaFile | null): string | null {
  const url = clip.source?.imageUrl || mediaFile?.url || mediaFile?.thumbnailUrl;
  return typeof url === 'string' && url.length > 0 ? url : null;
}

export function resolveStoryboardAnimaticFramePayload(
  input: StoryboardAnimaticResolveInput,
): StoryboardAnimaticFramePayload | null {
  const scene = activeSceneAtTime(input);
  const properties = scene?.storyboardProperties;
  if (!scene || !properties) return null;

  const durationSeconds = Math.max(0.001, scene.duration);
  const localTime = Math.min(durationSeconds, Math.max(0, input.time - scene.startTime));
  const progress = clampAnimaticProgress(localTime, durationSeconds);
  const filledClip = resolveFilledClip(scene, input.clips);
  const common = {
    schemaVersion: 1 as const,
    mode: input.mode,
    sceneId: properties.sceneId,
    sceneClipId: scene.id,
    startTime: scene.startTime,
    endTime: scene.startTime + scene.duration,
    localTime,
    durationSeconds,
    progress,
    width: Math.max(1, Math.round(input.width)),
    height: Math.max(1, Math.round(input.height)),
    ...(input.watermark ? { watermark: input.watermark } : {}),
  };

  if (filledClip) {
    if (filledClip.source?.type === 'image') {
      const mediaFile = resolveMediaFile(filledClip, input.mediaFiles);
      const imageUrl = resolveImageUrl(filledClip, mediaFile);
      if (imageUrl) {
        const cameraMove = input.cameraMove ?? 'push-in';
        return {
          ...common,
          kind: 'still-image',
          still: {
            clipId: filledClip.id,
            mediaFileId: mediaFile?.id ?? filledClip.source.mediaFileId ?? filledClip.mediaFileId ?? null,
            imageUrl,
            cameraMove,
            scale: resolveStillImageScale(progress, cameraMove),
          },
        };
      }
    }
    return { ...common, kind: 'real-media' };
  }

  // Normal exports are deliberately incapable of resolving a slate. The UI
  // guard reports the missing scenes before an export starts.
  if (input.mode === 'normal-export') return null;

  return {
    ...common,
    kind: 'slate',
    slate: {
      title: properties.title,
      description: properties.description,
      status: properties.status,
      targetDurationSeconds: properties.targetDurationSeconds,
      accentColor: properties.color || DEFAULT_ACCENT,
    },
  };
}
