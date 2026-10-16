// Importing a file that an offline project media item still points at
// reconnects that item instead of adding a second, disconnected duplicate.
// Files picked through a plain <input type="file"> carry no persistent handle,
// so after a reload the item goes offline; importing the same file again is
// the most common way users "fix" it.

import type { MediaFile } from '../../types';
import { runEditorBatch } from '../../../../services/project/repository/transaction/editorMutationRuntime';
import type { RelinkCandidate, RelinkCandidateMap } from '../../../../services/project/relink/relinkMatching';
import { fileImportLog as log } from './log';

export interface OfflineReconnectImportEntry {
  file: File;
  handle?: FileSystemFileHandle;
  absolutePath?: string;
}

export interface OfflineReconnectImportResult<T extends OfflineReconnectImportEntry> {
  /** Entries that did not reconnect an offline item and still need a normal import. */
  remaining: T[];
  /** Offline media items that are connected again, in their updated form. */
  reconnected: MediaFile[];
}

export async function reconnectOfflineMediaFromImport<T extends OfflineReconnectImportEntry>(
  entries: T[],
  getFiles: () => MediaFile[],
): Promise<OfflineReconnectImportResult<T>> {
  if (entries.length === 0) return { remaining: entries, reconnected: [] };
  // Lazy: the relink service imports the media store itself.
  const { applyRelinkMatch, findRelinkMatch, isNativeProjectLinkedMedia } = await import('../../../../services/project/relinkMedia');
  // Deliberately wider than mediaNeedsRelink: items no clip uses are deferred
  // and not counted as missing, yet the panel still shows them disconnected.
  const offline = getFiles().filter((media) => (
    !media.file && !media.liveInput && !isNativeProjectLinkedMedia(media) &&
    !media.modelSequence?.frames.length && !media.gaussianSplatSequence?.frames.length
  ));
  if (offline.length === 0) return { remaining: entries, reconnected: [] };

  const entryByCandidate = new Map<RelinkCandidate, T>();
  const candidates: RelinkCandidateMap = new Map();
  for (const entry of entries) {
    const candidate: RelinkCandidate = {
      name: entry.file.name,
      file: entry.file,
      ...(entry.handle ? { handle: entry.handle } : {}),
      ...(entry.absolutePath ? { absolutePath: entry.absolutePath } : {}),
    };
    entryByCandidate.set(candidate, entry);
    const key = candidate.name.toLowerCase();
    candidates.set(key, [...(candidates.get(key) ?? []), candidate]);
  }

  const used = new Set<T>();
  const reconnectedIds: string[] = [];
  const matches = offline.flatMap((media) => {
    const match = findRelinkMatch(media, candidates);
    const entry = match?.kind === 'single' ? entryByCandidate.get(match.candidate) : undefined;
    return match && entry ? [{ media, match, entry }] : [];
  });
  if (matches.length === 0) return { remaining: entries, reconnected: [] };

  await runEditorBatch(`Reconnect ${matches.length} media from import`, async () => {
    // One imported file may reconnect several offline duplicates of the same source.
    for (const { media, match, entry } of matches) {
      try {
        // applyRelinkMatch validates size/fingerprint before attaching the bytes.
        if (await applyRelinkMatch(media.id, match)) {
          used.add(entry);
          reconnectedIds.push(media.id);
          log.info(`Reconnected offline media from import: ${media.name}`);
        }
      } catch (error) {
        log.info(`Imported ${entry.file.name} does not match offline media ${media.name}; importing it as new media`, error);
      }
    }
  });

  const filesById = new Map(getFiles().map((media) => [media.id, media]));
  return {
    remaining: entries.filter((entry) => !used.has(entry)),
    reconnected: reconnectedIds.flatMap((id) => {
      const media = filesById.get(id);
      return media ? [media] : [];
    }),
  };
}
