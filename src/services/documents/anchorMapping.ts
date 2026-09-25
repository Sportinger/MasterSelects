import type { DocumentAnchor } from '../../types/documents';

/** Map a passage through one contiguous text edit without searching unrelated text. */
export function mapDocumentAnchor(anchor: DocumentAnchor, before: string, after: string): DocumentAnchor {
  if (before === after || anchor.status === 'orphaned') return anchor;
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
  let suffix = 0;
  while (suffix < before.length - prefix && suffix < after.length - prefix
    && before[before.length - suffix - 1] === after[after.length - suffix - 1]) suffix++;

  const oldEnd = before.length - suffix;
  const newEnd = after.length - suffix;
  const delta = newEnd - oldEnd;
  const insertion = oldEnd === prefix;
  const start = anchor.start < prefix ? anchor.start
    : anchor.start >= oldEnd ? anchor.start + delta : prefix;
  const end = anchor.end <= prefix ? anchor.end
    : anchor.end >= oldEnd ? anchor.end + delta : newEnd;
  const mappedStart = Math.max(0, Math.min(start, after.length));
  const mappedEnd = Math.max(mappedStart, Math.min(end, after.length));
  const selected = anchor.start < anchor.end;
  return { ...anchor, start: mappedStart, end: mappedEnd,
    quote: after.slice(mappedStart, mappedEnd),
    status: selected && mappedStart === mappedEnd && !insertion ? 'orphaned' : 'resolved' };
}
