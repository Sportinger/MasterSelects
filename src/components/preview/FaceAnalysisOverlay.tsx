import { memo, useMemo } from 'react';
import { useTimelineStore } from '../../stores/timeline';
import type { FaceFrameDetection, FrameAnalysisData } from '../../types/clipMetadata';
import { projectLayerUvToCanvas } from './editModeOverlayMath';
import {
  getProjectionParams,
  withClipProjectionTransform,
} from './maskOverlay/maskOverlayProjectionPlans';
import './FaceAnalysisOverlay.css';

const FACE_COLORS = ['#ffd54f', '#4dd0e1', '#ff8a80', '#b39ddb', '#81c784', '#ffab40'];

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

function colorForPerson(personId: string): string {
  let hash = 0;
  for (let index = 0; index < personId.length; index += 1) {
    hash = (hash * 31 + personId.charCodeAt(index)) >>> 0;
  }
  return FACE_COLORS[hash % FACE_COLORS.length]!;
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
      {frame.faces.map((face: FaceFrameDetection) => {
        const color = colorForPerson(face.personId);
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
