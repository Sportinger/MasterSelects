import { readTimelineRuntimeState } from '../../../../services/timeline/timelineRuntimeCoordinator';
import { memo, useEffect, useMemo, useRef } from 'react';
import type { Keyframe } from '../../../../types/keyframes';
import type { NodeGraphNode } from '../../../../types/nodeGraph';
import { useTimelineStore } from '../../../../stores/timeline';
import { interpolateKeyframes } from '../../../../utils/keyframeInterpolation';
import { clipLocalToKeyframeTime } from '../../../../services/flock/time/flockKeyframeTime';
import { requestNodeAnimation } from '../../../../services/nodeGraph/nodeWorkspaceNavigation';
import './NodeAnimationBadge.css';

const EMPTY: Keyframe[] = [];
/** A small transport readout, without rebuilding the graph on playback ticks. */
export const NodeAnimationBadge = memo(function NodeAnimationBadge({ node, top }: { node: NodeGraphNode; top: number }) {
  const animation = node.animation!;
  const clip = useTimelineStore(state => state.clips.find(candidate => candidate.id === animation.clipId));
  const keys = useTimelineStore(state => state.clipKeyframes.get(animation.clipId) ?? EMPTY);
  const sourceTime = useTimelineStore(state => state.getSourceTimeForClip);
  const button = useRef<HTMLButtonElement>(null);
  const property = animation.channels[0]?.property;
  const path = useMemo(() => {
    if (!clip || !property) return '';
    const values = Array.from({ length: 41 }, (_, index) => interpolateKeyframes(keys, property,
      clipLocalToKeyframeTime(clip, property, index / 40 * clip.duration, sourceTime), 0));
    const min = Math.min(...values), span = Math.max(...values) - min || 1;
    return values.map((value, index) => `${index ? 'L' : 'M'}${index / 40 * 100},${19 - (value - min) / span * 16}`).join(' ');
  }, [clip, property, keys, sourceTime]);

  useEffect(() => {
    const root = button.current;
    if (!root || !clip || !property) return;
    const label = root.querySelector('strong')!;
    const cursor = root.querySelector('line')!;
    let previous: number[] | undefined;
    let lastUpdate = -Infinity;
    let frame: number | undefined, fade: ReturnType<typeof setTimeout> | undefined;
    let visible = typeof IntersectionObserver === 'undefined';
    const update = () => {
      frame = undefined;
      if (!visible || document.hidden) return;
      const playhead = readTimelineRuntimeState(useTimelineStore).playheadPosition;
      const local = Math.max(0, Math.min(clip.duration, playhead - clip.startTime));
      const values = animation.channels.map(channel => interpolateKeyframes(keys, channel.property,
        clipLocalToKeyframeTime(clip, channel.property, local, sourceTime), 0));
      label.textContent = String(Number(values[0].toFixed(3)));
      cursor.setAttribute('transform', `translate(${local / Math.max(clip.duration, 0.001) * 100} 0)`);
      if (previous && values.some((value, index) => Math.abs(value - previous![index]) > 1e-6)) {
        root.dataset.changing = 'true';
        clearTimeout(fade);
        fade = setTimeout(() => { root.dataset.changing = 'false'; }, 180);
      }
      previous = values;
      lastUpdate = performance.now();
    };
    const refresh = () => { if (frame !== undefined) cancelAnimationFrame(frame); update(); };
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
      visible = entries[0]?.isIntersecting ?? false;
      refresh();
    }, { root: root.closest('.node-workspace-canvas') });
    observer?.observe(root);
    update();
    const unsubscribe = useTimelineStore.subscribe((state, before) => {
      if (state.playheadPosition === before.playheadPosition && state.isPlaying === before.isPlaying) return;
      if (!visible || document.hidden) return;
      if (!state.isPlaying || state.isPlaying !== before.isPlaying) { refresh(); return; }
      if (frame === undefined && performance.now() - lastUpdate >= 80) frame = requestAnimationFrame(update);
    });
    document.addEventListener('visibilitychange', refresh);
    return () => {
      unsubscribe(); observer?.disconnect(); clearTimeout(fade);
      if (frame !== undefined) cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [animation, clip, property, keys, sourceTime]);

  if (!clip || !property) return null;
  return <button ref={button} type="button" className="node-animation-badge" style={{ top }}
    aria-label={`Edit animation for ${node.label}, ${animation.channels.length} ${animation.channels.length === 1 ? 'curve' : 'curves'}`}
    title={`Open animated parameters · Preview: ${property}`}
    onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}
    onClick={event => {
      event.stopPropagation();
      requestNodeAnimation(clip.id, node.id);
      if (event.detail > 0) event.currentTarget.blur();
    }}>
    <span className="node-animation-badge-title"><span>◇ Animation</span><span>{animation.channels.length} {animation.channels.length === 1 ? 'curve' : 'curves'}</span></span>
    <span className="node-animation-badge-preview">
      <svg viewBox="0 0 100 22" aria-hidden="true"><path d={path} /><line x1="0" x2="0" y1="0" y2="22" /></svg>
      <strong />
    </span>
  </button>;
});
