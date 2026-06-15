import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { TransitionsPanel } from '../../src/components/panels/TransitionsPanel';

function getRenderedItemLabels(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('.transition-item-name'))
    .map((item) => item.textContent ?? '');
}

function getRenderedItemCounts(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('.transition-item-type-count'))
    .map((item) => item.textContent ?? '');
}

describe('TransitionsPanel', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders transition families in separate 2D and 3D sections', () => {
    const { container } = render(<TransitionsPanel />);

    expect(screen.getByRole('button', { name: /2D13/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /3D8/i })).toBeInTheDocument();
    expect(getRenderedItemLabels(container)).toEqual([
      'Dissolve',
      'Dip',
      'Wipe',
      'Iris',
      'Push',
      'Slide',
      'Light',
      'Stylize',
      'Rotate',
      'Glitch',
      'Pattern',
      'Zoom',
      'Motion Blur',
      'Flip',
      'Tumble',
      'Roll',
      'Spin',
      'Cube',
      'Door',
      'Fold',
      'Peel',
    ]);
    expect(getRenderedItemCounts(container)).toEqual([
      '7',
      '3',
      '8',
      '7',
      '4',
      '4',
      '11',
      '8',
      '3',
      '9',
      '13',
      '4',
      '2',
      '2',
      '1',
      '1',
      '2',
      '1',
      '1',
      '2',
      '1',
    ]);
    expect(screen.getByText('Cube').closest('.transition-item')?.getAttribute('draggable')).toBe('false');
    expect(container.querySelector('.transition-capability-planned')).not.toBeNull();
  });

  it('keeps search results visible when a matching section was collapsed', () => {
    const { container } = render(<TransitionsPanel />);

    fireEvent.click(screen.getByRole('button', { name: /3D8/i }));
    expect(getRenderedItemLabels(container)).not.toContain('Flip');

    fireEvent.change(screen.getByLabelText('Search transitions'), {
      target: { value: 'barrel depth' },
    });

    expect(getRenderedItemLabels(container)).toEqual(['Roll']);
  });

  it('expands family cards into draggable transition variants and collapses on panel leave', () => {
    const { container } = render(<TransitionsPanel />);
    const panel = container.querySelector('.transitions-panel');
    expect(panel).not.toBeNull();

    fireEvent.click(screen.getByText('Flip'));

    expect(getRenderedItemLabels(container)).toContain('Flip Horizontal');
    expect(getRenderedItemLabels(container)).toContain('Flip Vertical');
    expect(screen.getByText('Flip Horizontal').closest('.transition-item')?.getAttribute('draggable')).toBe('true');

    fireEvent.mouseLeave(panel!);

    expect(getRenderedItemLabels(container)).not.toContain('Flip Horizontal');
    expect(getRenderedItemLabels(container)).not.toContain('Flip Vertical');
  });

  it('keeps planned pattern variants disabled while runtime multi-panel variants are draggable', () => {
    const { container } = render(<TransitionsPanel />);

    fireEvent.click(screen.getByText('Pattern'));

    expect(getRenderedItemLabels(container)).toContain('Puzzle Push');
    expect(screen.getByText('Puzzle Push').closest('.transition-item')?.getAttribute('draggable')).toBe('true');
    expect(getRenderedItemLabels(container)).toContain('Magnetic Tiles');
    expect(screen.getByText('Magnetic Tiles').closest('.transition-item')?.getAttribute('draggable')).toBe('true');
    expect(screen.getByText('Shatter Glass').closest('.transition-item')?.getAttribute('draggable')).toBe('false');
    expect(screen.getByText('Shatter Glass').closest('.transition-item')?.getAttribute('aria-disabled')).toBe('true');
  });
});
