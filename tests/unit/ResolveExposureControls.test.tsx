import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ColorToolDock } from '../../src/components/panels/color-workspace/ColorToolDock';
import { ResolveExposureControls } from '../../src/components/panels/color/ResolveExposureControls';

vi.mock('../../src/components/panels/color/ColorEditor', () => ({
  ColorEditor: ({ controlSet }: { controlSet?: string }) => <div data-testid="color-editor">{controlSet}</div>,
}));

vi.mock('../../src/components/panels/color-workspace/ColorCurvesPanel', () => ({
  ColorCurvesPanel: () => <div>Color curves</div>,
}));

vi.mock('../../src/components/panels/properties/shared', () => ({
  DraggableNumber: ({ ariaLabel, max, onChange, value }: {
    ariaLabel: string;
    max: number;
    onChange: (value: number) => void;
    value: number;
  }) => (
    <button aria-label={ariaLabel} data-value={value} onClick={() => onChange(max)} type="button" />
  ),
  KeyframeToggle: ({ property }: { property: string }) => <span data-testid="keyframe-toggle">{property}</span>,
}));

vi.mock('../../src/components/panels/properties/MIDIParameterLabel', () => ({
  MIDIParameterLabel: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock('../../src/services/productAnalytics', () => ({
  trackEditorControlCommitted: vi.fn(),
}));

describe('Exposure color controls', () => {
  it('opens the Exposure surface from the colour tool dock', () => {
    render(<ColorToolDock auxMode="scopes" clipId="clip-1" clipName="Clip 1" onAuxModeChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Exposure' }));

    expect(screen.getByText('Exposure · Levels')).toBeInTheDocument();
    expect(screen.getByTestId('color-editor')).toHaveTextContent('exposure');
  });

  it('edits exposure, black point and white point with keyframe toggles', () => {
    const setParam = vi.fn();
    const node = {
      id: 'node-1',
      type: 'primary' as const,
      name: 'Primary',
      enabled: true,
      params: { exposure: 0.5, blackPoint: 0.05, whitePoint: 0.9 },
      position: { x: 0, y: 0 },
    };

    render(
      <ResolveExposureControls
        clipId="clip-1"
        node={node}
        createProperty={(nodeId, key) => `color.v.${nodeId}.${key}` as never}
        getParamValue={(current, key, fallback) => (current.params[key] as number | undefined) ?? fallback}
        setParam={setParam}
        onBatchStart={vi.fn()}
        onBatchEnd={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Exposure' })).toHaveAttribute('data-value', '0.5');
    expect(screen.getByRole('button', { name: 'Black Point' })).toHaveAttribute('data-value', '5');
    expect(screen.getByRole('button', { name: 'White Point' })).toHaveAttribute('data-value', '90');
    expect(screen.getAllByTestId('keyframe-toggle').map(toggle => toggle.textContent)).toEqual([
      'color.v.node-1.exposure',
      'color.v.node-1.blackPoint',
      'color.v.node-1.whitePoint',
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Exposure' }));
    fireEvent.click(screen.getByRole('button', { name: 'Black Point' }));
    fireEvent.click(screen.getByRole('button', { name: 'White Point' }));

    expect(setParam.mock.calls).toEqual([
      ['node-1', 'exposure', 4],
      ['node-1', 'blackPoint', 0.5],
      ['node-1', 'whitePoint', 1],
    ]);
  });
});
