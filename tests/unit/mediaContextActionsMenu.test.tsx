import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MediaContextActionsMenu,
  type MediaContextActionsMenuProps,
} from '../../src/components/panels/media/context/MediaContextActionsMenu';
import { flashBoardMediaBridge } from '../../src/services/flashboard/FlashBoardMediaBridge';
import type { MediaFile } from '../../src/stores/mediaStore';

const mediaFile = {
  id: 'media-generated',
  name: 'AI generated video.mp4',
  type: 'video',
} as MediaFile;

function createProps(overrides: Partial<MediaContextActionsMenuProps> = {}): MediaContextActionsMenuProps {
  const noop = vi.fn();
  return {
    showBoardAnnotationAction: false,
    hasClipboard: false,
    hasSelection: true,
    multiSelect: false,
    selectedCount: 1,
    selectedItem: mediaFile,
    selectedIds: [mediaFile.id],
    availableFolders: [],
    aiReferenceMediaFileIds: [],
    allContextMediaReferenced: false,
    composition: null,
    solidItem: null,
    mediaFile,
    canRegenerateMediaArtifacts: false,
    isVideoFile: true,
    isImageFile: false,
    isGenerating: false,
    hasProxy: false,
    hasAudio: false,
    isAudioProxyGenerating: false,
    hasAudioProxy: false,
    isSourceAudioAnalysisGenerating: false,
    hasSourceWaveform: false,
    hasSourceSpectrogram: false,
    proxyFolderName: null,
    onNewBoardAnnotation: noop,
    onClose: noop,
    onImport: noop,
    onPaste: noop,
    onToggleAiPromptReferences: noop,
    onCopyPrompt: noop,
    onStartRename: noop,
    onMoveToFolder: noop,
    onOpenCompositionSettings: noop,
    onOpenImageCrop: noop,
    onOpenSolidSettings: noop,
    onCancelProxyGeneration: noop,
    onGenerateProxy: noop,
    onRegenerateThumbnails: noop,
    onRegenerateAudioProxy: noop,
    onRegenerateWaveform: noop,
    onRegenerateSpectrogram: noop,
    onExtractVideoFrame: vi.fn(async () => undefined),
    onDownloadMediaFile: vi.fn(async () => undefined),
    onShowRawInExplorer: vi.fn(async () => undefined),
    onShowProxyInExplorer: vi.fn(async () => undefined),
    onPickProxyFolder: vi.fn(async () => undefined),
    onCopy: noop,
    onDuplicate: noop,
    onDelete: noop,
    onNewComposition: noop,
    onNewFolder: noop,
    onNewText: noop,
    onNewSolid: noop,
    onNewMesh: noop,
    onNewText3D: noop,
    onNewCamera: noop,
    onNewSplatEffector: noop,
    onImportGaussianSplat: noop,
    onNewMathScene: noop,
    onNewMotionShape: noop,
    ...overrides,
  };
}

describe('MediaContextActionsMenu', () => {
  afterEach(() => {
    cleanup();
    flashBoardMediaBridge.hydrateMetadata({});
  });

  it('enables Copy Prompt only when the media item has generation prompt metadata', () => {
    const onCopyPrompt = vi.fn();
    flashBoardMediaBridge.hydrateMetadata({
      [mediaFile.id]: {
        mediaFileId: mediaFile.id,
        providerId: 'kling-3.0',
        version: 'latest',
        prompt: 'A copied generation prompt.',
        referenceMediaFileIds: [],
        createdAt: '2026-07-02T00:00:00.000Z',
      },
    });

    const { rerender } = render(<MediaContextActionsMenu {...createProps({ onCopyPrompt })} />);
    const enabledItem = screen.getByText('Copy Prompt');
    expect(enabledItem).not.toHaveClass('disabled');
    fireEvent.click(enabledItem);
    expect(onCopyPrompt).toHaveBeenCalledWith('A copied generation prompt.');

    flashBoardMediaBridge.hydrateMetadata({});
    rerender(<MediaContextActionsMenu {...createProps({ onCopyPrompt })} />);
    const disabledItem = screen.getByText('Copy Prompt');
    expect(disabledItem).toHaveClass('disabled');
    fireEvent.click(disabledItem);
    expect(onCopyPrompt).toHaveBeenCalledTimes(1);
  });
});
