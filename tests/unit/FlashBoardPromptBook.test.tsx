import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FlashBoardPromptBook } from '../../src/components/panels/flashboard/FlashBoardPromptBook';
import { flashBoardMediaBridge } from '../../src/services/flashboard/FlashBoardMediaBridge';
import type { FlashBoardActiveGenerationRecord } from '../../src/stores/flashboardStore';
import { useMediaStore } from '../../src/stores/mediaStore';
import type { MediaFile } from '../../src/stores/mediaStore/types';

interface PromptBookMediaStoreMock {
  setSourceMonitorFile: ReturnType<typeof vi.fn>;
}

const mockedUseMediaStore = useMediaStore as unknown as {
  getState: ReturnType<typeof vi.fn>;
  mockImplementation: ReturnType<typeof vi.fn>['mockImplementation'];
};

describe('FlashBoardPromptBook', () => {
  let mediaStoreState: PromptBookMediaStoreMock;

  beforeEach(() => {
    flashBoardMediaBridge.hydrateMetadata({});
    mediaStoreState = {
      setSourceMonitorFile: vi.fn(),
    };
    mockedUseMediaStore.mockImplementation((selector: (state: PromptBookMediaStoreMock) => unknown) => selector(mediaStoreState));
    mockedUseMediaStore.getState.mockReturnValue(mediaStoreState);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the active system prompt even when there is no prompt history', () => {
    render(
      <FlashBoardPromptBook
        activeSystemPrompt="Always answer in German."
        activeSystemPromptProvider="lemonade"
        copiedEntryId={null}
        entries={[]}
        generationRecords={[]}
        mediaFiles={[]}
        onClose={vi.fn()}
        onCopy={vi.fn()}
      />,
    );

    expect(screen.getAllByText('System').length).toBeGreaterThan(0);
    expect(screen.getByText('Current system prompt - Lemonade')).toBeInTheDocument();
    expect(screen.getByText('Always answer in German.')).toBeInTheDocument();
    expect(screen.getByText('Presets')).toBeInTheDocument();
    expect(screen.queryByText('No generated media for this prompt.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'System prompt' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Gen$/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^Chat$/ })).toBeDisabled();
    expect(screen.queryByLabelText('Previous prompt')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Next prompt')).not.toBeInTheDocument();
  });

  it('edits the current system prompt inside the prompt book', () => {
    const loadSystemPrompt = vi.fn();
    const setPromptDraft = vi.fn();

    render(
      <FlashBoardPromptBook
        activeSystemPrompt="Current prompt"
        activeSystemPromptProvider="openai"
        copiedEntryId={null}
        entries={[]}
        generationRecords={[]}
        mediaFiles={[]}
        projectPromptStorageReady
        promptDraft="Current prompt"
        promptNameDraft="Editorial prompt"
        promptSendContext={false}
        savedSystemPrompts={[{
          fileName: 'openai--editorial.prompt.json',
          name: 'Editorial prompt',
          provider: 'openai',
          sendContext: false,
          updatedAt: new Date(1000).toISOString(),
        }]}
        selectedPromptFile="openai--editorial.prompt.json"
        onClose={vi.fn()}
        onCopy={vi.fn()}
        onLoadSystemPrompt={loadSystemPrompt}
        onSetPromptDraft={setPromptDraft}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByDisplayValue('Current prompt')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save new' })).toBeInTheDocument();
    expect(screen.getByLabelText('Send current MasterSelects context')).not.toBeChecked();
    expect(screen.getByText('Context off')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Editorial prompt/ }));
    expect(loadSystemPrompt).toHaveBeenCalledWith('openai--editorial.prompt.json');
  });

  it('toggles whether a system prompt sends live MasterSelects context', () => {
    const setPromptSendContext = vi.fn();

    render(
      <FlashBoardPromptBook
        activeSystemPrompt="Current prompt"
        activeSystemPromptProvider="openai"
        copiedEntryId={null}
        entries={[]}
        generationRecords={[]}
        mediaFiles={[]}
        promptSendContext
        onClose={vi.fn()}
        onCopy={vi.fn()}
        onSetPromptSendContext={setPromptSendContext}
      />,
    );

    fireEvent.click(screen.getByLabelText('Send current MasterSelects context'));
    expect(setPromptSendContext).toHaveBeenCalledWith(false);
  });

  it('renders prompt text beside generated media with run metadata and page-side navigation', () => {
    const generationRecords: FlashBoardActiveGenerationRecord[] = [{
      id: 'run-1',
      kind: 'generation',
      createdAt: 2000,
      updatedAt: 2000,
      request: {
        aspectRatio: '16:9',
        duration: 5,
        imageSize: '1K',
        mode: 'std',
        prompt: 'A blue robot in a studio',
        providerId: 'kie',
        referenceMediaFileIds: [],
        service: 'kie-ai',
        version: 'nano-banana',
      },
      result: {
        mediaFileId: 'media-1',
        mediaType: 'image',
      },
    }];
    const mediaFiles = [{
      createdAt: 1,
      id: 'media-1',
      name: 'robot.png',
      parentId: null,
      type: 'image',
      url: 'blob:robot',
    }] as MediaFile[];

    const onClose = vi.fn();

    render(
      <FlashBoardPromptBook
        copiedEntryId={null}
        entries={[{ createdAt: 1000, id: 'chat-1', kind: 'chat', prompt: 'Older chat prompt' }]}
        generationRecords={generationRecords}
        mediaFiles={mediaFiles}
        onClose={onClose}
        onCopy={vi.fn()}
      />,
    );

    expect(screen.getAllByText('A blue robot in a studio').length).toBeGreaterThan(0);
    expect(screen.getByText('kie / nano-banana')).toBeInTheDocument();
    expect(screen.getByText('Mode std / Size 1K / Aspect 16:9 / Duration 5s')).toBeInTheDocument();
    expect(screen.getByTitle(/robot\.png/)).toBeInTheDocument();
    expect(document.querySelector('.fb-prompt-book-media-group.user')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Gen$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Chat$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'System prompt' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /A blue robot/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Older chat prompt/ })).not.toBeInTheDocument();

    const robotTile = screen.getByTitle(/robot\.png/);
    fireEvent.doubleClick(robotTile);
    expect(mediaStoreState.setSourceMonitorFile).toHaveBeenCalledWith('media-1');
    expect(onClose).toHaveBeenCalled();

    fireEvent.click(document.querySelector('.fb-prompt-book-right-page')!);
    expect(screen.queryByText('Older chat prompt')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Chat$/ }));

    expect(screen.getAllByText('Older chat prompt').length).toBeGreaterThan(0);
  });

  it('single-clicks generated media as a page turn', () => {
    vi.useFakeTimers();
    const generationRecords: FlashBoardActiveGenerationRecord[] = [{
      id: 'run-1',
      kind: 'generation',
      createdAt: 3000,
      updatedAt: 3000,
      request: {
        prompt: 'First generation prompt',
        providerId: 'kie',
        referenceMediaFileIds: [],
      },
      result: {
        mediaFileId: 'media-1',
        mediaType: 'image',
      },
    }];
    const mediaFiles = [{
      createdAt: 1,
      id: 'media-1',
      name: 'first.png',
      parentId: null,
      type: 'image',
      url: 'blob:first',
    }] as MediaFile[];

    render(
      <FlashBoardPromptBook
        copiedEntryId={null}
        entries={[{ createdAt: 1000, id: 'gen-2', kind: 'generation', prompt: 'Second generation prompt' }]}
        generationRecords={generationRecords}
        mediaFiles={mediaFiles}
        onClose={vi.fn()}
        onCopy={vi.fn()}
      />,
    );

    const leftPageText = () => document.querySelector('.fb-prompt-book-left-page')?.textContent ?? '';
    expect(leftPageText()).toContain('First generation prompt');
    expect(leftPageText()).not.toContain('Second generation prompt');

    fireEvent.click(screen.getByTitle(/first\.png/));
    act(() => {
      vi.advanceTimersByTime(80);
    });

    expect(leftPageText()).toContain('Second generation prompt');
    expect(mediaStoreState.setSourceMonitorFile).not.toHaveBeenCalled();
  });

  it('links generated media from saved FlashBoard metadata when active records are gone', () => {
    flashBoardMediaBridge.hydrateMetadata({
      'media-2': {
        aspectRatio: '1:1',
        createdAt: new Date(3000).toISOString(),
        imageSize: '1024',
        mediaFileId: 'media-2',
        mediaType: 'image',
        originalPrompt: 'Original red moon prompt',
        prompt: 'A red moon over water',
        providerId: 'openai',
        referenceMediaFileIds: [],
        service: 'openai',
        version: 'gpt-image-1',
      },
    });
    const mediaFiles = [{
      createdAt: 3,
      id: 'media-2',
      name: 'moon.png',
      parentId: null,
      type: 'image',
      url: 'blob:moon',
    }] as MediaFile[];

    render(
      <FlashBoardPromptBook
        copiedEntryId={null}
        entries={[]}
        generationRecords={[]}
        mediaFiles={mediaFiles}
        onClose={vi.fn()}
        onCopy={vi.fn()}
      />,
    );

    expect(screen.getAllByText('Original red moon prompt').length).toBeGreaterThan(0);
    expect(screen.getByText('A red moon over water')).toBeInTheDocument();
    expect(screen.getByTitle(/moon\.png/)).toBeInTheDocument();
    expect(document.querySelector('.fb-prompt-book-media-group.magic')).toBeInTheDocument();
  });

  it('mounts a time-boxed turn sheet when navigating between pages', () => {
    render(
      <FlashBoardPromptBook
        copiedEntryId={null}
        entries={[
          { createdAt: 1000, id: 'chat-1', kind: 'chat', prompt: 'Chat prompt' },
          { createdAt: 2000, id: 'gen-1', kind: 'generation', prompt: 'Gen prompt' },
        ]}
        generationRecords={[]}
        mediaFiles={[]}
        onClose={vi.fn()}
        onCopy={vi.fn()}
      />,
    );

    expect(document.querySelector('.fb-prompt-book-turn-sheet')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Chat$/ }));
    const sheet = document.querySelector('.fb-prompt-book-turn-sheet');
    expect(sheet).toBeInTheDocument();
    expect(sheet).toHaveClass('is-forward');
    expect(sheet).toHaveAttribute('aria-hidden', 'true');
    expect(document.querySelector('.fb-prompt-book-sparkles')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Gen$/ }));
    expect(document.querySelector('.fb-prompt-book-turn-sheet')).toHaveClass('is-backward');
  });

  it('opens directly in the requested prompt category', () => {
    render(
      <FlashBoardPromptBook
        copiedEntryId={null}
        entries={[
          { createdAt: 1000, id: 'chat-1', kind: 'chat', prompt: 'Open chat first' },
          { createdAt: 2000, id: 'gen-1', kind: 'generation', prompt: 'Newer generation prompt' },
        ]}
        generationRecords={[]}
        initialKind="chat"
        mediaFiles={[]}
        onClose={vi.fn()}
        onCopy={vi.fn()}
      />,
    );

    expect(screen.getAllByText('Open chat first').length).toBeGreaterThan(0);
    expect(screen.queryByText('Newer generation prompt')).not.toBeInTheDocument();
  });

  it('groups chat messages by day and shows assistant tool calls on the right page', () => {
    const createdAt = Date.parse('2026-07-09T10:00:00.000Z');
    const dayLabel = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(createdAt));

    render(
      <FlashBoardPromptBook
        chatMessages={[
          { createdAt, id: 'user-1', role: 'user', text: 'hello' },
          {
            createdAt: createdAt + 1000,
            id: 'assistant-1',
            role: 'assistant',
            text: 'I will gather media.\n\n```tool\nexecuteBatch({ actions: [{ tool: "getMediaItems" }] })\n```',
          },
          {
            createdAt: createdAt + 1500,
            id: 'assistant-2',
            role: 'assistant',
            text: 'Done.',
            toolCalls: [{
              modelContent: '{"success":true,"data":{"clipId":"clip-1"}}',
              result: { success: true, data: { clipId: 'clip-1' } },
              toolCall: {
                arguments: '{"trackId":0}',
                id: 'call-1',
                name: 'addClipSegment',
              },
            }],
          },
          { createdAt: createdAt + 2000, id: 'user-2', role: 'user', text: 'hi' },
        ]}
        copiedEntryId={null}
        entries={[
          { createdAt, id: 'chat-1', kind: 'chat', prompt: 'hello' },
          { createdAt: createdAt + 2000, id: 'chat-2', kind: 'chat', prompt: 'hi' },
        ]}
        generationRecords={[]}
        mediaFiles={[]}
        onClose={vi.fn()}
        onCopy={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: dayLabel })).toBeInTheDocument();
    expect(screen.getByText('Chat history')).toBeInTheDocument();
    expect(screen.getByText('hello')).toBeInTheDocument();
    expect(screen.getByText('hi')).toBeInTheDocument();
    expect(screen.getByText('I will gather media.')).toBeInTheDocument();
    expect(screen.getByText('Toolcalls')).toBeInTheDocument();
    expect(screen.getByText('addClipSegment done')).toBeInTheDocument();
    expect(screen.getAllByText(/trackId/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/executeBatch/).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /hello/ })).not.toBeInTheDocument();
  });
});
