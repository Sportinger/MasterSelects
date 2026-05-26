import type { TimelineClip, TimelineTrack } from '../../types';

export interface LinkedClipNodeGraphContext {
  selectedClip: TimelineClip;
  selectedTrack: TimelineTrack | null;
  ownerClip: TimelineClip;
  ownerTrack: TimelineTrack | null;
  linkedClip: TimelineClip | null;
  linkedTrack: TimelineTrack | null;
}

function findLinkedClip(clips: readonly TimelineClip[], clip: TimelineClip): TimelineClip | null {
  if (clip.linkedClipId) {
    return clips.find((candidate) => candidate.id === clip.linkedClipId) ?? null;
  }
  return clips.find((candidate) => candidate.linkedClipId === clip.id) ?? null;
}

function shouldUseLinkedClipAsGraphOwner(selectedClip: TimelineClip, linkedClip: TimelineClip | null): linkedClip is TimelineClip {
  return selectedClip.source?.type === 'audio' && !!linkedClip && linkedClip.source?.type !== 'audio';
}

export function resolveLinkedClipNodeGraphContext(
  clips: readonly TimelineClip[],
  tracks: readonly TimelineTrack[],
  clipId: string | null | undefined,
): LinkedClipNodeGraphContext | null {
  if (!clipId) {
    return null;
  }

  const selectedClip = clips.find((clip) => clip.id === clipId) ?? null;
  if (!selectedClip) {
    return null;
  }

  const directLinkedClip = findLinkedClip(clips, selectedClip);
  const ownerClip = shouldUseLinkedClipAsGraphOwner(selectedClip, directLinkedClip)
    ? directLinkedClip
    : selectedClip;
  const linkedClip = ownerClip.id === selectedClip.id
    ? directLinkedClip
    : selectedClip;

  return {
    selectedClip,
    selectedTrack: tracks.find((track) => track.id === selectedClip.trackId) ?? null,
    ownerClip,
    ownerTrack: tracks.find((track) => track.id === ownerClip.trackId) ?? null,
    linkedClip,
    linkedTrack: linkedClip ? tracks.find((track) => track.id === linkedClip.trackId) ?? null : null,
  };
}

export function createNodeGraphOwnerClip(context: LinkedClipNodeGraphContext): TimelineClip {
  if (context.ownerClip.nodeGraph || !context.selectedClip.nodeGraph || context.ownerClip.id === context.selectedClip.id) {
    return context.ownerClip;
  }

  return {
    ...context.ownerClip,
    nodeGraph: context.selectedClip.nodeGraph,
  };
}
