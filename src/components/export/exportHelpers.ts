// Export helper functions - seek and layer building for frame-accurate export

import { Logger } from '../../services/logger';
import { useTimelineStore } from '../../stores/timeline';
import type { Layer, LayerSource, TimelineClip, TimelineTrack } from '../../types';

const log = Logger.create('ExportHelpers');

// Helper: Seek all video clips to exact time for frame-accurate export
export async function seekAllClipsToTime(time: number): Promise<void> {
  const { clips, tracks, getSourceTimeForClip, getInterpolatedSpeed } = useTimelineStore.getState();
  const seekPromises: Promise<void>[] = [];

  // Get clips at this time
  const clipsAtTime = clips.filter(
    c => time >= c.startTime && time < c.startTime + c.duration
  );

  log.debug(`seekAllClipsToTime: time=${time.toFixed(3)}, total clips=${clips.length}, clips at time=${clipsAtTime.length}`);

  for (const clip of clipsAtTime) {
    const track = tracks.find(t => t.id === clip.trackId);
    if (!track?.visible) continue;

    // Handle nested composition clips
    if (clip.isComposition && clip.nestedClips) {
      const clipLocalTime = time - clip.startTime;
      const nestedTime = clipLocalTime + (clip.inPoint || 0);

      for (const nestedClip of clip.nestedClips) {
        if (nestedTime >= nestedClip.startTime && nestedTime < nestedClip.startTime + nestedClip.duration) {
          if (nestedClip.source?.videoElement) {
            const nestedLocalTime = nestedTime - nestedClip.startTime;
            const nestedClipTime = nestedClip.reversed
              ? nestedClip.outPoint - nestedLocalTime
              : nestedLocalTime + nestedClip.inPoint;

            // Always seek the HTMLVideoElement since that's what we use for texture rendering
            seekPromises.push(seekVideo(nestedClip.source.videoElement, nestedClipTime));
          }
        }
      }
      continue;
    }

    // Handle regular video clips
    if (clip.source?.type === 'video' && clip.source.videoElement) {
      const clipLocalTime = time - clip.startTime;
      let clipTime: number;

      try {
        const sourceTime = getSourceTimeForClip(clip.id, clipLocalTime);
        const initialSpeed = getInterpolatedSpeed(clip.id, 0);
        const startPoint = initialSpeed >= 0 ? clip.inPoint : clip.outPoint;
        clipTime = Math.max(clip.inPoint, Math.min(clip.outPoint, startPoint + sourceTime));
      } catch {
        clipTime = clip.reversed
          ? clip.outPoint - clipLocalTime
          : clipLocalTime + clip.inPoint;
        clipTime = Math.max(clip.inPoint, Math.min(clip.outPoint, clipTime));
      }

      // Always seek the HTMLVideoElement since that's what we use for texture rendering
      seekPromises.push(seekVideo(clip.source.videoElement, clipTime));
    }
  }

  log.debug(`seekAllClipsToTime: Waiting for ${seekPromises.length} seek promises...`);
  await Promise.all(seekPromises);
  log.debug('seekAllClipsToTime: All seeks complete');
}

// Helper: Seek HTMLVideoElement to exact time
function seekVideo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    const targetTime = Math.max(0, Math.min(time, video.duration || 0));

    // If already at target time, just wait for frame
    if (Math.abs(video.currentTime - targetTime) < 0.01 && !video.seeking && video.readyState >= 3) {
      requestAnimationFrame(() => resolve());
      return;
    }

    // Set timeout in case seek never completes
    const timeout = setTimeout(() => {
      video.removeEventListener('seeked', onSeeked);
      resolve();
    }, 500);

    const onSeeked = () => {
      clearTimeout(timeout);
      video.removeEventListener('seeked', onSeeked);
      // Wait one frame for the video texture to update
      requestAnimationFrame(() => resolve());
    };

    video.addEventListener('seeked', onSeeked);
    video.currentTime = targetTime;
  });
}

// Helper: Build render layers at specific time
export function buildLayersAtTime(time: number): Layer[] {
  const { clips, tracks, getInterpolatedTransform, getInterpolatedEffects } = useTimelineStore.getState();
  const layers: Layer[] = [];

  const videoTracks = tracks.filter(t => t.type === 'video');
  const anyVideoSolo = videoTracks.some(t => t.solo);

  const isTrackVisible = (track: TimelineTrack) => {
    if (!track.visible) return false;
    if (anyVideoSolo) return track.solo;
    return true;
  };

  const clipsAtTime = clips.filter(
    c => time >= c.startTime && time < c.startTime + c.duration
  );

  // Sort by track order - lower index tracks should be first in array (render on top)
  // WebGPU renders layers[0] on top, layers[end] on bottom
  const sortedTracks = [...videoTracks].sort((a, b) => {
    const aIndex = tracks.indexOf(a);
    const bIndex = tracks.indexOf(b);
    return aIndex - bIndex; // Lower index (top track) first = renders on top
  });

  for (const track of sortedTracks) {
    if (!isTrackVisible(track)) continue;

    const trackClips = clipsAtTime.filter(c => c.trackId === track.id);

    for (const clip of trackClips) {
      const layer = buildLayerFromClip(clip, time, getInterpolatedTransform, getInterpolatedEffects);
      if (layer) {
        layers.push(layer);
      }
    }
  }

  return layers;
}

// Helper: Build a single layer from a clip
function buildLayerFromClip(
  clip: TimelineClip,
  time: number,
  getInterpolatedTransform: (clipId: string, localTime: number) => any,
  getInterpolatedEffects: (clipId: string, localTime: number) => any
): Layer | null {
  const clipLocalTime = time - clip.startTime;
  const transform = getInterpolatedTransform(clip.id, clipLocalTime);
  const effects = getInterpolatedEffects(clip.id, clipLocalTime);

  // Handle nested compositions
  if (clip.isComposition && clip.nestedClips && clip.nestedTracks) {
    // For nested compositions, we need to get the rendered frame from nested clips
    // This is simplified - full implementation would recurse
    return null;
  }

  // Handle video/image clips
  if (clip.source?.videoElement || clip.source?.imageElement) {
    // For export, we need to use HTMLVideoElement (not WebCodecsPlayer)
    // because we control seeking via video.currentTime
    // WebCodecsPlayer has its own playback and doesn't follow currentTime
    const exportSource: LayerSource = {
      type: clip.source.videoElement ? 'video' : 'image',
      videoElement: clip.source.videoElement,
      imageElement: clip.source.imageElement,
      // webCodecsPlayer explicitly omitted - force HTMLVideoElement path during export
    };

    return {
      id: clip.id,
      name: clip.name || clip.id,
      source: exportSource,
      visible: true,
      opacity: transform.opacity ?? 1,
      blendMode: transform.blendMode ?? 'normal',
      // Compositor expects position/scale/rotation in this format
      position: {
        x: transform.x ?? 0,
        y: transform.y ?? 0,
        z: 0,
      },
      scale: {
        x: transform.scaleX ?? 1,
        y: transform.scaleY ?? 1,
      },
      rotation: transform.rotation ?? 0,
      effects: effects || [],
    };
  }

  return null;
}
