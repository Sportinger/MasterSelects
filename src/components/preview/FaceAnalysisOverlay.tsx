import { memo, useMemo } from 'react';
import { useTimelineStore } from '../../stores/timeline';
import type { FaceFrameDetection, FrameAnalysisData } from '../../types/clipMetadata';
import { projectLayerUvToCanvas } from './editModeOverlayMath';
import {
  getProjectionParams,
  withClipProjectionTransform,
} from './maskOverlay/maskOverlayProjectionPlans';
import { getTimelineFaceIdentityColor } from '../timeline/utils/timelineFaceRangeOverlay';
import './FaceAnalysisOverlay.css';

interface FaceAnalysisOverlayProps {
  canvasWidth: number;
  canvasHeight: number;
}

function closestFaceFrame(
  frames: readonly FrameAnalysisData[],
  sourceTime: number,
  sampleInterval: number,
): FrameAnalysisData | null {
  let closest: FrameAnalysisData | null = null;
  let closestDistance = Infinity;
  for (const frame of frames) {
    const distance = Math.abs(frame.timestamp - sourceTime);
    if (distance < closestDistance) {
      closest = frame;
      closestDistance = distance;
    }
  }
  return closestDistance <= Math.max(0.3, (sampleInterval / 1000) * 1.1) ? closest : null;
}

function formatTimestamp(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${minutes.toString().padStart(2, '0')}:${remainder.toString().padStart(2, '0')}`;
}

function faceColor(face: FaceFrameDetection): string {
  return face.identityEligible === false
    ? '#f6bd60'
    : getTimelineFaceIdentityColor(face.personId).css;
}

function FaceAnalysisOverlayComponent({
  canvasWidth,
  canvasHeight,
}: FaceAnalysisOverlayProps) {
  const {
    clips,
    layers,
    selectedClipIds,
    playheadPosition,
    getInterpolatedTransform,
    getSourceTimeForClip,
  } = useTimelineStore();
  const selectedClipId = selectedClipIds.size > 0 ? [...selectedClipIds][0] : null;
  const clip = clips.find(candidate => candidate.id === selectedClipId);
  const activeLayer = clip
    ? layers.find(layer => layer?.sourceClipId === clip.id)
    : undefined;
  const localTime = clip ? playheadPosition - clip.startTime : 0;
  const sourceTime = useMemo(() => {
    if (!clip) return 0;
    if (typeof activeLayer?.source?.mediaTime === 'number') return activeLayer.source.mediaTime;
    const mapped = getSourceTimeForClip(clip.id, Math.max(0, localTime));
    return clip.reversed || (clip.speed ?? 1) < 0
      ? clip.outPoint - Math.abs(mapped)
      : clip.inPoint + mapped;
  }, [activeLayer?.source?.mediaTime, clip, getSourceTimeForClip, localTime]);
  const projectionLayer = useMemo(() => {
    if (!clip) return activeLayer;
    return withClipProjectionTransform(
      activeLayer,
      getInterpolatedTransform(clip.id, localTime),
    );
  }, [activeLayer, clip, getInterpolatedTransform, localTime]);
  const projection = useMemo(
    () => getProjectionParams(projectionLayer, canvasWidth, canvasHeight),
    [canvasHeight, canvasWidth, projectionLayer],
  );
  const frame = clip?.analysis?.frames
    ? closestFaceFrame(clip.analysis.frames, sourceTime, clip.analysis.sampleInterval)
    : null;
  const personLabels = new Map(
    clip?.analysis?.faceAnalysis?.people.map(person => [person.id, person.label]) ?? [],
  );
  const highlightedFace = frame?.faces?.toSorted(
    (left, right) => right.box.width * right.box.height - left.box.width * left.box.height,
  )[0];
  const highlightedLabel = highlightedFace
    ? personLabels.get(highlightedFace.personId) ?? highlightedFace.label
    : null;
  const highlightedColor = highlightedFace
    ? faceColor(highlightedFace)
    : null;
  const sourceRect = projectionLayer?.sourceRect ?? { x: 0, y: 0, width: 1, height: 1 };

  if (
    !clip
    || !activeLayer
    || clip.faceAnalysisStatus === 'none'
    || playheadPosition < clip.startTime
    || playheadPosition > clip.startTime + clip.duration
    || !frame?.faces?.length
  ) {
    return null;
  }

  const project = (point: { x: number; y: number }) => {
    const croppedPoint = {
      x: (point.x - sourceRect.x) / Math.max(0.0001, sourceRect.width),
      y: (point.y - sourceRect.y) / Math.max(0.0001, sourceRect.height),
    };
    return projection
      ? projectLayerUvToCanvas(croppedPoint, projection)
      : { x: croppedPoint.x * canvasWidth, y: croppedPoint.y * canvasHeight };
  };

  return (
    <svg
      className="face-analysis-overlay"
      viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
      aria-label="YuNet and SFace detections"
    >
      {highlightedFace && highlightedLabel && highlightedColor && (
        <g transform="translate(14 14)">
          <rect
            width={Math.min(canvasWidth - 28, Math.max(220, highlightedLabel.length * 12 + 118))}
            height={52}
            rx={7}
            fill="rgba(8, 10, 14, 0.86)"
            stroke={highlightedColor}
            strokeWidth={2}
          />
          <circle cx={19} cy={20} r={6} fill={highlightedColor} />
          <text x={33} y={24} fill="white" fontSize={16} fontFamily="system-ui, sans-serif" fontWeight={700}>
            {highlightedLabel}
          </text>
          <text x={14} y={43} fill="rgba(255,255,255,.76)" fontSize={12} fontFamily="system-ui, sans-serif">
            Face track · {Math.round(highlightedFace.confidence * 100)}% confidence · {formatTimestamp(sourceTime)}
          </text>
        </g>
      )}
      {frame.faces.map((face: FaceFrameDetection) => {
        const color = faceColor(face);
        const label = personLabels.get(face.personId) ?? face.label;
        const left = Math.max(face.box.x, sourceRect.x);
        const top = Math.max(face.box.y, sourceRect.y);
        const right = Math.min(face.box.x + face.box.width, sourceRect.x + sourceRect.width);
        const bottom = Math.min(face.box.y + face.box.height, sourceRect.y + sourceRect.height);
        if (right <= left || bottom <= top) return null;
        const corners = [
          project({ x: left, y: top }),
          project({ x: right, y: top }),
          project({ x: right, y: bottom }),
          project({ x: left, y: bottom }),
        ];
        const labelPoint = corners.toSorted((a, b) => a.y - b.y)[0]!;
        return (
          <g key={face.id}>
            <polygon
              points={corners.map(point => `${point.x},${point.y}`).join(' ')}
              fill={`${color}18`}
              stroke={color}
              strokeWidth={Math.max(2, canvasWidth / 640)}
              vectorEffect="non-scaling-stroke"
            />
            <rect
              x={labelPoint.x}
              y={Math.max(0, labelPoint.y - 24)}
              width={Math.max(92, label.length * 12)}
              height={24}
              rx={4}
              fill="rgba(0,0,0,.78)"
            />
            <text
              x={labelPoint.x + 7}
              y={Math.max(17, labelPoint.y - 7)}
              fill={color}
              fontSize={15}
              fontFamily="system-ui, sans-serif"
              fontWeight={700}
            >
              {label} {Math.round(face.confidence * 100)}%
            </text>
            {face.landmarks
              .filter(landmark =>
                landmark.x >= sourceRect.x
                && landmark.x <= sourceRect.x + sourceRect.width
                && landmark.y >= sourceRect.y
                && landmark.y <= sourceRect.y + sourceRect.height)
              .map((landmark, index) => {
              const point = project(landmark);
              return <circle key={`${face.id}-${index}`} cx={point.x} cy={point.y} r={3} fill={color} />;
              })}
          </g>
        );
      })}
    </svg>
  );
}

export const FaceAnalysisOverlay = memo(FaceAnalysisOverlayComponent);
