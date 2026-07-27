import type { ClipAnalysis, FacePersonSummary } from '../../types/clipMetadata';
import { triggerTimelineSave } from '../../stores/mediaStore';
import { projectFileService } from '../projectFileService';
import { applySharedClipAnalysisState } from '../clipAnalysis/sourceAnalysisSharing';
import { summarizeCachedFaces } from './faceIdentityTracker';
import {
  findTimelineAnalysisClip,
  updateTimelineAnalysisClips,
} from '../timeline/timelineRuntimeCoordinator';

function targetPerson(analysis: ClipAnalysis, personId: string): FacePersonSummary | null {
  return analysis.faceAnalysis?.people.find(person => person.id === personId) ?? null;
}

function replacePersonInFrames(
  analysis: ClipAnalysis,
  sourcePersonId: string,
  target: FacePersonSummary,
  inRange: (timestamp: number) => boolean,
): ClipAnalysis {
  const frames = analysis.frames.map((frame) => ({
    ...frame,
    faces: frame.faces?.map((face) => (
      face.personId === sourcePersonId && inRange(frame.timestamp)
        ? {
            ...face,
            personId: target.id,
            label: target.label,
            identityEligible: true,
            manualSourcePersonId: face.manualSourcePersonId ?? sourcePersonId,
          }
        : face
    )),
  }));
  return {
    ...analysis,
    frames,
    faceAnalysis: summarizeCachedFaces(frames),
  };
}

function assignFaceIdsToPerson(
  analysis: ClipAnalysis,
  faceIds: ReadonlySet<string>,
  candidateId: string,
  target: FacePersonSummary,
): ClipAnalysis {
  const frames = analysis.frames.map((frame) => ({
    ...frame,
    faces: frame.faces?.map((face) => (
      faceIds.has(face.id)
        ? {
            ...face,
            personId: target.id,
            label: target.label,
            identityEligible: true,
            manualSourcePersonId: candidateId,
          }
        : face
    )),
  }));
  return {
    ...analysis,
    frames,
    faceAnalysis: summarizeCachedFaces(frames),
  };
}

async function persistCorrection(clipId: string, nextAnalysis: ClipAnalysis): Promise<void> {
  const clip = findTimelineAnalysisClip(clipId);
  if (!clip) return;
  updateTimelineAnalysisClips(clips =>
    applySharedClipAnalysisState(
      clips,
      clipId,
      candidate => ({ ...candidate, analysis: nextAnalysis }),
    )
  );
  const mediaId = clip.source?.mediaFileId ?? clip.mediaFileId;
  if (mediaId && projectFileService.isProjectOpen()) {
    const storedRanges = (await projectFileService.getAnalysisRanges(mediaId))
      .map((rangeKey) => rangeKey.split('-').map(Number) as [number, number])
      .filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end > start);
    const ranges = storedRanges.length > 0
      ? storedRanges
      : [[clip.inPoint ?? 0, clip.outPoint ?? clip.duration] as [number, number]];
    await Promise.all(ranges.map(async ([start, end]) => {
      const frames = nextAnalysis.frames.filter(frame => (
        frame.timestamp >= start && frame.timestamp <= end
      ));
      if (frames.length === 0) return;
      await projectFileService.saveAnalysis(
        mediaId,
        start,
        end,
        frames,
        nextAnalysis.sampleInterval,
        summarizeCachedFaces(frames),
      );
    }));
  }
  triggerTimelineSave();
}

export async function mergeFacePeople(
  clipId: string,
  sourcePersonId: string,
  targetPersonId: string,
): Promise<void> {
  if (sourcePersonId === targetPersonId) return;
  const clip = findTimelineAnalysisClip(clipId);
  const analysis = clip?.analysis;
  if (!analysis) return;
  const target = targetPerson(analysis, targetPersonId);
  if (!target || !targetPerson(analysis, sourcePersonId)) return;
  await persistCorrection(
    clipId,
    replacePersonInFrames(analysis, sourcePersonId, target, () => true),
  );
}

export async function moveFaceAppearance(
  clipId: string,
  sourcePersonId: string,
  targetPersonId: string,
  timestamp: number,
): Promise<void> {
  if (sourcePersonId === targetPersonId) return;
  const clip = findTimelineAnalysisClip(clipId);
  const analysis = clip?.analysis;
  if (!analysis) return;
  const source = targetPerson(analysis, sourcePersonId);
  const target = targetPerson(analysis, targetPersonId);
  const appearance = source?.appearances.find(range => timestamp >= range.start && timestamp <= range.end);
  if (!target || !appearance) return;
  await persistCorrection(
    clipId,
    replacePersonInFrames(
      analysis,
      sourcePersonId,
      target,
      (frameTimestamp) => frameTimestamp >= appearance.start && frameTimestamp <= appearance.end,
    ),
  );
}

export async function assignReviewFaces(
  clipId: string,
  candidateId: string,
  faceIds: string[],
  targetPersonId: string,
): Promise<void> {
  if (faceIds.length === 0) return;
  const clip = findTimelineAnalysisClip(clipId);
  const analysis = clip?.analysis;
  if (!analysis) return;
  const target = targetPerson(analysis, targetPersonId);
  if (!target) return;
  await persistCorrection(
    clipId,
    assignFaceIdsToPerson(analysis, new Set(faceIds), candidateId, target),
  );
}
