import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GraphicalEqualizerControl } from '../../src/components/panels/properties/GraphicalEqualizerControl';
import { formatEqualizerFrequency } from '../../src/components/panels/properties/equalizerFormatting';

afterEach(() => {
  cleanup();
});

describe('GraphicalEqualizerControl', () => {
  it('formats standard EQ frequency labels', () => {
    expect(formatEqualizerFrequency(31)).toBe('31');
    expect(formatEqualizerFrequency(1000)).toBe('1k');
    expect(formatEqualizerFrequency(2500)).toBe('2.5k');
  });

  it('updates a band through its accessible range control', () => {
    const onChange = vi.fn();

    render(
      <GraphicalEqualizerControl
        bands={[{
          id: 'band1k',
          frequencyHz: 1000,
          valueDb: 0,
          label: '1k',
          ariaLabel: '1kHz EQ',
        }]}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByLabelText('1kHz EQ'), { target: { value: '3.5' } });

    expect(onChange).toHaveBeenCalledWith(0, 3.5);
  });

  it('resets the requested band from the range context menu', () => {
    const onChange = vi.fn();
    const onResetBand = vi.fn();

    render(
      <GraphicalEqualizerControl
        bands={[{
          id: 'band4k',
          frequencyHz: 4000,
          valueDb: -4,
          label: '4k',
          ariaLabel: '4kHz EQ',
        }]}
        onChange={onChange}
        onResetBand={onResetBand}
      />,
    );

    fireEvent.contextMenu(screen.getByLabelText('4kHz EQ'));

    expect(onResetBand).toHaveBeenCalledWith(0);
    expect(onChange).not.toHaveBeenCalled();
  });
});
