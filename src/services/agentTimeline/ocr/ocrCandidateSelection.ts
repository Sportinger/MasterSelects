import type {
  OcrCandidateSelectionOptions,
  OcrFrameCandidate,
  OcrShotCandidateSource,
  OcrVisualChange,
} from '../../../types/agentTimeline/ocr';

function assertShot(shot: OcrShotCandidateSource): void {
  if (!shot.shotId.trim()) throw new TypeError('OCR shots require a shotId');
  if (!Number.isFinite(shot.start) || !Number.isFinite(shot.end) || shot.start < 0 || shot.end <= shot.start) {
    throw new RangeError('OCR shots must be non-negative half-open source-time ranges');
  }
  if (shot.keyframeSourceTime !== undefined && (
    !Number.isFinite(shot.keyframeSourceTime)
    || shot.keyframeSourceTime < shot.start
    || shot.keyframeSourceTime >= shot.end
  )) throw new RangeError('OCR shot keyframes must lie inside their shot');
}

function candidateTime(shot: OcrShotCandidateSource): number {
  return shot.keyframeSourceTime ?? shot.start + ((shot.end - shot.start) / 2);
}

/**
 * Produces only representative shot frames plus already-detected image/text-region
 * changes. It does not decode media and therefore cannot devolve into a frame scan.
 */
export function selectOcrFrameCandidates(
  inputShots: readonly OcrShotCandidateSource[],
  inputChanges: readonly OcrVisualChange[],
  options: OcrCandidateSelectionOptions = {},
): OcrFrameCandidate[] {
  const maximumChanges = options.maxChangeCandidatesPerShot ?? Number.POSITIVE_INFINITY;
  if (!Number.isSafeInteger(maximumChanges) && maximumChanges !== Number.POSITIVE_INFINITY) {
    throw new RangeError('maxChangeCandidatesPerShot must be a non-negative integer');
  }
  if (maximumChanges < 0) throw new RangeError('maxChangeCandidatesPerShot must be non-negative');
  const shots = [...inputShots].map((shot) => ({ ...shot })).toSorted((a, b) => a.start - b.start || a.end - b.end || a.shotId.localeCompare(b.shotId));
  if (new Set(shots.map((shot) => shot.shotId)).size !== shots.length) throw new TypeError('OCR shot IDs must be unique');
  shots.forEach(assertShot);
  const changes = [...inputChanges]
    .filter((change) => Number.isFinite(change.sourceTime) && Boolean(change.imageHash || change.textRegionHash))
    .toSorted((a, b) => a.sourceTime - b.sourceTime);
  const candidates: OcrFrameCandidate[] = [];
  for (const shot of shots) {
    const selected = new Map<number, OcrFrameCandidate>();
    const representative = candidateTime(shot);
    selected.set(representative, { shotId: shot.shotId, sourceTime: representative, visibilityEnd: shot.end, reason: 'shot-keyframe' });
    let changesAdded = 0;
    for (const change of changes) {
      if (changesAdded >= maximumChanges || change.sourceTime < shot.start || change.sourceTime >= shot.end) continue;
      if (selected.has(change.sourceTime)) continue;
      selected.set(change.sourceTime, {
        shotId: shot.shotId,
        sourceTime: change.sourceTime,
        visibilityEnd: shot.end,
        reason: 'visual-change',
        imageHash: change.imageHash,
        textRegionHash: change.textRegionHash,
      });
      changesAdded += 1;
    }
    const shotCandidates = [...selected.values()].toSorted((a, b) => a.sourceTime - b.sourceTime);
    shotCandidates.forEach((candidate, index) => {
      candidate.visibilityEnd = shotCandidates[index + 1]?.sourceTime ?? shot.end;
      candidates.push(candidate);
    });
  }
  return candidates;
}
