import { useRef, useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useColorGraphCanvasInteraction } from '../../src/components/panels/color/useColorGraphCanvasInteraction';
import type { ColorEditorNode } from '../../src/components/panels/color/colorEditorTypes';

const nodes: ColorEditorNode[] = [{
  id: 'grade',
  type: 'primary',
  name: 'Corrector',
  enabled: true,
  params: {},
  position: { x: 100, y: 80 },
}];

function InteractionHarness({
  onSelect = vi.fn(),
  onViewportCommit = vi.fn(),
}: {
  onSelect?: (nodeId: string) => void;
  onViewportCommit?: (viewport: { x: number; y: number; zoom: number }) => void;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 1 });
  const [, setRenderRevision] = useState(0);
  const interaction = useColorGraphCanvasInteraction({
    canvasRef,
    getNodes: () => nodes,
    selectionScope: 'clip-1',
    viewport,
    workspace: true,
    onViewportChange: nextViewport => {
      onViewportCommit(nextViewport);
      setViewport(nextViewport);
    },
    onPrimaryNodeSelect: onSelect,
  });
  return (
    <div className="color-graph-scroll">
      <div
        ref={canvasRef}
        data-testid="canvas"
        onPointerDown={interaction.startCanvasInteraction}
        onWheel={interaction.scrollCanvas}
      >
        <div
          className="color-graph-content"
          data-testid="content"
          style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})` }}
        />
        <button type="button" onClick={() => setRenderRevision(value => value + 1)}>Rerender</button>
        <output data-testid="viewport">{`${viewport.x},${viewport.y}`}</output>
        <output data-testid="selection">{interaction.marqueeSelectedNodeIds.join(',')}</output>
        {interaction.marquee && <span data-testid="marquee" />}
      </div>
    </div>
  );
}

function setCanvasRect(canvas: HTMLElement) {
  canvas.getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 800,
    bottom: 400,
    width: 800,
    height: 400,
    toJSON: () => ({}),
  });
}

describe('color graph canvas interactions', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('pans with the middle mouse button', () => {
    render(<InteractionHarness />);
    const canvas = screen.getByTestId('canvas');
    setCanvasRect(canvas);

    fireEvent.pointerDown(canvas, { button: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 145, clientY: 125 });

    expect(screen.getByTestId('viewport')).toHaveTextContent('0,0');

    fireEvent.pointerUp(window);

    expect(screen.getByTestId('viewport')).toHaveTextContent('45,25');
  });

  it('selects grade nodes with a left-drag marquee', () => {
    const onSelect = vi.fn();
    render(<InteractionHarness onSelect={onSelect} />);
    const canvas = screen.getByTestId('canvas');
    setCanvasRect(canvas);

    fireEvent.pointerDown(canvas, { button: 0, clientX: 70, clientY: 60 });
    fireEvent.pointerMove(window, { clientX: 210, clientY: 170 });

    expect(screen.getByTestId('marquee')).toBeInTheDocument();
    expect(screen.getByTestId('selection')).toHaveTextContent('grade');

    fireEvent.pointerUp(window);
    expect(onSelect).toHaveBeenCalledWith('grade');
    expect(screen.queryByTestId('marquee')).not.toBeInTheDocument();
  });

  it('scrolls the graph vertically at a reduced speed and commits after the gesture', () => {
    vi.useFakeTimers();
    const onViewportCommit = vi.fn();
    render(<InteractionHarness onViewportCommit={onViewportCommit} />);
    const canvas = screen.getByTestId('canvas');
    setCanvasRect(canvas);

    fireEvent.wheel(canvas, { deltaY: 100, deltaMode: 0 });
    act(() => vi.advanceTimersByTime(16));

    expect(screen.getByTestId('viewport')).toHaveTextContent('0,0');
    expect(screen.getByTestId('content')).toHaveStyle({ transform: 'translate(0px, -6px) scale(1)' });
    expect(onViewportCommit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Rerender' }));
    expect(screen.getByTestId('content')).toHaveStyle({ transform: 'translate(0px, -6px) scale(1)' });

    act(() => vi.advanceTimersByTime(84));
    expect(screen.getByTestId('viewport')).toHaveTextContent('0,-6');
    expect(onViewportCommit).toHaveBeenCalledTimes(1);
  });

  it('caps fast wheel bursts so a single event cannot jump the canvas', () => {
    vi.useFakeTimers();
    render(<InteractionHarness />);
    const canvas = screen.getByTestId('canvas');
    setCanvasRect(canvas);

    fireEvent.wheel(canvas, { deltaY: 2_000, deltaMode: 0 });
    act(() => vi.advanceTimersByTime(100));

    expect(screen.getByTestId('viewport')).toHaveTextContent('0,-7.2');
  });
});
