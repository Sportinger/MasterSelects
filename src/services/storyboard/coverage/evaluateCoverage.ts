import {
  createStoryboardFingerprintInput,
  hashStoryboardFingerprintInput,
  type StoryboardEvidenceRef,
} from '../contracts';
import {
  selectStoryboardCandidatesForScene,
} from '../candidates';
import { selectLatestStoryboardGenerationBrief } from '../generation/briefRevisions';
import { resolveStoryboardEvidenceRefs } from './evidenceRepair';
import type {
  EvaluateStoryboardCoverageInput,
  StoryboardCoverageEvaluation,
  StoryboardEvidenceResolution,
  StoryboardGenerationCapabilityAvailability,
} from './types';

interface Reason {
  readonly code: string;
  readonly message: string;
}

function addReason(reasons: Map<string, Reason>, code: string, message: string): void {
  reasons.set(code, { code, message });
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function scoreEvidence(
  evidence: readonly StoryboardEvidenceResolution[],
  reasons: Map<string, Reason>,
): number {
  let score = 0;
  let transcriptCount = 0;
  for (const resolution of evidence) {
    const ref = resolution.ref;
    if (resolution.status === 'current' && ref.kind === 'source-range') {
      score = Math.max(score, 0.85);
      addReason(reasons, `source-range:${ref.id}`, `Source: ${resolution.label} provides a usable ${resolution.detail.toLowerCase()}`);
    } else if (resolution.status === 'current' && ref.kind === 'transcript-moment') {
      transcriptCount += 1;
      score = Math.max(score, transcriptCount >= 2 ? 0.7 : 0.62);
      addReason(reasons, `transcript:${ref.id}`, `Source: transcript evidence ${resolution.label} is current.`);
    } else if (resolution.status === 'repairable') {
      score = Math.max(score, 0.3);
      addReason(reasons, `repairable:${ref.id}`, `Evidence gap: ${resolution.detail}`);
    } else if (resolution.status !== 'current') {
      addReason(reasons, `evidence-gap:${ref.id}`, `Evidence gap: ${resolution.detail}`);
    }
  }
  return score;
}

function capabilityState(
  mediaType: 'image' | 'video' | 'audio',
  availability: StoryboardGenerationCapabilityAvailability | undefined,
): boolean | undefined {
  return availability?.[mediaType];
}

function scoreGenerationReadiness(
  input: EvaluateStoryboardCoverageInput,
  reasons: Map<string, Reason>,
): number {
  const brief = selectLatestStoryboardGenerationBrief(input.state, input.sceneId);
  if (!brief) {
    addReason(reasons, 'generation:no-brief', 'Readiness gap: no generation brief exists.');
    return 0;
  }

  let score = 0;
  const promptReady = brief.prompt.trim().length >= 12;
  if (promptReady) score += 0.25;
  else addReason(reasons, 'generation:prompt', 'Readiness gap: the generation prompt is too short.');
  if (brief.durationSeconds > 0) score += 0.1;
  else addReason(reasons, 'generation:duration', 'Readiness gap: generation duration is invalid.');
  if (brief.aspectRatio.trim()) score += 0.1;
  else addReason(reasons, 'generation:aspect', 'Readiness gap: aspect ratio is missing.');

  const referencedIds = new Set([
    ...brief.referenceMediaFileIds,
    ...(brief.startFrameMediaFileId ? [brief.startFrameMediaFileId] : []),
    ...(brief.endFrameMediaFileId ? [brief.endFrameMediaFileId] : []),
  ]);
  const missingReferences = [...referencedIds]
    .filter(id => !input.mediaFiles.some(file => file.id === id))
    .sort();
  if (missingReferences.length === 0) score += 0.15;
  else addReason(
    reasons,
    'generation:references',
    `Readiness gap: ${missingReferences.length} referenced media ${missingReferences.length === 1 ? 'item is' : 'items are'} missing.`,
  );

  const policy = brief.capabilityPolicy;
  let hardReferenceGap = false;
  if (policy.needsStartEndFrames && (!brief.startFrameMediaFileId || !brief.endFrameMediaFileId)) {
    hardReferenceGap = true;
    addReason(reasons, 'generation:start-end', 'Readiness gap: start and end frame references are required.');
  } else if (policy.needsImageToVideo && !brief.startFrameMediaFileId && brief.referenceMediaFileIds.length === 0) {
    hardReferenceGap = true;
    addReason(reasons, 'generation:image-to-video', 'Readiness gap: image-to-video requires an image reference.');
  }
  if (!hardReferenceGap) score += 0.15;

  const available = capabilityState(policy.mediaType, input.capabilityAvailability);
  if (available === true) score += 0.15;
  else if (available === false) {
    addReason(reasons, 'generation:capability', `Readiness gap: ${policy.mediaType} generation capability is unavailable.`);
  } else {
    addReason(reasons, 'generation:capability-unknown', `Readiness gap: ${policy.mediaType} provider capability has not been checked.`);
  }

  addReason(
    reasons,
    'generation:brief',
    `Readiness: generation brief revision ${brief.revision} defines prompt, duration, aspect ratio, and capability policy.`,
  );
  return Math.min(1, score);
}

function evidenceRefsForScene(
  input: EvaluateStoryboardCoverageInput,
): StoryboardEvidenceRef[] {
  const scene = input.state.scenes[input.sceneId];
  return (scene?.evidenceRefIds ?? [])
    .map(id => input.state.evidenceRefs[id])
    .filter((ref): ref is StoryboardEvidenceRef => !!ref);
}

function referencedMediaFingerprintMaterial(
  input: EvaluateStoryboardCoverageInput,
  evidence: readonly StoryboardEvidenceResolution[],
): Array<{ mediaFileId: string; contentFingerprint?: string }> {
  const scene = input.state.scenes[input.sceneId];
  const candidates = selectStoryboardCandidatesForScene(input.state, input.sceneId);
  const briefIds = Object.values(input.state.generationBriefs)
    .filter(brief => brief.sceneId === input.sceneId)
    .flatMap(brief => [
      ...brief.referenceMediaFileIds,
      ...(brief.startFrameMediaFileId ? [brief.startFrameMediaFileId] : []),
      ...(brief.endFrameMediaFileId ? [brief.endFrameMediaFileId] : []),
    ]);
  const ids = new Set([
    ...evidence.flatMap(resolution => resolution.mediaFileId ? [resolution.mediaFileId] : []),
    ...candidates.flatMap(candidate => candidate.mediaFileId ? [candidate.mediaFileId] : []),
    ...briefIds,
  ]);
  const result = [...ids].sort().map((mediaFileId) => {
    const media = input.mediaFiles.find(file => file.id === mediaFileId);
    return {
      mediaFileId,
      contentFingerprint: media?.fileHash || [
        media?.id ?? 'missing',
        media?.duration ?? '',
        media?.fileSize ?? '',
        media?.createdAt ?? '',
      ].join(':'),
    };
  });
  const transcriptRefs = evidence.flatMap((resolution) => {
    const ref = resolution.ref;
    return ref.kind === 'transcript-moment'
      ? [{
          id: ref.id,
          status: resolution.status,
          handle: resolution.moment?.handle ?? ref.handle,
          indexVersion: resolution.moment?.indexVersion ?? ref.indexVersion,
        }]
      : [];
  });
  if (transcriptRefs.length > 0) {
    result.push({
      mediaFileId: `transcript-index:${input.sceneId}`,
      contentFingerprint: stableJson({
        currentVersion: input.momentIndex?.version ?? null,
        refs: transcriptRefs,
      }),
    });
  }
  result.push({
    mediaFileId: `generation-capability:${scene?.id ?? input.sceneId}`,
    contentFingerprint: stableJson(input.capabilityAvailability ?? null),
  });
  return result;
}

export async function evaluateStoryboardCoverage(
  input: EvaluateStoryboardCoverageInput,
): Promise<StoryboardCoverageEvaluation> {
  const scene = input.state.scenes[input.sceneId];
  if (!scene) throw new Error(`Unknown storyboard scene: ${input.sceneId}`);
  const candidates = selectStoryboardCandidatesForScene(input.state, input.sceneId);
  const refs = evidenceRefsForScene(input);
  const evidence = resolveStoryboardEvidenceRefs({
    refs,
    mediaFiles: input.mediaFiles,
    candidates: input.state.candidates,
    momentIndex: input.momentIndex,
  });
  const reasons = new Map<string, Reason>();
  let sourceScore = scoreEvidence(evidence, reasons);
  let generationReadinessScore = scoreGenerationReadiness(input, reasons);

  const acceptedWithMedia = candidates.some(candidate =>
    candidate.state === 'accepted' &&
    !!candidate.mediaFileId &&
    input.mediaFiles.some(file => file.id === candidate.mediaFileId)
  );
  const readyWithMedia = candidates.some(candidate =>
    candidate.state === 'ready' &&
    !!candidate.mediaFileId &&
    input.mediaFiles.some(file => file.id === candidate.mediaFileId)
  );
  const pending = candidates.some(candidate =>
    candidate.state === 'queued' ||
    candidate.state === 'processing' ||
    candidate.state === 'awaiting-approval'
  );
  const acceptedWithoutMedia = candidates.some(candidate =>
    candidate.state === 'accepted' &&
    (
      !candidate.mediaFileId ||
      !input.mediaFiles.some(file => file.id === candidate.mediaFileId)
    )
  );
  const unusableCandidateStates = candidates
    .filter(candidate =>
      candidate.state === 'failed' ||
      candidate.state === 'canceled' ||
      candidate.state === 'rejected'
    )
    .map(candidate => candidate.state)
    .toSorted();
  if (acceptedWithMedia) {
    sourceScore = Math.max(sourceScore, 1);
    generationReadinessScore = Math.max(generationReadinessScore, 1);
    addReason(reasons, 'candidate:accepted', 'Source: an accepted candidate with available media can fulfill the scene now.');
  } else if (readyWithMedia) {
    sourceScore = Math.max(sourceScore, 0.72);
    generationReadinessScore = Math.max(generationReadinessScore, 0.85);
    addReason(reasons, 'candidate:ready', 'Readiness: a generated candidate is ready for review but not accepted.');
  } else if (pending) {
    generationReadinessScore = Math.max(generationReadinessScore, 0.5);
    addReason(reasons, 'candidate:pending', 'Readiness: generation is queued, processing, or awaiting approval.');
  }
  if (acceptedWithoutMedia) {
    addReason(reasons, 'candidate:accepted-media-missing', 'Source gap: an accepted candidate exists, but its media is missing.');
  }
  if (unusableCandidateStates.length > 0) {
    const uniqueStates = [...new Set(unusableCandidateStates)];
    addReason(
      reasons,
      'candidate:unusable',
      `Source gap: candidate output is unavailable (${uniqueStates.join(', ')}).`,
    );
  }
  if (candidates.length === 0) {
    addReason(reasons, 'candidate:none', 'Source gap: no source or generated candidate is attached.');
  }

  sourceScore = Math.round(Math.min(1, sourceScore) * 100) / 100;
  generationReadinessScore = Math.round(Math.min(1, generationReadinessScore) * 100) / 100;
  const level = acceptedWithMedia || sourceScore >= 0.75
    ? 'green'
    : sourceScore >= 0.3 || generationReadinessScore >= 0.35
      ? 'yellow'
      : 'red';
  const generationBriefIds = Object.values(input.state.generationBriefs)
    .filter(brief => brief.sceneId === input.sceneId)
    .map(brief => brief.id);
  const selection = {
    planId: scene.planId,
    sceneIds: [scene.id],
    generationBriefIds,
    candidateIds: candidates.map(candidate => candidate.id),
    evidenceRefIds: refs.map(ref => ref.id),
    variantOptionIds: [],
    decisionIds: [],
    includeCoverage: false,
    referencedMedia: referencedMediaFingerprintMaterial(input, evidence),
  };
  const evaluatedAgainstFingerprint = await hashStoryboardFingerprintInput(
    createStoryboardFingerprintInput(input.state, selection),
  );

  return {
    coverage: {
      schemaVersion: 1,
      sceneId: scene.id,
      level,
      sourceScore,
      generationReadinessScore,
      reasons: [...reasons.values()]
        .toSorted((left, right) => left.code.localeCompare(right.code))
        .map(reason => reason.message),
      evaluatedAgainstFingerprint,
      evaluatedAt: input.evaluatedAt,
    },
    evidence,
    ...(selectLatestStoryboardGenerationBrief(input.state, input.sceneId)
      ? { latestBrief: selectLatestStoryboardGenerationBrief(input.state, input.sceneId) }
      : {}),
  };
}
