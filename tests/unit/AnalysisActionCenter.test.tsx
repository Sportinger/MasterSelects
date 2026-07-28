import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AnalysisActionCenter } from '../../src/components/panels/properties/AnalysisActionCenter';

describe('AnalysisActionCenter', () => {
  it('keeps global actions compact and channel actions as pills', () => {
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

    expect(screen.getByRole('button', { name: 'Analyze all' })).toBeInTheDocument();
    const pills = document.querySelectorAll('.analysis-action-pill');
    expect(pills).toHaveLength(3);

    // Clear analysis lives behind the settings toggle, not in the main bar.
    expect(screen.queryByRole('button', { name: 'Clear analysis' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Analysis settings' }));
    expect(screen.getByRole('button', { name: 'Clear analysis' })).toBeInTheDocument();
  });
});
