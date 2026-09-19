import { useTimelineStore } from '../../stores/timeline';
import { useLandmarkTrackingStore } from '../../stores/landmarkTrackingStore';
import { landmarkRuntime } from '../../services/landmarkTracking/landmarkRuntime';
import { faceTrackKey, samplePreciseFace } from '../../services/landmarkTracking/preciseFaceSampling';
import { getLayerSourceSize } from './maskOverlay/maskOverlayProjectionPlans';
import { trackingPreviewTransform } from '../../services/planarTracking/trackingPreviewTransform';
import './FaceAnalysisOverlay.css';

export function PreciseFaceOverlay({ canvasWidth, canvasHeight, displayWidth, displayHeight }: {
  canvasWidth: number; canvasHeight: number; displayWidth: number; displayHeight: number;
}) {
  const timeline = useTimelineStore();
  const tracking = useLandmarkTrackingStore();
  const selected = [...timeline.selectedClipIds][0];
  const clip = timeline.clips.find(c => c.id === selected);
  if (!clip || !tracking.faceOverlay[clip.id]) return null;
  const localTime = timeline.playheadPosition - clip.startTime;
  if (localTime < 0 || localTime >= clip.duration) return null;
  const layer = timeline.layers.find(l => l?.sourceClipId === clip.id);
  if (!layer || !layer.visible) return null;
  const mapped = timeline.getSourceTimeForClip(clip.id, localTime);
  const sourceTime = typeof layer.source?.mediaTime === 'number' ? layer.source.mediaTime
    : clip.reversed || (clip.speed ?? 1) < 0 ? clip.outPoint - Math.abs(mapped) : clip.inPoint + mapped;
  const series = landmarkRuntime.getSeries(faceTrackKey(clip.id));
  if (series?.sourceId !== (clip.source?.mediaFileId ?? clip.mediaFileId ?? clip.id)) return null;
  const frame = samplePreciseFace(series, sourceTime, tracking.faceSmoothing);
  const face = frame?.faces[0] ?? [];
  const mapping = trackingPreviewTransform(timeline.getInterpolatedTransform(clip.id, localTime),
    getLayerSourceSize(layer, { width: canvasWidth, height: canvasHeight }), { width: canvasWidth, height: canvasHeight });
  const rect = layer.sourceRect ?? { x: 0, y: 0, width: 1, height: 1 };
  const projected = face.map(point => {
    if (point.x < rect.x || point.x > rect.x + rect.width || point.y < rect.y || point.y > rect.y + rect.height) return null;
    const uv = { x: (point.x - rect.x) / rect.width, y: (point.y - rect.y) / rect.height };
    const projected = mapping.toComposition(uv);
    return { x: projected.x * canvasWidth, y: projected.y * canvasHeight };
  });
  const size = Math.max(1, canvasWidth / 700);
  return <svg className="face-analysis-overlay" viewBox={`0 0 ${canvasWidth} ${canvasHeight}`} aria-label="Precise face control net"
    data-face-points={face.length} data-source-time={frame?.time}
    style={{ overflow: 'hidden', width: displayWidth, height: displayHeight, left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}>
    <g fill="#b9dce5" fillOpacity={0.7}>
      {projected.map((p, i) => p && <circle key={i} cx={p.x} cy={p.y} r={size} />)}
    </g>
    {series?.faceTracking?.contours.map(contour => <path key={contour.name} stroke={contour.color} fill="none" strokeWidth={size * 1.4}
      d={contour.edges.map(([a, b]) => {
        const start = projected[a], end = projected[b];
        return start && end ? `M${start.x},${start.y}L${end.x},${end.y}` : '';
      }).join('')} />)}
    <text x={16} y={30} fontSize={Math.max(14, canvasWidth / 65)} fill={face.length ? '#84ffb0' : '#ffc76a'}>
      {face.length ? `FACE · ${face.length} points · ${frame!.time.toFixed(3)}s` : 'FACE · no detection / outside tracked range'}
    </text>
  </svg>;
}
