import type {
  StoryboardCandidate,
  StoryboardEvidenceRef,
} from '../contracts';
import type { MediaFile } from '../../../stores/mediaStore/types';
import type {
  StoryboardEvidenceMoment,
  StoryboardEvidenceResolution,
  StoryboardMomentIndex,
} from './types';

function stableCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
function finiteRange(start: number, end: number): boolean {
  return Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start;
}

function durationLabel(start: number, end: number): string {
  return `${start.toFixed(1)}–${end.toFixed(1)}s`;
}

function findAliasedMoment(
  ref: Extract<StoryboardEvidenceRef, { kind: 'transcript-moment' }>,
  index: StoryboardMomentIndex,
): StoryboardEvidenceMoment | undefined {
  return index.moments
    .filter(moment => moment.legacyHandles?.some(alias =>
      alias.handle === ref.handle && alias.indexVersion === ref.indexVersion
    ))
    .toSorted((left, right) =>
      stableCompare(left.handle, right.handle) ||
      left.startSeconds - right.startSeconds
    )[0];
}

function replacementTranscriptRef(
  ref: Extract<StoryboardEvidenceRef, { kind: 'transcript-moment' }>,
  moment: StoryboardEvidenceMoment,
): StoryboardEvidenceRef {
  return {
    ...ref,
    handle: moment.handle,
    indexVersion: moment.indexVersion,
  };
}

export function resolveStoryboardEvidenceRef(input: {
  readonly ref: StoryboardEvidenceRef;
  readonly mediaFiles: readonly MediaFile[];
  readonly candidates: Readonly<Record<string, StoryboardCandidate>>;
  readonly momentIndex?: StoryboardMomentIndex;
}): StoryboardEvidenceResolution {
  const { ref } = input;

  if (ref.kind === 'transcript-moment') {
    const exact = input.momentIndex?.moments.find(moment =>
      moment.handle === ref.handle && moment.indexVersion === ref.indexVersion
    );
    if (exact) {
      return {
        ref,
        status: 'current',
        label: exact.speaker ? `${exact.speaker}: ${exact.excerpt || ref.handle}` : exact.excerpt || ref.handle,
        detail: `Transcript moment · ${durationLabel(exact.startSeconds, exact.endSeconds)} · index ${exact.indexVersion}`,
        mediaFileId: exact.mediaFileId,
        startSeconds: exact.startSeconds,
        endSeconds: exact.endSeconds,
        moment: exact,
      };
    }
    const aliased = input.momentIndex
      ? findAliasedMoment(ref, input.momentIndex)
      : undefined;
    if (aliased) {
      return {
        ref,
        status: 'repairable',
        label: aliased.excerpt || ref.handle,
        detail: `Stale transcript handle from ${ref.indexVersion}; repair to ${aliased.handle} in ${aliased.indexVersion}.`,
        mediaFileId: aliased.mediaFileId,
        startSeconds: aliased.startSeconds,
        endSeconds: aliased.endSeconds,
        moment: aliased,
        suggestedRef: replacementTranscriptRef(ref, aliased),
      };
    }
    return {
      ref,
      status: 'stale',
      label: ref.handle,
      detail: input.momentIndex
        ? `Transcript handle is not present in current index ${input.momentIndex.version}. Refresh the index to repair it.`
        : `Transcript handle uses index ${ref.indexVersion}. Load the current index to verify or repair it.`,
    };
  }

  if (ref.kind === 'source-range') {
    const media = input.mediaFiles.find(file => file.id === ref.mediaFileId);
    if (!finiteRange(ref.start, ref.end)) {
      return {
        ref,
        status: 'invalid',
        label: media?.name || ref.mediaFileId,
        detail: 'Source range is invalid and must be repaired.',
        mediaFileId: ref.mediaFileId,
      };
    }
    if (!media) {
      return {
        ref,
        status: 'missing',
        label: ref.mediaFileId,
        detail: `Source media is missing · ${durationLabel(ref.start, ref.end)}.`,
        mediaFileId: ref.mediaFileId,
        startSeconds: ref.start,
        endSeconds: ref.end,
      };
    }
    const exceedsMedia = Number.isFinite(media.duration) && ref.end > (media.duration ?? 0) + 0.001;
    return {
      ref,
      status: exceedsMedia ? 'invalid' : 'current',
      label: media.name,
      detail: exceedsMedia
        ? `Range ${durationLabel(ref.start, ref.end)} exceeds the ${media.duration!.toFixed(1)}s source.`
        : `Source range · ${durationLabel(ref.start, ref.end)}.`,
      mediaFileId: ref.mediaFileId,
      startSeconds: ref.start,
      endSeconds: ref.end,
    };
  }

  if (ref.kind === 'generated-candidate') {
    const candidate = input.candidates[ref.candidateId];
    if (!candidate) {
      return {
        ref,
        status: 'missing',
        label: ref.candidateId,
        detail: 'Generated candidate is missing.',
        candidateId: ref.candidateId,
      };
    }
    return {
      ref,
      status: 'current',
      label: `${candidate.kind} · ${candidate.state}`,
      detail: `Candidate ${candidate.id}${candidate.generationBriefRevision === undefined ? '' : ` · prompt revision ${candidate.generationBriefRevision}`}.`,
      ...(candidate.mediaFileId ? { mediaFileId: candidate.mediaFileId } : {}),
      candidateId: candidate.id,
    };
  }

  const media = input.mediaFiles.find(file => file.id === ref.mediaFileId);
  return {
    ref,
    status: media ? 'current' : 'missing',
    label: media?.name || ref.mediaFileId,
    detail: media ? 'Reference image.' : 'Reference image media is missing.',
    mediaFileId: ref.mediaFileId,
  };
}

export function resolveStoryboardEvidenceRefs(input: {
  readonly refs: readonly StoryboardEvidenceRef[];
  readonly mediaFiles: readonly MediaFile[];
  readonly candidates: Readonly<Record<string, StoryboardCandidate>>;
  readonly momentIndex?: StoryboardMomentIndex;
}): StoryboardEvidenceResolution[] {
  return input.refs
    .toSorted((left, right) => stableCompare(left.id, right.id))
    .map(ref => resolveStoryboardEvidenceRef({ ...input, ref }));
}

export function applyStoryboardEvidenceRepair(
  resolution: StoryboardEvidenceResolution,
): StoryboardEvidenceRef {
  if (resolution.status !== 'repairable' || !resolution.suggestedRef) {
    throw new Error(`Evidence reference ${resolution.ref.id} has no verified repair.`);
  }
  return structuredClone(resolution.suggestedRef);
}
