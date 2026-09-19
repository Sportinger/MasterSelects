import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { MediaAddItemsMenu } from '../../src/components/panels/media/import/MediaAddItemsMenu';

type MediaAddItemsMenuComponentProps = ComponentProps<typeof MediaAddItemsMenu>;

function renderMenu(overrides: Partial<MediaAddItemsMenuComponentProps> = {}) {
  const props: MediaAddItemsMenuComponentProps = {
    variant: 'dropdown',
    onClose: vi.fn(),
    onImport: vi.fn(),
    onNewComposition: vi.fn(),
    onNewFolder: vi.fn(),
    onNewLiveInput: vi.fn(),
    onImportGaussianSplat: vi.fn(),
    ...overrides,
  };

  render(<MediaAddItemsMenu {...props} />);
  return props;
}

describe('MediaAddItemsMenu import surface', () => {
  it('delegates Import files to the shared import command', () => {
    const props = renderMenu();

    fireEvent.click(screen.getByText('Import files...'), { clientX: 240, clientY: 180 });

    expect(props.onImport).toHaveBeenCalledTimes(1);
    expect(props.onImport).toHaveBeenCalledWith({ x: 240, y: 180 });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('does not expose timeline-native layers in the Media Panel', () => {
    const props = renderMenu();

    expect(screen.queryByText('Text')).not.toBeInTheDocument();
    expect(screen.queryByText('Solid')).not.toBeInTheDocument();
    expect(screen.queryByText('Camera')).not.toBeInTheDocument();
    expect(screen.queryByText('Light')).not.toBeInTheDocument();
    expect(screen.queryByText('Motion Null')).not.toBeInTheDocument();
    expect(screen.queryByText('Adjustment Layer')).not.toBeInTheDocument();
    expect(screen.queryByText('Math Scene')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Live Input...'));
    expect(props.onNewLiveInput).toHaveBeenCalledTimes(1);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps Gaussian Splat as a source import', () => {
    const props = renderMenu();

    fireEvent.click(screen.getByText('Import Gaussian Splat...'));
    expect(props.onImportGaussianSplat).toHaveBeenCalledTimes(1);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });
});
