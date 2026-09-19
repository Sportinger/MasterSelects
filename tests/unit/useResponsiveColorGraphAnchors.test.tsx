import { useRef } from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ColorNode } from '../../src/types/colorCorrection';
import { useResponsiveColorGraphAnchors } from '../../src/components/panels/color/useResponsiveColorGraphAnchors';

let resizeCallback: ResizeObserverCallback | undefined;

class ResizeObserverMock {
  constructor(callback: ResizeObserverCallback) {
    resizeCallback = callback;
  }

  observe() {}
  disconnect() {}
  unobserve() {}
}

function Harness({ nodes, moveNode }: {
  nodes: ColorNode[];
  moveNode: (clipId: string, nodeId: string, position: { x: number; y: number }) => void;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  useResponsiveColorGraphAnchors({
    canvasRef,
    clipId: 'clip-1',
    enabled: true,
    nodes,
    viewport: { x: 0, y: 0, zoom: 1 },
    moveNode,
  });
  return <div ref={canvasRef} />;
}

describe('responsive Color graph anchors', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resizeCallback = undefined;
  });

  it('pins original and additional anchors to their matching canvas sides and lanes', () => {
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    const moveNode = vi.fn();
    const nodes = [
      { id: 'input', type: 'input', position: { x: 100, y: 80 } },
      { id: 'source-a', type: 'source', position: { x: 300, y: 250 } },
      { id: 'source-b', type: 'source', position: { x: 350, y: 300 } },
      { id: 'grade', type: 'primary', position: { x: 320, y: 120 } },
      { id: 'output', type: 'output', position: { x: 500, y: 80 } },
      { id: 'alpha', type: 'alpha-output', position: { x: 400, y: 260 } },
    ] as ColorNode[];
    const view = render(<Harness nodes={nodes} moveNode={moveNode} />);
    const canvas = view.container.firstElementChild as HTMLDivElement;

    act(() => {
      resizeCallback?.([
        { target: canvas, contentRect: { width: 900 } as DOMRectReadOnly } as ResizeObserverEntry,
      ], {} as ResizeObserver);
    });

    expect(moveNode).toHaveBeenCalledWith('clip-1', 'input', { x: 8, y: 80 });
    expect(moveNode).toHaveBeenCalledWith('clip-1', 'source-a', { x: 8, y: 116 });
    expect(moveNode).toHaveBeenCalledWith('clip-1', 'source-b', { x: 8, y: 152 });
    expect(moveNode).toHaveBeenCalledWith('clip-1', 'output', { x: 878, y: 80 });
    expect(moveNode).toHaveBeenCalledWith('clip-1', 'alpha', { x: 878, y: 116 });
    expect(moveNode).not.toHaveBeenCalledWith(
      'clip-1',
      'grade',
      expect.anything(),
    );
  });
});
