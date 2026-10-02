import { readFlashBoardJournalList } from './editorFlashBoardJournal';
import type { RepositorySession } from '../RepositorySession';
import type { EntityDTO } from '../contracts';
import type { DomainJournal } from '../domains/projectDomains';
import type { ProjectFile } from '../../types/project.types';
import { createDefaultFlashBoardAIWorkspace, createDefaultFlashBoardComposer } from '../../../../stores/flashboardStore/defaults';
import { normalizeFlashBoardChatMessages } from '../../flashBoardChatProjectCodec';
import { object } from './domainAdapters/aggregatePlan';

export async function readEditorProjectionJournals(session: RepositorySession, entities: ReadonlyMap<string, EntityDTO>): Promise<DomainJournal[]> {
  const ids = ['flashboard/jobs', 'flashboard/prompts', 'flashboard/chat', 'flashboard/workspace-chat'];
  for (const key of entities.keys()) {
    if (!key.includes('/block/') && !key.includes('/item/')) ids.push(`fields/${key}`);
    const run = /^seedanceRun\/project\/([^/]+)$/u.exec(key); if (run) ids.push(`seedance/run/${decodeURIComponent(run[1])}`);
  }
  const journals: DomainJournal[] = [];
  for (let i = 0; i < ids.length; i += 8) {
    const values = await Promise.all(ids.slice(i, i + 8).map(async id => ({ id, value: await session.client.readJournal(id) })));
    for (const { id, value } of values) if (value !== null) journals.push({ id, kind: 'domain-journal', value, blobs: [], references: [] });
  }
  return journals;
}
export async function readInitialEditorFlashBoard(session: RepositorySession, project: ProjectFile): Promise<Record<string, unknown>> {
  const fb = project.flashboard;
  const fallbackWorkspace = createDefaultFlashBoardAIWorkspace();
  const workspaces = fb?.workspaces?.map(workspace => ({ ...workspace, createdAt: Date.parse(workspace.createdAt), updatedAt: Date.parse(workspace.updatedAt),
    composer: { ...createDefaultFlashBoardComposer(), ...workspace.composer }, chatMessages: normalizeFlashBoardChatMessages(workspace.chatMessages),
    chatConversationRef: workspace.chatConversationRef ?? crypto.randomUUID() })) ?? [fallbackWorkspace];
  const state: Record<string, unknown> = { activeGenerationRecords: (fb?.generationRecords ?? []).map(record => ({ ...record,
      createdAt: Date.parse(record.createdAt), updatedAt: Date.parse(record.updatedAt) })),
    composer: { ...createDefaultFlashBoardComposer(), ...fb?.composer }, aiWorkspaces: workspaces,
    activeAIWorkspaceId: fb?.activeWorkspaceId ?? workspaces[0]?.id ?? fallbackWorkspace.id,
    chatMessages: normalizeFlashBoardChatMessages(fb?.chatMessages), promptHistory: (fb?.promptHistory ?? []).map(entry => ({ ...entry, createdAt: Date.parse(entry.createdAt) })), selectedActiveGenerationRecordIds: [] };
  const canonicalWorkspaces = workspaces;
  for (const field of ['activeGenerationRecords', 'aiWorkspaces', 'chatMessages', 'promptHistory']) {
    const value = await readFlashBoardJournalList(session, `flashboard/runtime/${field}`); if (value !== null) state[field] = value;
  }
  for (const field of ['composer', 'activeAIWorkspaceId']) { const value = await session.readView(`flashboard/${field}`); if (value !== null) state[field] = value; }
  return restoreEditorFlashBoardAuthoredFields(state, canonicalWorkspaces);

}

/** Canonical membership and authored metadata win; conversation/job fields remain live. */
export function restoreEditorFlashBoardAuthoredFields(state: Record<string, unknown>, canonical: readonly unknown[]): Record<string, unknown> {
  const live = new Map((Array.isArray(state.aiWorkspaces) ? state.aiWorkspaces : []).map(item => [object(item).id, object(item)]));
  const workspaces = canonical.map(item => {
    const authored = object(item), prior = live.get(authored.id);
    return { ...authored, ...prior, ...Object.fromEntries(['id', 'title', 'kind', 'createdAt'].map(key => [key, authored[key]])) };
  });
  const active = workspaces.some(item => item.id === state.activeAIWorkspaceId) ? state.activeAIWorkspaceId : workspaces[0]?.id ?? null;
  return { ...state, aiWorkspaces: workspaces, activeAIWorkspaceId: active };
}
