import { describe, expect, it, vi } from 'vitest';
vi.mock('../../src/stores/flashboardStore/defaults', () => ({ createDefaultFlashBoardAIWorkspace: () => ({ id: 'default', title: 'Default', kind: 'ai', createdAt: 0 }), createDefaultFlashBoardComposer: () => ({}) }));
vi.mock('../../src/services/project/flashBoardChatProjectCodec', () => ({ normalizeFlashBoardChatMessages: (value: unknown) => value ?? [] }));
import { restoreEditorFlashBoardAuthoredFields } from '../../src/services/project/repository/transaction/editorJournalHydration';

describe('FlashBoard authored history restoration', () => {
  it('restores titles, kind, creation time and membership while retaining current conversation fields', () => {
    const conversation = [{ id: 'message', content: 'Current conversation' }];
    const restored = restoreEditorFlashBoardAuthoredFields({ aiWorkspaces: [
      { id: 'kept', title: 'New title', kind: 'changed', createdAt: 100, chatMessages: conversation },
      { id: 'removed', title: 'Removed' },
    ], activeAIWorkspaceId: 'removed', composer: { prompt: 'Current draft' } }, [
      { id: 'kept', title: 'Historical title', kind: 'ai', createdAt: 10 },
      { id: 'restored', title: 'Restored workspace', kind: 'ai', createdAt: 20, chatMessages: [] },
    ]);
    expect(restored.aiWorkspaces).toEqual([
      { id: 'kept', title: 'Historical title', kind: 'ai', createdAt: 10, chatMessages: conversation },
      { id: 'restored', title: 'Restored workspace', kind: 'ai', createdAt: 20, chatMessages: [] },
    ]);
    expect(restored.activeAIWorkspaceId).toBe('kept'); expect(restored.composer).toEqual({ prompt: 'Current draft' });
  });
});
