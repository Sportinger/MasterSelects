import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/components/dock/DockSplitPane', () => ({
  DockSplitPane: ({ split }: { split: { id: string } }) => {
    const [mountedForId] = useState(split.id);
    return <div data-testid="mounted-split">{mountedForId}</div>;
  },
}));

vi.mock('../../src/components/dock/DockTabPane', () => ({
  DockTabPane: ({ group }: { group: { id: string } }) => <div>{group.id}</div>,
}));

import { DockNode } from '../../src/components/dock/DockNode';
import type { DockSplit } from '../../src/types/dock';

function createSplit(id: string): DockSplit {
  return {
    kind: 'split',
    id,
    direction: 'horizontal',
    ratio: 0.5,
    children: [
      { kind: 'tab-group', id: `${id}-left`, panels: [], activeIndex: 0 },
      { kind: 'tab-group', id: `${id}-right`, panels: [], activeIndex: 0 },
    ],
  };
}

describe('DockNode identity', () => {
  it('remounts the rendered dock component when the layout node changes', () => {
    const { rerender } = render(<DockNode node={createSplit('desktop-root')} />);
    expect(screen.getByTestId('mounted-split')).toHaveTextContent('desktop-root');

    rerender(<DockNode node={createSplit('mobile-root')} />);
    expect(screen.getByTestId('mounted-split')).toHaveTextContent('mobile-root');
  });
});
