import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StoryboardExportModeControl } from '../../src/components/export/storyboard/StoryboardExportModeControl';

afterEach(cleanup);

describe('storyboard animatic export UI', () => {
  it('announces normal-export warnings and exposes an explicit animatic mode', () => {
    const onChange = vi.fn();
    render(
      <StoryboardExportModeControl
        mode="normal-export"
        warnings={[{
          id: 'unfilled:scene-1',
          sceneId: 'scene-1',
          sceneClipId: 'clip-1',
          title: 'Opening scene',
          startTime: 0,
          endTime: 5,
          message: 'Missing media',
        }]}
        onChange={onChange}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Normal export is blocked');
    const animatic = screen.getByRole('radio', { name: /Animatic/ });
    expect(animatic).not.toBeChecked();
    fireEvent.click(animatic);
    expect(onChange).toHaveBeenCalledWith('animatic-export');
  });

  it('announces active animatic behavior without an error alert', () => {
    render(
      <StoryboardExportModeControl
        mode="animatic-export"
        warnings={[]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('labeled slates');
  });
});
