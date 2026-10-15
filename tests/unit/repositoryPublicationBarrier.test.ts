import { describe, expect, it } from 'vitest';
import { holdEditorContentPublication, publishEditorContentProjection, readEditorContentPublication, subscribeEditorContentPublication } from '../../src/services/project/repository/transaction/editorPublication';

describe('session publication barrier', () => {
  it('keeps inner activation and installed-session notifications blocked until every owner releases', () => {
    const seen: boolean[] = [];
    const unsubscribe = subscribeEditorContentPublication(() => seen.push(readEditorContentPublication().blocked));
    const release = holdEditorContentPublication(), nested = holdEditorContentPublication();
    try {
      publishEditorContentProjection({ generation: 1, revisionId: 'candidate' });
      nested(); nested();
      publishEditorContentProjection({ generation: 2, revisionId: 'installed' });
      expect(seen.every(Boolean)).toBe(true);
      release();
      expect(readEditorContentPublication()).toEqual({ generation: 2, revisionId: 'installed', blocked: false });
    } finally { nested(); release(); unsubscribe(); }
  });
});
