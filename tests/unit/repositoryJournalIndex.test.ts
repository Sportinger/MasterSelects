import { describe, it, expect } from 'vitest';
import type { JsonValue, RecordReference, RepositoryRecord } from '../../src/services/project/repository/contracts';
import { RepositoryJournalReader, createJournalIndexCache } from '../../src/services/project/repository/journal/RepositoryJournalReader';

function chain(ids: string[]) {
  const records = new Map<string, RepositoryRecord>(); let head: RecordReference | null = null;
  ids.forEach((id, index) => {
    const reference: RecordReference = { hash: 'sha256:' + index.toString(16).padStart(64, '0'), segmentId: 'segment', offset: 14 + index, length: 1 };
    records.set(reference.hash, { kind: 'journal', schemaVersion: 1, payload: { id, value: { index } as JsonValue, previous: head } as unknown as JsonValue,
      references: head ? [head] : [], blobs: [] });
    head = reference;
  });
  let reads = 0;
  const readRecord = async (reference: RecordReference) => { reads++; return records.get(reference.hash)!; };
  return { head: () => head, readRecord, reads: () => reads, setHead: (next: RecordReference | null) => { head = next; } };
}

describe('journal lookups on open', () => {
  it('reads the chain once per head instead of once per lookup, returning the newest entry', async () => {
    const journal = chain(Array.from({ length: 400 }, (_, index) => `legacy/${index % 200}`));
    const index = createJournalIndexCache();
    const reader = () => new RepositoryJournalReader({ getHead: journal.head, readRecord: journal.readRecord, index });
    expect(await reader().latest('legacy/7')).toEqual({ index: 207 });
    for (let lookup = 0; lookup < 1000; lookup++) expect(await reader().latest(`fields/entity-${lookup}`)).toBeNull();
    // One indexing pass plus one validating read per hit, not 1000 full scans.
    expect(journal.reads()).toBe(401);
  });

  it('rebuilds the index when the journal head moves', async () => {
    const journal = chain(['chat', 'jobs']);
    const index = createJournalIndexCache();
    const reader = () => new RepositoryJournalReader({ getHead: journal.head, readRecord: journal.readRecord, index });
    expect(await reader().latest('jobs')).toEqual({ index: 1 });
    journal.setHead({ hash: 'sha256:' + (0).toString(16).padStart(64, '0'), segmentId: 'segment', offset: 14, length: 1 });
    expect(await reader().latest('jobs')).toBeNull();
    expect(await reader().latest('chat')).toEqual({ index: 0 });
  });
});
