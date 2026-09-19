import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/components/panels/scopes/WaveformScope', () => ({
  WaveformScope: ({ viewMode }: { viewMode?: string }) => (
    <div data-testid={`waveform-${viewMode ?? 'rgb'}`} />
  ),
}));

vi.mock('../../src/components/panels/scopes/VectorscopeScope', () => ({
  VectorscopeScope: () => <div data-testid="vectorscope" />,
}));

vi.mock('../../src/components/panels/scopes/HistogramScope', () => ({
  HistogramScope: ({ viewMode }: { viewMode?: string }) => (
    <div data-testid={`histogram-${viewMode ?? 'rgb'}`} />
  ),
}));

import { ScopesPanel } from '../../src/components/panels/scopes/ScopesPanel';

describe('ScopesPanel', () => {
  afterEach(cleanup);

  it('opens the Resolve-style menu and switches scope modes', () => {
    render(<ScopesPanel />);

    const trigger = screen.getByRole('button', { name: 'Scope type' });
    expect(trigger).toHaveTextContent('Parade');
    expect(screen.getByTestId('waveform-parade')).toBeInTheDocument();
    expect(screen.queryByTestId('waveform-r')).not.toBeInTheDocument();
    expect(screen.queryByTestId('waveform-g')).not.toBeInTheDocument();
    expect(screen.queryByTestId('waveform-b')).not.toBeInTheDocument();

    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeVisible();
    expect(screen.getAllByRole('menuitemradio').map(item => item.textContent)).toEqual([
      'Parade',
      'Waveform',
      'Vectorscope',
      'Histogram',
    ]);

    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Waveform' }));

    expect(trigger).toHaveTextContent('Waveform');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByTestId('waveform-rgb')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Y' })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Y' }));
    expect(screen.getByTestId('waveform-luma')).toBeInTheDocument();

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Histogram' }));
    expect(screen.getByTestId('histogram-luma')).toBeInTheDocument();
  });

  it('opens legacy scope panels on their previous mode while keeping the selector', () => {
    render(<ScopesPanel initialMode="vectorscope" />);

    expect(screen.getByRole('button', { name: 'Scope type' })).toHaveTextContent('Vectorscope');
    expect(screen.getByTestId('vectorscope')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'RGB' })).not.toBeInTheDocument();
  });
});
