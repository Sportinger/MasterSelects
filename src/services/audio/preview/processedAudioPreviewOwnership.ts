// Runtime arbitration with legacy HTML playback. Never serialized into clips.
let owners: Set<string> | undefined;
function getOwners(): Set<string> {
  return owners ??= import.meta.hot?.data?.processedAudioOwners ?? new Set<string>();
}
export function ownsProcessedAudioPreview(clipId: string): boolean { return getOwners().has(clipId); }
export function setProcessedAudioPreviewOwners(ids: Iterable<string>): void {
  const current = getOwners();
  current.clear();
  for (const id of ids) current.add(id);
}
if (import.meta.hot) import.meta.hot.dispose(data => { data.processedAudioOwners = owners; });
