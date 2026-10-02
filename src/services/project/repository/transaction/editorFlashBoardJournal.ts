import type { JsonValue } from '../contracts';
import { domainJson } from '../domains/jsonBoundary';
import type { DomainMutationPlan } from './domainMutationAdapter';
import type { RepositorySession } from '../RepositorySession';
import { object } from './domainAdapters/aggregatePlan';

const initializedLists = new Set<string>();
export function resetFlashBoardJournalMembership(): void { initializedLists.clear(); }

/** Journal membership is chunked; an appended message never serializes its conversation. */
export function appendFlashBoardJournalDelta(plan: DomainMutationPlan, id: string, previous: unknown, value: unknown): void {
  if (previous === value) return;
  if (!Array.isArray(value)) { plan.journals.push({ id, value: domainJson(value) }); return; }
  const old = Array.isArray(previous) ? previous : [];
  const oldById = new Map(old.map((item, index) => [String(object(item).id ?? index), item]));
  const ids = value.map((item, index) => String(object(item).id ?? index));
  for (let index = 0; index < value.length; index++) {
    const item = value[index], key = `${id}/item/${encodeURIComponent(ids[index])}`;
    if (initializedLists.has(id) && oldById.get(ids[index]) === item) continue;
    if (id === 'flashboard/runtime/aiWorkspaces') {
      const workspace = object(item), before = object(oldById.get(ids[index]));
      appendFlashBoardJournalDelta(plan, `${key}/chat`, before.chatMessages, workspace.chatMessages ?? []);
      plan.journals.push({ id: key, value: domainJson({ ...workspace, chatMessages: { $journalList: `${key}/chat` } }) });
    } else plan.journals.push({ id: key, value: domainJson(item) });
  }
  const chunks: string[] = [];
  for (let index = 0; index < ids.length; index += 256) {
    const key = `${id}/members/${Math.floor(index / 256)}`;
    chunks.push(key); plan.journals.push({ id: key, value: ids.slice(index, index + 256) });
  }
  plan.journals.push({ id, value: { version: 1, chunks } }); initializedLists.add(id);
}
export async function readFlashBoardJournalList(session: RepositorySession, id: string): Promise<JsonValue | null> {
  const head = await session.client.readJournal(id);
  if (!head || Array.isArray(head) || typeof head !== 'object' || !Array.isArray(head.chunks)) return head;
  const result: JsonValue[] = [];
  for (const chunk of head.chunks) {
    if (typeof chunk !== 'string') throw new TypeError('Invalid FlashBoard journal membership');
    const members = await session.client.readJournal(chunk);
    if (!Array.isArray(members)) throw new TypeError('Missing FlashBoard journal membership');
    for (let index = 0; index < members.length; index += 8) {
      const values = await Promise.all(members.slice(index, index + 8).map(async member => {
        if (typeof member !== 'string') throw new TypeError('Invalid FlashBoard journal item');
        const item = await session.client.readJournal(`${id}/item/${encodeURIComponent(member)}`);
        if (item === null) throw new TypeError('Missing FlashBoard journal item');
        if (id === 'flashboard/runtime/aiWorkspaces' && item && typeof item === 'object' && !Array.isArray(item)) {
          const chat = object(item.chatMessages).$journalList;
          if (typeof chat === 'string') return { ...item, chatMessages: await readFlashBoardJournalList(session, chat) ?? [] };
        }
        return item;
      }));
      result.push(...values);
    }
  }
  return result;
}
