import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AnalysisActionCenter } from '../../src/components/panels/properties/AnalysisActionCenter';

describe('AnalysisActionCenter', () => {
  it('keeps global actions compact and channel actions inside three-column cards', () => {
    render(
      <AnalysisActionCenter
        actions={[
          { id: 'focus', title: 'Focus & Motion', detail: 'Sampled metrics', state: 'ready', statusText: 'Ready', onRun: vi.fn() },
          { id: 'faces', title: 'Faces', detail: 'Grouped people', state: 'none', statusText: 'Not analyzed', onRun: vi.fn() },
          { id: 'cuts', title: 'Scene Cuts', detail: '160×90 scan', state: 'error', statusText: 'Retry scan', onRun: vi.fn() },
        ]}
        onAnalyzeAll={vi.fn()}
        onClearAll={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Analyze All' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear Analysis' })).toBeInTheDocument();
    const cards = document.querySelectorAll('.analysis-action-row');
    expect(cards).toHaveLength(3);
    expect(cards[0]?.querySelector('.analysis-action-buttons .btn')).toBeTruthy();
  });
});
