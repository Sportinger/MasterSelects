import { readTimelineRuntimeState } from '../../../../services/timeline/timelineRuntimeCoordinator';
import { useEffect, useRef } from 'react';
import type { AnimatableProperty } from '../../../../types/animationProperties';
import type { Keyframe } from '../../../../types/keyframes';
import type { TimelineClip } from '../../../../types/timeline';
import { useTimelineStore } from '../../../../stores/timeline';
import { interpolateKeyframes } from '../../../../utils/keyframeInterpolation';
import { clipLocalToKeyframeTime, type SourceOffsetResolver } from '../../../../services/flock/time/flockKeyframeTime';

/** Transport changes update only the readout/cursor, never the static React curve. */
export function useKeyframeCurveReadout(clip: TimelineClip, property: AnimatableProperty, keys: Keyframe[],
  value: number, compact: boolean, sourceTime: SourceOffsetResolver) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const label = root.querySelector('strong')!;
    const svg = root.querySelector('svg')!;
    const cursor = root.querySelector('.keyframe-node-playhead')!;
    const interval = 1000 / (compact ? 12 : 30);
    let visible = typeof IntersectionObserver === 'undefined';
    let frame: number | undefined;
    let lastUpdate = -Infinity;
    let lastText = '', lastX = NaN;
    const cancelFrame = () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = undefined;
    };
    const update = () => {
      frame = undefined;
      if (!visible || document.hidden) return;
      const local = Math.max(0, Math.min(clip.duration, readTimelineRuntimeState(useTimelineStore).playheadPosition - clip.startTime));
      const current = interpolateKeyframes(keys, property, clipLocalToKeyframeTime(clip, property, local, sourceTime), value);
      const text = String(Number(current.toFixed(3)));
      const x = local / Math.max(clip.duration, 0.001) * 172;
      if (text !== lastText) {
        label.textContent = text;
        svg.setAttribute('aria-label', `Animation curve, current value ${text}`);
        lastText = text;
      }
      if (x !== lastX) { cursor.setAttribute('transform', `translate(${x} 0)`); lastX = x; }
      lastUpdate = performance.now();
    };
    const refresh = () => { cancelFrame(); update(); };
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
      visible = entries[0]?.isIntersecting ?? false;
      refresh();
    }, { root: root.closest('.node-workspace-canvas') });
    observer?.observe(root);
    update();
    const unsubscribe = useTimelineStore.subscribe((state, previous) => {
      if (state.playheadPosition === previous.playheadPosition && state.isPlaying === previous.isPlaying) return;
      if (!visible || document.hidden) return;
      // Scrubbing and the final stopped frame remain exact. Small overview
      // readouts need fewer updates than the video and selected inspector.
      if (!state.isPlaying || state.isPlaying !== previous.isPlaying) { refresh(); return; }
      if (frame === undefined && performance.now() - lastUpdate >= interval) frame = requestAnimationFrame(update);
    });
    document.addEventListener('visibilitychange', refresh);
    return () => {
      unsubscribe(); cancelFrame(); observer?.disconnect();
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [clip, property, keys, value, compact, sourceTime]);
  return ref;
}
