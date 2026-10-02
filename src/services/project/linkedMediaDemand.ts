/** Runtime-only availability: an unopened saved source is not a missing source. */
const deferred: Set<string> = import.meta.hot?.data?.deferredLinkedMedia ?? new Set();
let opener: ((id: string) => Promise<boolean>) | null = import.meta.hot?.data?.linkedMediaOpener ?? null;
export function isLinkedMediaDeferred(id: string): boolean { return deferred.has(id); }
export function deferLinkedMedia(ids: Iterable<string>, open: (id: string) => Promise<boolean>): void {
  deferred.clear(); for (const id of ids) deferred.add(id); opener = open;
}
export function finishLinkedMediaDemand(id: string): void { deferred.delete(id); }
export function requestLinkedMedia(id: string): Promise<boolean> {
  return deferred.has(id) && opener ? opener(id) : Promise.resolve(false);
}
if (import.meta.hot) import.meta.hot.dispose(data => { data.deferredLinkedMedia = deferred; data.linkedMediaOpener = opener; });
