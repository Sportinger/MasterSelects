import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ColorToolDock } from '../../src/components/panels/color-workspace/ColorToolDock';

vi.mock('../../src/components/panels/color/ColorEditor', () => ({
  ColorEditor: () => <div>Color editor</div>,
}));

vi.mock('../../src/components/panels/color-workspace/ColorCurvesPanel', () => ({
  ColorCurvesPanel: () => <div>Color curves</div>,
}));

function renderDock(): HTMLElement {
  render(
    <ColorToolDock
      auxMode="scopes"
      clipId="clip-1"
      clipName="Clip 1"
      onAuxModeChange={vi.fn()}
    />,
  );

  const nav = screen.getByRole('navigation', { name: 'Color tools' });
  Object.defineProperties(nav, {
    clientWidth: { configurable: true, value: 300 },
    scrollWidth: { configurable: true, value: 900 },
  });
  return nav;
}

describe('ColorToolDock scrolling', () => {
  it('maps vertical wheel movement to horizontal scrolling', () => {
    const nav = renderDock();

    fireEvent.wheel(nav, { deltaMode: 0, deltaX: 0, deltaY: 120 });

    expect(nav.scrollLeft).toBe(120);
  });

  it('pans horizontally while the middle mouse button is dragged', () => {
    const nav = renderDock();
    nav.scrollLeft = 180;

    fireEvent.pointerDown(nav, { button: 1, clientX: 200, pointerId: 7 });
    fireEvent.pointerMove(nav, { clientX: 140, pointerId: 7 });

    expect(nav).toHaveClass('is-middle-dragging');
    expect(nav.scrollLeft).toBe(240);

    fireEvent.pointerUp(nav, { clientX: 140, pointerId: 7 });
    expect(nav).not.toHaveClass('is-middle-dragging');
  });
});
