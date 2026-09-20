import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TimelineKeyframes } from '../../src/components/timeline/TimelineKeyframes';
import { ClipKeyframeTicks } from '../../src/components/timeline/components/ClipKeyframeTicks';
import { ClipKeyframeTicks as ShellKeyframeTicks } from '../../src/components/timeline/interactionShell/ClipKeyframeTicks';
import type { ClipInteractionShellCommandContext } from '../../src/components/timeline/interactionShell/types';
import { CurveEditor } from '../../src/components/timeline/CurveEditor';
import { GlobalCurveEditor } from '../../src/components/timeline/GlobalCurveEditor';
import { buildCurveGraphModel } from '../../src/components/timeline/utils/curveGraphModel';
import { propertyRegistry } from '../../src/services/properties';
import { useTimelineStore } from '../../src/stores/timeline';
import { createMockClip, createMockKeyframe } from '../helpers/mockData';

const originalClips = useTimelineStore.getState().clips;
afterEach(() => { cleanup(); vi.restoreAllMocks(); useTimelineStore.setState({ clips: originalClips }); });
const clip = createMockClip({ id: 'baked', trackId: 'video-1', duration: 10, videoInspectorSections: { stabilization: false } });
const keys = (count: number) => Array.from({ length: count }, (_, index) => createMockKeyframe({
  clipId: clip.id, id: index === count - 1 ? 'manual' : `face-stabilize:${index}`,
  property: 'rotation.z', time: index / 30, value: index, easing: 'linear',
}));

describe('stabilization bypass display', () => {
  it('updates clip shell markers when bypass changes outside the lightweight clip reference', () => {
    useTimelineStore.setState({ clips: [clip] });
    const frames = keys(2);
    const context = { clip: { id: clip.id, duration: clip.duration }, track: { locked: false },
      geometry: { clip: { width: 300 } }, activeModules: { keyframe: { enabled: true, keyframes: frames,
        keyframeGroups: frames.map(kf => ({ time: kf.time, keyframeIds: [kf.id] })) } },
    } as ClipInteractionShellCommandContext;
    const result = render(<ShellKeyframeTicks context={context} />);
    expect(result.getAllByRole('button')[0]).toHaveClass('bypassed');
    expect(result.getAllByRole('button')[1]).not.toHaveClass('bypassed');
    act(() => useTimelineStore.setState({ clips: [{ ...clip, videoInspectorSections: { stabilization: true } }] }));
    expect(result.container.querySelector('.bypassed')).toBeNull();
  });
  it.each([3, 180])('updates %i timeline markers from the bypass without changing keys or disabling edits', count => {
    const fills: string[] = [];
    const context = { setTransform: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(),
      fillStyle: '', stroke: vi.fn(), fill() { fills.push(this.fillStyle); } };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
    const frames = keys(count), before = JSON.stringify(frames), onSelect = vi.fn();
    const owner = document.createElement('div');
    const view = (bypassed: boolean) => <TimelineKeyframes trackId={clip.trackId} property="rotation.z"
      clips={[{ ...clip, videoInspectorSections: { stabilization: !bypassed } }]} clipKeyframes={new Map([[clip.id, frames]])}
      selectedKeyframeIds={new Set(['face-stabilize:0'])} clipDrag={null} scrollX={0} timelineRef={{ current: owner }}
      onSelectKeyframe={onSelect} onMoveKeyframe={vi.fn()} onDeleteKeyframes={vi.fn()} onUpdateKeyframe={vi.fn()}
      onToggleCurveExpanded={vi.fn()} timeToPixel={time => time * 100} pixelToTime={pixel => pixel / 100} isRowHovered />;
    const result = render(view(true));
    if (count < 120) {
      expect(result.container.querySelectorAll('.keyframe-diamond.bypassed')).toHaveLength(count - 1);
      expect(result.container.querySelector('[data-keyframe-id="manual"]')).not.toHaveClass('bypassed');
      fireEvent.mouseDown(result.container.querySelector('[data-keyframe-id="face-stabilize:1"]')!, { button: 0 });
      expect(onSelect).toHaveBeenCalledWith('face-stabilize:1', false);
      fireEvent.mouseUp(window);
    } else {
      expect(result.container.querySelector('canvas')).toHaveAttribute('data-bypassed-count', String(count - 1));
      expect(fills.filter(color => color === '#777777')).toHaveLength(count - 1);
      expect(context.stroke).toHaveBeenCalled(); // Selection is visible on a gray key.
    }
    result.rerender(view(false));
    expect(result.container.querySelectorAll('.keyframe-diamond.bypassed')).toHaveLength(0);
    if (count >= 120) expect(result.container.querySelector('canvas')).toHaveAttribute('data-bypassed-count', '0');
    expect(JSON.stringify(frames)).toBe(before);
  });

  it('keeps a mixed clip marker active while marking fully bypassed groups', () => {
    const result = render(<ClipKeyframeTicks groups={[
      { time: 1, keyframeIds: ['face-stabilize:0', 'face-stabilize:1'] },
      { time: 2, keyframeIds: ['face-stabilize:2', 'manual'] },
    ]} bypassedKeyframeIds={new Set(['face-stabilize:0', 'face-stabilize:1', 'face-stabilize:2'])}
      displayDuration={10} isTrackLocked={false} formatTime={String} onTickMouseDown={vi.fn()} />);
    const buttons = result.getAllByRole('button');
    expect(buttons[0]).toHaveClass('bypassed');
    expect(buttons[1]).not.toHaveClass('bypassed');
    expect(buttons[1]).toHaveAccessibleName(/1 transform keyframes bypassed/);
  });

  it('marks the same inactive points and segments in the timeline and node curve editor', () => {
    useTimelineStore.setState({ clips: [clip] });
    const frames = keys(4);
    const result = render(<CurveEditor trackId={clip.trackId} clipId={clip.id} property="rotation.z" keyframes={frames}
      clipStartTime={0} clipDuration={10} width={500} selectedKeyframeIds={new Set()}
      onSelectKeyframe={vi.fn()} onMoveKeyframe={vi.fn()} onUpdateBezierHandle={vi.fn()}
      timeToPixel={time => time * 100} pixelToTime={pixel => pixel / 100} />);
    expect(result.container.querySelectorAll('.keyframe-bypassed')).toHaveLength(3);
    expect(result.container.querySelectorAll('.curve-editor-curve.bypassed')).toHaveLength(3);
    expect(result.container.querySelectorAll('.curve-editor-keyframe')).toHaveLength(4);
  });

  it('propagates bypass into the global graph while preserving active manual points and selection', () => {
    const frames = keys(4), selected = new Set(['face-stabilize:0']);
    const makeModel = (bypassed: boolean) => buildCurveGraphModel({
      propertyTargets: [{ clipId: clip.id, path: 'rotation.z', descriptor: propertyRegistry.getDescriptor('rotation.z', clip)! }],
      clips: [{ ...clip, videoInspectorSections: { stabilization: !bypassed } }],
      clipKeyframes: new Map([[clip.id, frames]]), selectedKeyframeIds: selected,
    });
    const view = (bypassed: boolean) => <GlobalCurveEditor model={makeModel(bypassed)} width={500} height={200}
      timeToPixel={time => time * 100} pixelToTime={pixel => pixel / 100} onSelectKeyframe={vi.fn()}
      applyTimelineEditOperation={vi.fn()} />;
    const result = render(view(true));
    expect(result.container.querySelectorAll('.keyframe-bypassed')).toHaveLength(3);
    expect(result.container.querySelector('.selected[data-keyframe-id="face-stabilize:0"]')).toHaveStyle({ fill: 'var(--text-muted)' });
    expect(result.container.querySelector('[data-keyframe-id="manual"]')).not.toHaveStyle({ fill: 'var(--text-muted)' });
    result.rerender(view(false));
    expect(result.container.querySelectorAll('.keyframe-bypassed')).toHaveLength(0);
    expect(result.container.querySelectorAll('.curve-editor-curve.bypassed')).toHaveLength(0);
  });
});
