import type {
  FaceAnalysisBox,
  FaceFrameDetection,
  FrameAnalysisData,
} from '../../types/clipMetadata';

export interface FaceReviewCandidate {
  id: string;
  faceIds: string[];
  firstSeen: number;
  lastSeen: number;
  observationCount: number;
  sample: {
    timestamp: number;
    box: FaceAnalysisBox;
    confidence: number;
  };
}

interface ReviewTrack extends FaceReviewCandidate {
  lastBox: FaceAnalysisBox;
}

const MAX_TRACK_GAP_SECONDS = 0.8;

function centerDistance(left: FaceAnalysisBox, right: FaceAnalysisBox): number {
  const x = left.x + left.width / 2 - right.x - right.width / 2;
  const y = left.y + left.height / 2 - right.y - right.height / 2;
  return Math.hypot(x, y);
}

function intersectionOverUnion(left: FaceAnalysisBox, right: FaceAnalysisBox): number {
  const intersectionLeft = Math.max(left.x, right.x);
  const intersectionTop = Math.max(left.y, right.y);
  const intersectionRight = Math.min(left.x + left.width, right.x + right.width);
  const intersectionBottom = Math.min(left.y + left.height, right.y + right.height);
  const intersection = Math.max(0, intersectionRight - intersectionLeft)
    * Math.max(0, intersectionBottom - intersectionTop);
  const union = left.width * left.height + right.width * right.height - intersection;
  return union > 0 ? intersection / union : 0;
}

function matchScore(track: ReviewTrack, face: FaceFrameDetection): number | null {
  const distance = centerDistance(track.lastBox, face.box);
  const size = Math.max(
    track.lastBox.width,
    track.lastBox.height,
    face.box.width,
    face.box.height,
  );
  const iou = intersectionOverUnion(track.lastBox, face.box);
  if (iou < 0.04 && distance > Math.max(0.018, size * 0.7)) return null;
  return iou * 3 - distance / Math.max(0.001, size);
}

function createTrack(face: FaceFrameDetection, timestamp: number, index: number): ReviewTrack {
  return {
    id: `review-track-${index}`,
    faceIds: [face.id],
    firstSeen: timestamp,
    lastSeen: timestamp,
    observationCount: 1,
    sample: {
      timestamp,
      box: face.box,
      confidence: face.confidence,
    },
    lastBox: face.box,
  };
}

export function collectFaceReviewCandidates(
  frames: readonly FrameAnalysisData[],
): FaceReviewCandidate[] {
  const tracks: ReviewTrack[] = [];
  let activeTracks: ReviewTrack[] = [];

  for (const frame of frames) {
    if (frame.isSceneCut) activeTracks = [];
    activeTracks = activeTracks.filter(
      track => frame.timestamp - track.lastSeen <= MAX_TRACK_GAP_SECONDS,
    );
    const usedTracks = new Set<string>();
    const reviewFaces = (frame.faces ?? []).filter(face => face.identityEligible === false);

    for (const face of reviewFaces) {
      let bestTrack: ReviewTrack | undefined;
      let bestScore = -Infinity;
      for (const track of activeTracks) {
        if (usedTracks.has(track.id)) continue;
        const score = matchScore(track, face);
        if (score !== null && score > bestScore) {
          bestTrack = track;
          bestScore = score;
        }
      }
      if (!bestTrack) {
        bestTrack = createTrack(face, frame.timestamp, tracks.length + 1);
        tracks.push(bestTrack);
        activeTracks.push(bestTrack);
      } else {
        bestTrack.faceIds.push(face.id);
        bestTrack.lastSeen = frame.timestamp;
        bestTrack.observationCount += 1;
        bestTrack.lastBox = face.box;
        if (face.confidence > bestTrack.sample.confidence) {
          bestTrack.sample = {
            timestamp: frame.timestamp,
            box: face.box,
            confidence: face.confidence,
          };
        }
      }
      usedTracks.add(bestTrack.id);
    }
  }

  return tracks.map(({ lastBox: _lastBox, ...candidate }) => candidate);
}
