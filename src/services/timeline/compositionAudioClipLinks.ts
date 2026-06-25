export interface CompositionAudioLinkClip {
  id: string;
  linkedClipId?: string;
  isComposition?: boolean;
  compositionId?: string;
  source?: {
    type?: string | null;
  } | null;
}

export function isCompositionAudioClip(clip: CompositionAudioLinkClip): boolean {
  return clip.isComposition === true &&
    Boolean(clip.compositionId) &&
    clip.source?.type === 'audio';
}

export function hasLinkedCompositionAudioClip(
  clips: readonly CompositionAudioLinkClip[],
  clip: CompositionAudioLinkClip,
): boolean {
  if (
    clip.isComposition !== true ||
    !clip.compositionId ||
    !clip.linkedClipId ||
    clip.source?.type === 'audio'
  ) {
    return false;
  }

  return clips.some((candidate) =>
    candidate.id === clip.linkedClipId &&
    candidate.isComposition === true &&
    candidate.compositionId === clip.compositionId &&
    candidate.source?.type === 'audio'
  );
}

export function shouldUseInlineCompositionMixdown(
  clips: readonly CompositionAudioLinkClip[],
  clip: CompositionAudioLinkClip,
): boolean {
  return clip.isComposition === true &&
    Boolean(clip.compositionId) &&
    clip.source?.type !== 'audio' &&
    !hasLinkedCompositionAudioClip(clips, clip);
}
