import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ provider: 'deepgram' }));
vi.mock('../../src/stores/settingsStore', () => ({
  useSettingsStore: (selector: (state: { transcriptionProvider: string }) => unknown) => selector({ transcriptionProvider: mocks.provider }),
}));

import { MediaContextRegenerateSubmenu } from '../../src/components/panels/media/context/MediaContextRegenerateSubmenu';
import type { MediaFile } from '../../src/stores/mediaStore';

describe('media transcript menu', () => {
  it('names and starts the transcription provider chosen in settings', () => {
    const onTranscribeMedia = vi.fn();
    const noop = vi.fn();
    const mediaFile = { id: 'mix', name: 'T1_MIX_LR.wav', type: 'audio', file: new File(['a'], 'T1_MIX_LR.wav') } as unknown as MediaFile;
    render(<MediaContextRegenerateSubmenu mediaFile={mediaFile} isVideoFile={false} isImageFile={false} hasAudio
      isGenerating={false} hasProxy={false} isAudioProxyGenerating={false} hasAudioProxy={false}
      isSourceAudioAnalysisGenerating={false} hasSourceWaveform={false} hasSourceSpectrogram={false}
      onCancelProxyGeneration={noop} onGenerateProxy={noop} onAnalyzeSceneCuts={noop} onRegenerateThumbnails={noop}
      onRegenerateAudioProxy={noop} onRegenerateWaveform={noop} onRegenerateSpectrogram={noop}
      onTranscribeMedia={onTranscribeMedia} onAnalyzeMedia={noop} onClose={noop} />);

    fireEvent.mouseEnter(screen.getByText(/Regenerate|Generate/));
    fireEvent.click(screen.getByText('Transcript (Deepgram)'));
    expect(onTranscribeMedia).toHaveBeenCalledWith(mediaFile);
  });
});
