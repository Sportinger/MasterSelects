import { useRef } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useColorGraphNodeDrag } from '../../src/components/panels/color/useColorGraphNodeDrag';
import type {
  ColorEditorEdge,
  ColorEditorNode,
} from '../../src/components/panels/color/colorEditorTypes';

const inputNode: ColorEditorNode = {
  id: 'input',
  type: 'input',
  name: 'Input',
  position: { x: 10, y: 80 },
  params: {},
  outputs: [{ id: 'out', label: 'Image', type: 'texture' }],
};
const gradeNode: ColorEditorNode = {
  id: 'grade',
  type: 'primary',
  name: 'Corrector',
  position: { x: 100, y: 80 },
  params: {},
  inputs: [{ id: 'in', label: 'Image', type: 'texture' }],
};
const edge: ColorEditorEdge = {
  id: 'edge-1',
  fromNodeId: 'input',
  fromPortId: 'out',
  toNodeId: 'grade',
  toPortId: 'in',
  type: 'texture',
};

function NodeDragHarness({ onDragEnd }: {
  onDragEnd: (nodeId: string, position: { x: number; y: number } | null) => void;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const startNodeDrag = useColorGraphNodeDrag({
    canvasRef,
    getNodes: () => [inputNode, gradeNode],
    getEdges: () => [edge],
    zoom: 2,
    onDragStart: vi.fn(),
    onDragEnd,
  });
  return (
    <div ref={canvasRef}>
      <svg><g data-color-edge-id="edge-1"><path data-testid="edge" d="" /></g></svg>
      <div
        data-testid="grade"
        data-color-node-id="grade"
        onPointerDown={event => startNodeDrag(event, gradeNode)}
      />
    </div>
  );
}

describe('color graph node drag', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('previews in the DOM and commits the store position only once on release', () => {
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      frame = callback;
      return 1;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const onDragEnd = vi.fn();
    render(<NodeDragHarness onDragEnd={onDragEnd} />);
    const grade = screen.getByTestId('grade');

    fireEvent.pointerDown(grade, { button: 0, clientX: 200, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 240, clientY: 120 });

    expect(onDragEnd).not.toHaveBeenCalled();
    act(() => frame?.(0));
    expect(grade).toHaveStyle({ left: '120px' });
    expect(screen.getByTestId('edge').getAttribute('d')).not.toBe('');

    fireEvent.pointerUp(window);
    expect(onDragEnd).toHaveBeenCalledTimes(1);
    expect(onDragEnd).toHaveBeenCalledWith('grade', { x: 120, y: 90 });
  });

  it('allows nodes to be moved beyond the positive graph origin', () => {
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      frame = callback;
      return 1;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const onDragEnd = vi.fn();
    render(<NodeDragHarness onDragEnd={onDragEnd} />);
    const grade = screen.getByTestId('grade');

    fireEvent.pointerDown(grade, { button: 0, clientX: 200, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: -100, clientY: -100 });
    act(() => frame?.(0));
    fireEvent.pointerUp(window);

    expect(grade).toHaveStyle({ left: '-50px', top: '-20px' });
    expect(onDragEnd).toHaveBeenCalledWith('grade', { x: -50, y: -20 });
  });
});
