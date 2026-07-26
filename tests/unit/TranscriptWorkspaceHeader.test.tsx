import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TranscriptWorkspaceHeader } from '../../src/components/panels/properties/TranscriptWorkspaceHeader';

const baseProps = {
  activeProvider: 'hybrid' as const,
  clipCoverage: 1,
  hasTranscript: true,
  isPartial: false,
  isSignedIn: true,
  language: 'auto',
  onCancel: vi.fn(),
  onContinue: vi.fn(),
  onDelete: vi.fn(),
  onLanguageChange: vi.fn(),
  onProviderChange: vi.fn(),
  onSearchChange: vi.fn(),
  onTranscribe: vi.fn(),
  searchQuery: '',
  transcriptProgress: 36,
};

describe('TranscriptWorkspaceHeader', () => {
  it('shows one live run state and suppresses stale completed-result metadata', () => {
    const onCancel = vi.fn();
    render(
      <TranscriptWorkspaceHeader
        {...baseProps}
        onCancel={onCancel}
        run={{
          finalDetail: 'Starts after both transcripts',
          finalProgress: 0,
          finalStatus: 'waiting',
          overallProgress: 36,
          providers: { deepgram: 'complete', openai: 'running' },
          stage: 'transcribing',
        }}
        summary={{
          stage: 'complete',
        }}
        transcriptStatus="transcribing"
      />,
    );

    expect(screen.getByText('Listening')).toBeInTheDocument();
    expect(screen.getByText('Deepgram')).toBeInTheDocument();
    expect(screen.getByText('OpenAI')).toBeInTheDocument();
    expect(screen.getByText('Speakers')).toBeInTheDocument();
    expect(screen.queryByText('Best Quality ready')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('shows the fixed provider roles after one-click completion', () => {
    render(
      <TranscriptWorkspaceHeader
        {...baseProps}
        run={null}
        summary={{
          stage: 'complete',
        }}
        transcriptStatus="ready"
      />,
    );

    expect(screen.getByText('Best Quality ready')).toBeInTheDocument();
    expect(screen.getByText('Deepgram text + timing')).toBeInTheDocument();
    expect(screen.getByText('OpenAI speakers')).toBeInTheDocument();
    expect(screen.queryByText(/review/i)).not.toBeInTheDocument();
  });
});
