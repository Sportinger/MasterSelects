import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CurveEditor } from '../../src/components/timeline/CurveEditor';
import { createMockKeyframe } from '../helpers/mockData';

describe('curve handles after moving keyframes', () => {
  it('keeps both displayed control times inside the shortened keyframe segment', () => {
    const left = createMockKeyframe({ id: 'left', time: 0, value: 0, property: 'opacity', easing: 'bezier', handleOut: { x: 1.5, y: 0.3 } });
    const right = createMockKeyframe({ id: 'right', time: 4, value: 1, property: 'opacity', handleIn: { x: -1.5, y: -0.3 } });
    const props = {
      trackId: 'video-1', clipId: 'clip-1', property: 'opacity' as const,
      clipStartTime: 0, clipDuration: 4, width: 400,
      selectedKeyframeIds: new Set(['left', 'right']), onSelectKeyframe: vi.fn(),
      onMoveKeyframe: vi.fn(), onUpdateBezierHandle: vi.fn(),
      timeToPixel: (time: number) => time * 100, pixelToTime: (pixel: number) => pixel / 100,
    };
    const { container, rerender } = render(<CurveEditor {...props} keyframes={[left, right]} />);
    const handleXs = () => [...container.querySelectorAll('.curve-editor-handle')].map(handle => Number(handle.getAttribute('cx')));
    expect(handleXs()).toEqual([150, 250]);
    rerender(<CurveEditor {...props} keyframes={[left, { ...right, time: 0.5 }]} />);
    expect(handleXs()).toEqual([25, 25]);
    expect(left.handleOut?.x).toBe(1.5);
    expect(right.handleIn?.x).toBe(-1.5);
  });
});
