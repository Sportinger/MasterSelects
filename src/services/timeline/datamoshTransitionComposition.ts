import type { CompositionTimelineData, SerializableClip, TimelineClip } from '../../types/timeline';
import type { TimelineTransition, TransitionCompositionLink } from '../../types/timelineCore';
import { DATAMOSH_BAKE_FORMAT } from '../../transitions/datamosh';

const TEMPLATE_VERSION = 1;

function baseClip(
  id: string,
  trackId: string,
  name: string,
  duration: number,
): Omit<SerializableClip, 'mediaFileId' | 'sourceType' | 'naturalDuration'> {
  return {
    id,
    trackId,
    name,
    startTime: 0,
    duration,
    inPoint: 0,
    outPoint: duration,
    transform: {
      opacity: 1,
      blendMode: 'normal',
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      rotation: { x: 0, y: 0, z: 0 },
    },
    effects: [],
  };
}

function hiddenLinkedClip(id: string, trackId: string, duration: number): SerializableClip {
  const clip = baseClip(id, trackId, 'Datamosh source link', duration);
  return {
    ...clip,
    mediaFileId: '',
    sourceType: 'solid',
    naturalDuration: duration,
    solidColor: '#000000',
    transform: { ...clip.transform, opacity: 0 },
  };
}

export function buildBakedDatamoshTimelineData(input: {
  outgoingClip: TimelineClip;
  incomingClip: TimelineClip;
  transition: TimelineTransition;
}): { timelineData: CompositionTimelineData; link: Omit<TransitionCompositionLink, 'parentCompositionId'> } | null {
  const { outgoingClip, incomingClip, transition } = input;
  if (transition.type !== 'datamosh') return null;

  const bakedMediaFileId = transition.params?.bakedMediaFileId;
  if (typeof bakedMediaFileId !== 'string' || bakedMediaFileId.length === 0) return null;
  if (transition.params?.bakedFormat !== DATAMOSH_BAKE_FORMAT) return null;

  const duration = Math.max(0.0001, transition.duration);
  const bakedDurationValue = transition.params?.bakedDuration;
  if (
    typeof bakedDurationValue !== 'number'
    || !Number.isFinite(bakedDurationValue)
    || Math.abs(bakedDurationValue - duration) > 1 / 240
  ) return null;
  const bitrateMbps = transition.params?.bitrateMbps;
  const bakedBitrateMbps = transition.params?.bakedBitrateMbps;
  if (
    typeof bitrateMbps !== 'number'
    || typeof bakedBitrateMbps !== 'number'
    || !Number.isFinite(bitrateMbps)
    || !Number.isFinite(bakedBitrateMbps)
    || Math.abs(bitrateMbps - bakedBitrateMbps) > 0.000_001
  ) return null;
  const bakedDuration = bakedDurationValue;
  const outgoingTrackId = `transition-comp-track:${transition.id}:outgoing`;
  const incomingTrackId = `transition-comp-track:${transition.id}:incoming`;
  const bakedTrackId = `transition-comp-track:${transition.id}:datamosh`;
  const outgoingClipId = `transition-comp:${transition.id}:outgoing`;
  const incomingClipId = `transition-comp:${transition.id}:incoming`;
  const bakedClipId = `transition-comp:${transition.id}:datamosh`;

  const bakedClip: SerializableClip = {
    ...baseClip(bakedClipId, bakedTrackId, 'Codec Datamosh', duration),
    mediaFileId: bakedMediaFileId,
    sourceType: 'video',
    naturalDuration: bakedDuration,
  };

  return {
    link: {
      kind: 'transition-comp',
      sourceLayout: 'mapped-v3',
      parentTransitionId: transition.id,
      parentOutgoingClipId: outgoingClip.id,
      parentIncomingClipId: incomingClip.id,
      linkedOutgoingClipId: outgoingClipId,
      linkedIncomingClipId: incomingClipId,
      innerTransitionId: '',
      templateType: 'datamosh-baked',
      templateVersion: TEMPLATE_VERSION,
      templateParamsKey: JSON.stringify({
        bakedMediaFileId,
        bakedDuration,
        bakedFormat: DATAMOSH_BAKE_FORMAT,
        bitrateMbps,
        duration,
      }),
      paddingBefore: 0,
      paddingAfter: 0,
      bodyStart: 0,
      bodyEnd: duration,
      materialized: true,
    },
    timelineData: {
      tracks: [
        { id: bakedTrackId, name: 'Datamosh', type: 'video', height: 96, muted: false, visible: true, solo: false },
        { id: outgoingTrackId, name: 'Outgoing link', type: 'video', height: 40, muted: true, visible: false, solo: false },
        { id: incomingTrackId, name: 'Incoming link', type: 'video', height: 40, muted: true, visible: false, solo: false },
      ],
      clips: [
        bakedClip,
        hiddenLinkedClip(outgoingClipId, outgoingTrackId, duration),
        hiddenLinkedClip(incomingClipId, incomingTrackId, duration),
      ],
      playheadPosition: 0,
      duration,
      durationLocked: true,
      zoom: 160,
      scrollX: 0,
      inPoint: 0,
      outPoint: duration,
      loopPlayback: true,
      markers: [
        { id: `transition-comp:${transition.id}:body-start`, time: 0, label: 'Transition In', color: '#4a9eff' },
        { id: `transition-comp:${transition.id}:body-end`, time: duration, label: 'Transition Out', color: '#ff6b4a' },
      ],
    },
  };
}
