import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PromptDictationButton,
  appendPromptDictationText,
} from '../../src/components/common/PromptDictationButton';
import {
  startPromptDictation,
  type PromptDictationOptions,
} from '../../src/services/transcription/promptDictation';
import { LandingPage } from '../../src/marketing/LandingPage';

vi.mock('../../src/services/transcription/promptDictation', () => ({
  startPromptDictation: vi.fn(),
}));

const startPromptDictationMock = vi.mocked(startPromptDictation);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AI Studio prompt dictation', () => {
  it('appends transcript fragments without destroying existing prompt text', () => {
    expect(appendPromptDictationText('Slow dolly in', 'toward the actor')).toBe(
      'Slow dolly in toward the actor',
    );
    expect(appendPromptDictationText('Slow dolly in\n', 'toward the actor')).toBe(
      'Slow dolly in\ntoward the actor',
    );
  });

  it('starts local dictation, forwards partial text, and stops on the second click', async () => {
    const stop = vi.fn().mockResolvedValue(undefined);
    let options: PromptDictationOptions | undefined;
    startPromptDictationMock.mockImplementation(async (nextOptions) => {
      options = nextOptions;
      return { cancel: vi.fn().mockResolvedValue(undefined), stop };
    });
    const onTranscript = vi.fn();
    render(<PromptDictationButton onTranscript={onTranscript} />);

    fireEvent.click(screen.getByRole('button', { name: 'Start prompt dictation' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop prompt dictation' })).toBeTruthy());

    act(() => options?.onTranscript('A quiet forest at sunrise'));
    expect(onTranscript).toHaveBeenCalledWith('A quiet forest at sunrise');

    fireEvent.click(screen.getByRole('button', { name: 'Stop prompt dictation' }));
    await waitFor(() => expect(stop).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start prompt dictation' })).toBeTruthy());
  });

  it('replaces the landing chat attachment button with dictation', () => {
    render(<LandingPage onPickProjectFiles={vi.fn()} selectedProjectId="project-1" />);

    expect(screen.getByRole('button', { name: 'Start prompt dictation' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add media or planning documents' })).toBeNull();
  });
});
