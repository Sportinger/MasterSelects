import { describe, expect, it } from 'vitest';
import { mapDocumentAnchor } from '../../src/services/documents/anchorMapping';
import type { DocumentAnchor } from '../../src/types/documents';

const passage = (start: number, end: number, quote: string): DocumentAnchor => ({
  blockId: 'block-1', start, end, quote, status: 'resolved',
});

describe('document anchor mapping', () => {
  it('keeps a selected passage when text is inserted immediately before it', () => {
    expect(mapDocumentAnchor(passage(4, 9, 'world'), 'say world', 'say new world'))
      .toMatchObject({ start: 8, end: 13, quote: 'world', status: 'resolved' });
  });

  it('does not expand a passage when text is inserted immediately after it', () => {
    expect(mapDocumentAnchor(passage(0, 5, 'hello'), 'hello world', 'hello new world'))
      .toMatchObject({ start: 0, end: 5, quote: 'hello', status: 'resolved' });
  });

  it('shrinks a partially deleted passage and orphans a fully deleted one', () => {
    expect(mapDocumentAnchor(passage(4, 10, 'abcdef'), 'say abcdef end', 'say adef end'))
      .toMatchObject({ start: 4, end: 8, quote: 'adef', status: 'resolved' });
    expect(mapDocumentAnchor(passage(4, 10, 'abcdef'), 'say abcdef end', 'say  end'))
      .toMatchObject({ start: 4, end: 4, quote: '', status: 'orphaned' });
  });
});
