import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NodeSummarySegments, SUMMARY_DOM_LIMIT } from '../../src/components/panels/nodes/canvas/NodeSummarySegments';
import { compositionNode } from '../../src/services/nodeGraph/composition/compositionGraphPrimitives';
import { getNodeSummarySegments } from '../../src/components/panels/nodes/canvas/canvasGeometry';
import { hitSummarySegment } from '../../src/components/panels/nodes/canvas/hitSummarySegment';

afterEach(cleanup);
const strip = (count: number) => ({ ...compositionNode(undefined, 'track', 'Video 1', { kind: 'composition-track', trackId: 'v' }, { x: 300, y: 80 }),
  summary: { timeAxis: { width: 1620, duration: count, pixelsPerSecond: 1600 / count },
    segments: Array.from({ length: count }, (_, i) => ({ id: `s${i}`, clipId: `c${i}`, nodeId: `comp:clip:c${i}`,
      start: i / count, end: (i + 1) / count, label: `Clip ${i + 1}` })) } });

describe('track strip segment interaction', () => {
  it('selects once with keyboard Enter/Space and preserves keyboard focus', async () => {
    const select = vi.fn(), user = userEvent.setup();
    render(<NodeSummarySegments node={strip(3)} canvasRendered onSelect={select} />);
    await user.tab();
    const first = screen.getByRole('button', { name: 'Select Clip 1' });
    expect(document.activeElement).toBe(first);
    await user.keyboard('{Enter}');
    expect(select).toHaveBeenLastCalledWith('track', 's0', false);
    await user.keyboard(' ');
    expect(select).toHaveBeenCalledTimes(2);
    expect(document.activeElement).toBe(first);
  });

  it('forwards additive pointer selection once and clears transient pointer focus', () => {
    const select = vi.fn();
    render(<NodeSummarySegments node={strip(3)} canvasRendered onSelect={select} />);
    const second = screen.getByRole('button', { name: 'Select Clip 2' }); second.focus();
    fireEvent.click(second, { detail: 1, shiftKey: true });
    expect(select).toHaveBeenCalledExactlyOnceWith('track', 's1', true);
    expect(document.activeElement).not.toBe(second);
  });

  it('keeps 1000 pieces canvas-painted with one keyboard target and exact pointer hits at the far right', async () => {
    const node = strip(1000), select = vi.fn(), user = userEvent.setup();
    render(<NodeSummarySegments node={node} canvasRendered onSelect={select} />);
    expect(node.summary.segments.length).toBeGreaterThan(SUMMARY_DOM_LIMIT);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    await user.tab(); await user.keyboard('{End}{Enter}');
    expect(select).toHaveBeenLastCalledWith('track', 's999', false);
    await user.keyboard('{ArrowLeft} ');
    expect(select).toHaveBeenLastCalledWith('track', 's998', false);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    const last = getNodeSummarySegments(node)!.segments[999];
    expect(last.width).toBeCloseTo(1.6);
    expect(hitSummarySegment([node], node.layout.x + last.x + last.width / 2,
      node.layout.y + last.y + last.height / 2, 0.4)?.segmentId).toBe('s999');
  });
});
