import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  activatePanelType: vi.fn(),
  store: {
    clips: [{
      id: 'clip-1',
      name: 'Interview.mov',
      colorCorrection: {
        version: 1 as const,
        enabled: true,
        activeVersionId: 'version-main',
        versions: [{
          id: 'version-main',
          name: 'A',
          nodes: [
            {
              id: 'input',
              type: 'input' as const,
              name: 'Input',
              enabled: true,
              params: {},
              position: { x: 0, y: 0 },
            },
            {
              id: 'primary-1',
              type: 'primary' as const,
              name: 'Base correction',
              enabled: true,
              params: {},
              position: { x: 100, y: 0 },
            },
            {
              id: 'wheels-1',
              type: 'wheels' as const,
              name: 'Skin tone',
              enabled: true,
              params: {},
              position: { x: 200, y: 0 },
            },
            {
              id: 'output',
              type: 'output' as const,
              name: 'Output',
              enabled: true,
              params: {},
              position: { x: 300, y: 0 },
            },
          ],
          edges: [],
          outputNodeId: 'output',
        }],
        ui: {
          viewMode: 'list' as const,
          selectedNodeId: 'primary-1',
        },
      },
    }],
    selectColorNode: vi.fn(),
  },
}));

vi.mock('../../src/stores/timeline', () => ({
  useTimelineStore: vi.fn((selector: (state: typeof mockState.store) => unknown) => (
    selector(mockState.store)
  )),
}));

vi.mock('../../src/stores/dockStore', () => ({
  useDockStore: vi.fn((selector: (state: { activatePanelType: typeof mockState.activatePanelType }) => unknown) => (
    selector({ activatePanelType: mockState.activatePanelType })
  )),
}));

vi.mock('../../src/components/panels/color-workspace/ColorToolDock', () => ({
  ColorToolDock: ({ clipId, clipName }: { clipId: string; clipName: string }) => (
    <div data-clip-id={clipId} data-clip-name={clipName}>Color controls</div>
  ),
}));

import { ColorTab } from '../../src/components/panels/properties/ColorTab';

describe('ColorTab', () => {
  beforeEach(() => {
    mockState.store.selectColorNode.mockClear();
    mockState.activatePanelType.mockClear();
  });

  it('shows the controls surface and selects among editable correction nodes', () => {
    const { container } = render(<ColorTab clipId="clip-1" />);
    const selector = screen.getByRole('combobox', { name: 'Correction node' });

    expect(selector).toHaveValue('primary-1');
    expect(screen.getAllByRole('option')).toHaveLength(2);
    expect(screen.getByRole('option', { name: '1. Base correction · Primary' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '2. Skin tone · Wheels' })).toBeInTheDocument();
    expect(container.querySelector('[data-clip-id="clip-1"]')).toHaveAttribute('data-clip-name', 'Interview.mov');

    fireEvent.change(selector, { target: { value: 'wheels-1' } });

    expect(mockState.store.selectColorNode).toHaveBeenCalledWith('clip-1', 'wheels-1');
  });
});
