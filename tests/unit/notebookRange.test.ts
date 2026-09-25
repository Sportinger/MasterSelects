import { describe, expect, it } from 'vitest';
import { notebookAnchor, notebookAnchorOffsets, notebookStructuralText,
  replaceNotebookText } from '../../src/services/documents/notebookRange';
import type { ProjectDocument } from '../../src/types/documents';

function note(...texts: string[]): ProjectDocument {
  return { id: 'note', title: '', kind: 'general', schemaVersion: 2, revision: 1,
    createdAt: 1, updatedAt: 1,
    blocks: texts.map((text, index) => ({ id: `b${index}`, kind: 'paragraph', text })),
    links: [], comments: [], labels: [], scenes: [], formats: [] };
}

describe('Notebook text transactions', () => {
  it('replaces three selected paragraphs in one edit and maps a surrounding scene', () => {
    const original = note('alpha', 'beta', 'gamma');
    original.scenes = [{ id: 'scene', anchor: notebookAnchor(original.blocks, 0, 16) }];
    const changed = replaceNotebookText(original, { blockId: 'b0', offset: 2 },
      { blockId: 'b2', offset: 2 }, `Z\u2029Y`, () => 'new');
    expect(changed.blocks.map(block => block.text)).toEqual(['alZ', 'Ymma']);
    expect(changed.blocks.map(block => block.id)).toEqual(['b0', 'b2']);
    expect(changed.scenes?.[0].anchor.status).toBe('resolved');
    expect(notebookAnchorOffsets(changed.blocks, changed.scenes![0].anchor)).toEqual([0, 8]);
  });

  it('keeps a soft line break inside one paragraph', () => {
    const original = note('hello');
    const changed = replaceNotebookText(original, { blockId: 'b0', offset: 2 },
      { blockId: 'b0', offset: 2 }, '\n');
    expect(changed.blocks).toHaveLength(1);
    expect(changed.blocks[0].text).toBe('he\nllo');
    expect(notebookStructuralText(changed.blocks)).toBe('he\nllo');
  });

  it('grows a scene when typing at its end, while a label at the same edge stays put', () => {
    const original = note('Scene');
    const anchor = notebookAnchor(original.blocks, 0, 5);
    original.scenes = [{ id: 'scene', anchor }];
    original.labels = [{ id: 'label', name: 'Idea', anchor }];
    const changed = replaceNotebookText(original, { blockId: 'b0', offset: 5 },
      { blockId: 'b0', offset: 5 }, ' one');
    expect(changed.scenes?.[0].anchor.quote).toBe('Scene one');
    expect(changed.labels?.[0].anchor.quote).toBe('Scene');
  });

  it('keeps a deleted reference repairable at a surviving position', () => {
    const original = note('before', 'remove', 'after');
    original.links = [{ id: 'link', anchor: notebookAnchor(original.blocks, 7, 13),
      target: { kind: 'source', mediaId: 'media' } }];
    const changed = replaceNotebookText(original, { blockId: 'b1', offset: 0 },
      { blockId: 'b2', offset: 0 }, '');
    expect(changed.blocks.map(block => block.id)).toEqual(['b0', 'b2']);
    expect(changed.links[0].anchor.status).toBe('orphaned');
    expect(changed.links[0].anchor.quote).toBe('remove');
    expect(notebookAnchorOffsets(changed.blocks, changed.links[0].anchor)).not.toBeNull();
  });
});
