import { memo, useMemo } from 'react';
import type { AnimatableProperty, Keyframe, TimelineClip } from '../../../../types';
import { useTimelineStore } from '../../../../stores/timeline';
import { interpolateKeyframes } from '../../../../utils/keyframeInterpolation';
import { clipLocalToKeyframeTime, getKeyframeTimeBasis } from '../../../../services/flock/time/flockKeyframeTime';
import type { NodeGraphNode } from '../../../../types/nodeGraph';
import { keyframeNodeParameters } from '../../../../services/nodeGraph/keyframeNodeParameters';
import { keyframesForProperty } from '../../../../utils/keyframePropertyIndex';
import { useKeyframeCurveReadout } from './useKeyframeCurveReadout';
import './KeyframeNode.css';

const EMPTY: Keyframe[] = [];
export const KeyframeCurve = memo(function KeyframeCurve({ clip, property, value = 0, compact = false }: {
  clip: TimelineClip; property: AnimatableProperty; value?: number; compact?: boolean;
}) {
  const keys = useTimelineStore(s => s.clipKeyframes.get(clip.id) ?? EMPTY);
  const sourceTime = useTimelineStore(s => s.getSourceTimeForClip);
  const ref = useKeyframeCurveReadout(clip, property, keys, value, compact, sourceTime);
  const plot = useMemo(() => {
    const points = Array.from({ length: 81 }, (_, i) => {
      const time = i / 80 * clip.duration;
      return interpolateKeyframes(keys, property, clipLocalToKeyframeTime(clip, property, time, sourceTime), value);
    });
    const min = Math.min(...points), max = Math.max(...points), span = max - min || 1;
    return { path: points.map((v, i) => `${i ? 'L' : 'M'}${4 + i / 80 * 172},${46 - (v - min) / span * 36}`).join(' '), min, max };
  }, [clip, property, keys, sourceTime, value]);
  const count = keyframesForProperty(keys, property).length;
  return <div ref={ref} className={`keyframe-node-curve${compact ? ' compact' : ''}`}>
    <div className="keyframe-node-value"><strong /><span>{count} keys · {getKeyframeTimeBasis(property) === 'source' ? 'source time' : 'clip time'}</span></div>
    <svg viewBox="0 0 180 54" role="img" aria-label="Animation curve">
      <path className="keyframe-node-grid" d="M4 10H176 M4 28H176 M4 46H176" />
      <path className="keyframe-node-path" d={plot.path} />
      <line className="keyframe-node-playhead" x1="4" x2="4" y1="4" y2="50" />
    </svg>
  </div>;
});

export function KeyframeNodeCardPreview({ node }: { node: NodeGraphNode }) {
  const clip = useTimelineStore(s => s.clips.find(c => c.id === node.params?.targetClipId));
  const source = node.outputs[0]?.metadata?.animationProperty;
  const value = useMemo(() => clip && typeof source === 'string'
    ? keyframeNodeParameters(clip).find(p => p.property === source)?.value : undefined, [clip, source]);
  if (!clip || typeof source !== 'string') return <div className="keyframe-node-card-empty">Choose a parameter →</div>;
  const property = source as AnimatableProperty;
  return <KeyframeCurve clip={clip} property={property} value={value} compact />;
}
