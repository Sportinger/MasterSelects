import { useTimelineStore } from '../../stores/timeline';
import { useMediaStore } from '../../stores/mediaStore';
import { useHistoryStore } from '../../stores/historyStore';
import { assertExclusiveTimelineMutationAllowed } from '../../stores/timeline/exclusiveMutationLease';
import { renderHostPort } from '../render/renderHostPort';
import { getTrackingAsset, publishTrackingAsset } from './trackingAssets';
import { trackSurface } from './trackSurface';
import { surfaceSourceTime } from './surfaceEffects';
import { sampleSurface } from './surfaceGeometry';
import { slitScanProtectionMask, slitScanTrackingQuad } from './slitScanProtectionMask';
import type { PlanarTrack } from '../../types/planarTracking';

function context(clipId: string, effectId: string) {
  assertExclusiveTimelineMutationAllowed();
  const timeline = useTimelineStore.getState();
  const clip = timeline.clips.find(item => item.id === clipId);
  const effect = clip?.effects.find(item => item.id === effectId && item.type === 'slit-scan');
  if (!clip || !effect || timeline.isExporting || timeline.tracks.find(t => t.id === clip.trackId)?.locked) {
    throw new Error('The Slit Scan clip is unavailable, locked, or being exported.');
  }
  if (clip.isComposition || clip.source?.type !== 'video') throw new Error('Select a source video clip.');
  const mediaId = clip.source.mediaFileId ?? clip.mediaFileId;
  const media = useMediaStore.getState().files.find(item => item.id === mediaId);
  if (!media || !media.width || !media.height) throw new Error('Relink the source video first.');
  return { timeline, clip, effect, media };
}

export function createSlitScanProtectionFromTrack(clipId: string, effectId: string, feather: number) {
  const { timeline, clip, effect, media } = context(clipId, effectId);
  const asset = getTrackingAsset(String(effect.params.stabilizationAssetId ?? ''));
  if (!asset || asset.sourceMediaId !== media.id) throw new Error('Choose tracking for this source video.');
  const reference = Number(effect.params.stabilizationReference ?? asset.track.referenceTime);
  const sample = sampleSurface(asset.track, reference);
  if (!sample) throw new Error('The reference frame has no tracking.');
  const history = useHistoryStore.getState(), batch = history.startBatch('Create Slit Scan protection');
  try {
    const maskId = timeline.addMask(clip.id, slitScanProtectionMask(sample.quad, feather));
    useTimelineStore.getState().updateClipEffect(clip.id, effect.id, { protectionMask: maskId, maskStrength: 1 });
    renderHostPort.requestRender();
    return maskId;
  } finally { if (batch.opened) history.endBatch(); }
}

/** Track from an authored object selection with the existing browser-local tracker.
 * Publish only after both passes finish; cancellation leaves the project untouched. */
export async function trackSlitScanObject(clipId: string, effectId: string, feather: number,
  signal: AbortSignal, onProgress: (message: string) => void): Promise<string> {
  const { timeline, clip, effect, media } = context(clipId, effectId);
  if (effect.params.stabilizationAssetId) throw new Error('Choose stabilization Off before tracking a new source selection.');
  const localTime = Math.max(0, Math.min(clip.duration, timeline.playheadPosition - clip.startTime));
  const mask = timeline.getInterpolatedMasks(clipId, localTime)?.find(item => item.id === effect.params.protectionMask);
  if (!mask) throw new Error('Draw and select an object mask first.');
  const originalMask = clip.masks?.find(item => item.id === mask.id);
  const maskSignature = JSON.stringify(originalMask);
  const evaluatedMaskSignature = JSON.stringify(mask);
  const quad = slitScanTrackingQuad(mask, media.width!, media.height!);
  const from = clip.inPoint, to = clip.outPoint;
  const time = surfaceSourceTime(clip, localTime, timeline.getClipKeyframes(clipId));
  const fps = media.fps || 30;
  const track: PlanarTrack = { id: crypto.randomUUID(), name: `${clip.name} · Slit Scan object`, sourceId: media.id,
    fps, referenceTime: time, referenceQuad: quad, samples: [], occlusions: [], enabled: false,
    color: '#2997E5', opacity: 1, fill: 0, lineWidth: 2, inset: 0, shape: 'outline', visibleFrom: from, visibleTo: to, fade: 0 };
  const file = clip.file ?? media.file;
  const borrowedUrl = media.url || clip.source?.videoElement?.currentSrc;
  const url = borrowedUrl || (file ? URL.createObjectURL(file) : '');
  if (!url) throw new Error('Relink the source video first.');
  timeline.pause();
  try {
    const forward = await trackSurface({ url, file, track, from: time, to, quad, signal,
      onProgress: value => onProgress(`Tracking forward · ${Math.round(value * 100)}%`) });
    const backward = await trackSurface({ url, file, track, from: time, to: from, quad, signal,
      onProgress: value => onProgress(`Tracking backward · ${Math.round(value * 100)}%`) });
    signal.throwIfAborted();
    track.samples = [...new Map([...backward.samples, ...forward.samples].map(sample => [sample.time, sample])).values()].toSorted((a, b) => a.time - b.time);
    if (track.samples.length < 2 || !forward.samples.length) throw new Error('No reliable object track. Choose a more textured area.');
    track.referenceTime = forward.samples[0].time;
    track.referenceQuad = forward.samples[0].quad;
    const fresh = context(clipId, effectId);
    if (fresh.media.id !== media.id || fresh.media.file !== media.file || fresh.media.url !== media.url
      || fresh.clip.inPoint !== from || fresh.clip.outPoint !== to
      || fresh.effect.params.stabilizationAssetId || fresh.effect.params.protectionMask !== mask.id
      || surfaceSourceTime(fresh.clip, localTime, fresh.timeline.getClipKeyframes(clipId)) !== time
      || JSON.stringify(fresh.clip.masks?.find(item => item.id === mask.id)) !== maskSignature
      || JSON.stringify(fresh.timeline.getInterpolatedMasks(clipId, localTime)?.find(item => item.id === mask.id)) !== evaluatedMaskSignature) {
      throw new Error('The source, selection, or stabilization changed while tracking. Previous settings were kept.');
    }
    const history = useHistoryStore.getState(), batch = history.startBatch('Track and stabilize Slit Scan object');
    try {
      const asset = publishTrackingAsset(clipId, track);
      if (!asset) throw new Error('The tracking result could not be saved.');
      fresh.timeline.updateClipEffect(clipId, effectId, { stabilizationAssetId: asset.id,
        stabilizationReference: track.referenceTime, stabilizationStrength: 1, stabilizationRotation: 'on', stabilizationScale: 'on' });
      // The selection was an effect input already. Keep it as editable authoring
      // data, and give the stabilization its own fixed reference-space mask.
      fresh.timeline.updateMask(clipId, mask.id, { enabled: true, compositeEnabled: false });
      createSlitScanProtectionFromTrack(clipId, effectId, feather);
    } finally { if (batch.opened) history.endBatch(); }
    const stopped = [forward.stopped, backward.stopped].filter(Boolean);
    return `${track.samples.length} frames tracked${stopped.length ? ` · Coverage stopped: ${stopped.join('; ')}` : ' · Stabilization and protection ready'}`;
  } finally { if (!borrowedUrl) URL.revokeObjectURL(url); }
}
