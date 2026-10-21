import type { AudioGraphRenderPlan } from '../AudioGraphTypes';
import { renderAudioGraph } from '../AudioGraphRenderer';
import type { AudioTrackData } from '../AudioMixer';
import type { TimelineClip, TimelineTrack } from '../../../types/timeline';

export function prepareExportTrackData(
  clips: TimelineClip[],
  buffers: Map<string, AudioBuffer>,
  tracks: TimelineTrack[],
  exportStartTime: number,
  audioGraphPlan?: AudioGraphRenderPlan
): AudioTrackData[] {
  const trackData: AudioTrackData[] = [];
  const plan = audioGraphPlan ?? renderAudioGraph({ clips, tracks, mode: 'export' });
  const clipPlanById = new Map(plan.clips.map(clip => [clip.clipId, clip]));
  const trackPlanById = new Map(plan.tracks.map(track => [track.trackId, track]));

  for (const clip of clips) {
    const buffer = buffers.get(clip.id);
    if (!buffer) continue;

    const track = tracks.find(t => t.id === clip.trackId);
    if (!track) continue;

    const clipPlan = clipPlanById.get(clip.id);
    const trackPlan = trackPlanById.get(clip.trackId);
    if (!clipPlan?.active || !trackPlan?.active) continue;

    const baseTrackData: AudioTrackData = {
      clipId: clip.id,
      buffer,
      startTime: clip.startTime - exportStartTime,
      sourceOffsetTime: Math.max(0, exportStartTime - clip.startTime),
      trackId: clip.trackId,
      trackMuted: trackPlan.muted || !trackPlan.active,
      trackSolo: trackPlan.solo,
      mixRole: 'main',
      trackVolumeDb: trackPlan.volumeDb,
      trackPan: trackPlan.pan,
    };

    trackData.push(baseTrackData);

    for (const send of trackPlan.sends) {
      if (send.enabled === false) continue;

      trackData.push({
        ...baseTrackData,
        clipId: `${clip.id}:send:${send.id}`,
        mixRole: 'send',
        sendId: send.id,
        sendTargetBusId: send.targetBusId,
        sendPreFader: send.preFader,
        trackVolumeDb: send.gainDb + (send.preFader ? 0 : trackPlan.volumeDb),
      });
    }
  }

  return trackData;
}
