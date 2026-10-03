import type { TimelineClip } from '../../../types/timeline';
import type { TransitionCompositionLink, TransitionSourceMap } from '../../../types/timelineCore';

export interface CompositionTransitionParent {
  parentClipId: string;
  role: 'outgoing' | 'incoming';
  /** One-based row and column for generated panel slices. */
  panel?: string;
}

type SourceClip = Pick<TimelineClip, 'id' | 'mediaFileId' | 'isComposition' | 'compositionId'
  | 'signalAssetId' | 'transitionSourceMap' | 'sourceRect'> & {
  source?: Pick<NonNullable<TimelineClip['source']>, 'mediaFileId'> | null;
};

function mediaIdentity(clip: SourceClip): string | undefined {
  if (clip.isComposition && clip.compositionId) return `comp:${clip.compositionId}`;
  const fileId = clip.mediaFileId || clip.source?.mediaFileId;
  return fileId ? `file:${fileId}` : clip.signalAssetId ? `signal:${clip.signalAssetId}` : undefined;
}

function timingIdentity(map: TransitionSourceMap): string {
  // Panel copies rebase animation/keyframe IDs. Only the source-time contract identifies the parent.
  return JSON.stringify(map.version === 1 ? map : {
    version: map.version, mediaDuration: map.mediaDuration, segments: map.segments,
    duration: map.parent.duration, inPoint: map.parent.inPoint, outPoint: map.parent.outPoint,
    speed: map.parent.defaultSpeed, timelineStart: map.parent.animation.parameterTimelineStart,
  });
}

/** Read-only derivation; ambiguous same-media sources are deliberately left unlinked. */
export function deriveCompositionTransitionParents(
  clips: readonly SourceClip[], link: TransitionCompositionLink | undefined,
): ReadonlyMap<string, CompositionTransitionParent> {
  const parents = new Map<string, CompositionTransitionParent>();
  if (!link) return parents;
  const participants = [
    { role: 'outgoing' as const, linkedId: link.linkedOutgoingClipId, parentClipId: link.parentOutgoingClipId },
    { role: 'incoming' as const, linkedId: link.linkedIncomingClipId, parentClipId: link.parentIncomingClipId },
  ];
  for (const clip of clips) {
    const direct = participants.find(participant => participant.linkedId === clip.id);
    // expandMultiPanelClips replaces the linked clip with `${linkedId}:panel:${row}:${column}`.
    const generated = participants.flatMap(participant => {
      if (!clip.id.startsWith(`${participant.linkedId}:panel:`)) return [];
      const coordinates = clip.id.slice(`${participant.linkedId}:panel:`.length).match(/^(\d+):(\d+)$/);
      return coordinates ? [{ ...participant, panel: `${Number(coordinates[1]) + 1}, ${Number(coordinates[2]) + 1}` }] : [];
    });
    if (direct || generated.length === 1) {
      const match = direct ?? generated[0];
      parents.set(clip.id, { parentClipId: match.parentClipId, role: match.role,
        ...(!direct && generated[0] ? { panel: generated[0].panel } : {}) });
      continue;
    }
    // Imported/remapped panel IDs can still retain the shared media and mapped source clock.
    if (!clip.transitionSourceMap || !mediaIdentity(clip)) continue;
    const matches = participants.filter(participant => {
      const linked = clips.find(candidate => candidate.id === participant.linkedId);
      return linked && mediaIdentity(linked) === mediaIdentity(clip)
        && linked.transitionSourceMap
        && timingIdentity(linked.transitionSourceMap) === timingIdentity(clip.transitionSourceMap!);
    });
    if (matches.length !== 1) continue;
    parents.set(clip.id, { parentClipId: matches[0].parentClipId, role: matches[0].role,
      ...(clip.sourceRect ? { panel: 'slice' } : {}) });
  }
  return parents;
}
