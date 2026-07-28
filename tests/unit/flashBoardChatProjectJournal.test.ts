import { afterEach, describe, expect, it, vi } from 'vitest';
import { fileStorageService } from '../../src/services/project/core/FileStorageService';
import { serializeFlashBoardChatMessage } from '../../src/services/project/flashBoardChatProjectCodec';
import {
  FLASHBOARD_CHAT_JOURNAL_AUTOSAVE_FILE_NAME,
  FLASHBOARD_CHAT_JOURNAL_FILE_NAME,
  persistFlashBoardChatJournal,
  readFlashBoardChatJournal,
} from '../../src/services/project/flashBoardChatProjectJournal';
import { projectFileService } from '../../src/services/project/ProjectFileService';

const PROJECT_CREATED_AT = '2026-07-28T12:00:00.000Z';

function mockFsaProject(handle: FileSystemDirectoryHandle): void {
  vi.spyOn(projectFileService, 'activeBackend', 'get').mockReturnValue('fsa');
  vi.spyOn(projectFileService, 'getProjectHandle').mockReturnValue(handle);
  vi.spyOn(projectFileService, 'getProjectData').mockReturnValue({
    createdAt: PROJECT_CREATED_AT,
  } as ReturnType<typeof projectFileService.getProjectData>);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('FlashBoard project-folder chat journal', () => {
  it('persists text and tool calls while redacting embedded image data', () => {
    const message = serializeFlashBoardChatMessage({
      id: 'assistant-1',
      role: 'assistant',
      text: 'Done',
      createdAt: Date.parse('2026-07-28T12:00:01.000Z'),
      toolCalls: [{
        modelContent: 'ok',
        result: {
          success: true,
          data: {
            preview: 'data:image/png;base64,aGVsbG8=',
          },
        },
        toolCall: {
          id: 'tool-1',
          name: 'captureFrame',
          arguments: '{}',
        },
      }],
    });

    expect(message.text).toBe('Done');
    expect(message.toolCalls?.[0]?.toolCall.name).toBe('captureFrame');
    expect(message.toolCalls?.[0]?.result.data).toEqual({
      preview: '[image omitted from chat history]',
    });
  });

  it('uses a project-folder autosave journal when the primary journal cannot be written', async () => {
    const handle = {} as FileSystemDirectoryHandle;
    mockFsaProject(handle);
    const writeFile = vi.spyOn(fileStorageService, 'writeFile')
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const saved = await persistFlashBoardChatJournal([{
      id: 'user-1',
      role: 'user',
      text: 'Keep this in the project folder',
      createdAt: Date.now(),
    }]);

    expect(saved).toBe(true);
    expect(writeFile).toHaveBeenCalledTimes(4);
    expect(writeFile.mock.calls.slice(0, 3).every((call) => (
      call[1] === 'AI_CHAT' && call[2] === FLASHBOARD_CHAT_JOURNAL_FILE_NAME
    ))).toBe(true);
    expect(writeFile.mock.calls[3]?.[1]).toBe('AI_CHAT');
    expect(writeFile.mock.calls[3]?.[2]).toBe(FLASHBOARD_CHAT_JOURNAL_AUTOSAVE_FILE_NAME);
  });

  it('loads the newest valid chat journal from the project folder only', async () => {
    const handle = {} as FileSystemDirectoryHandle;
    mockFsaProject(handle);
    const primary = {
      version: 1,
      projectCreatedAt: PROJECT_CREATED_AT,
      updatedAt: '2026-07-28T12:00:01.000Z',
      messages: [{ id: 'old', role: 'assistant', text: 'Old project-folder chat' }],
    };
    const autosave = {
      version: 1,
      projectCreatedAt: PROJECT_CREATED_AT,
      updatedAt: '2026-07-28T12:00:02.000Z',
      messages: [{
        id: 'new',
        role: 'assistant',
        text: 'Newest project-folder chat',
        toolCalls: [{
          modelContent: 'ok',
          result: { success: true },
          toolCall: { id: 'tool-1', name: 'getTimelineState', arguments: '{}' },
        }],
      }],
    };
    vi.spyOn(fileStorageService, 'readFile').mockImplementation(async (_handle, _folder, fileName) => ({
      text: async () => JSON.stringify(
        fileName === FLASHBOARD_CHAT_JOURNAL_FILE_NAME ? primary : autosave,
      ),
    } as File));

    const messages = await readFlashBoardChatJournal(PROJECT_CREATED_AT);

    expect(messages).toHaveLength(1);
    expect(messages?.[0]?.text).toBe('Newest project-folder chat');
    expect(messages?.[0]?.toolCalls?.[0]?.toolCall.name).toBe('getTimelineState');
  });
});
