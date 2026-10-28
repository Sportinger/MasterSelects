import type { TimelineStore } from './types';

/**
 * Store-owned timeline keys that are never project content. withTimelineRevision adds `timelineRevision` to
 * every write of durable timeline state, so a pointer sample arrives at the repository boundary as
 * `{ clips, timelineRevision }`. The gesture preview accepts exactly these keys next to the clip patch.
 */
export const TIMELINE_STORE_SESSION_KEYS: ReadonlySet<keyof TimelineStore> = new Set<keyof TimelineStore>(['timelineRevision']);
