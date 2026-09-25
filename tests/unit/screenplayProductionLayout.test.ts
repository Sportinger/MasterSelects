import { describe, expect, it } from 'vitest';
import { paginateScreenplay, screenplayTitlePage } from '../../src/services/documents/screenplayLayout';
import type { ProjectDocument } from '../../src/types/documents';
import { useDocumentsStore } from '../../src/stores/documentsStore';

function script(text: string): ProjectDocument {
  return {
    id: 'script-1', title: 'Station', kind: 'screenplay', schemaVersion: 1,
    revision: 1, createdAt: 1, updatedAt: 1,
    blocks: [{ id: 'long-action', kind: 'action', text }], links: [], comments: [],
    screenplay: { pageSize: 'letter', sceneNumbers: true, revisions: [],
      titlePage: { title: 'Station', author: 'Writer' } },
  };
}

describe('screenplay production pages', () => {
  it('assigns distinct page anchors when one block spans several pages', () => {
    const document = script(Array.from({ length: 150 }, (_, index) => `Action line ${index}`).join('\n'));
    const pages = paginateScreenplay(document);
    expect(pages.length).toBeGreaterThan(2);
    expect(new Set(pages.map(page => page.firstLineKey)).size).toBe(pages.length);
    expect(pages.map(page => page.label)).toEqual(pages.map((_, index) => String(index + 1)));
  });

  it('keeps the title sheet separate from numbered pages', () => {
    const document = script('INT. STATION - NIGHT');
    expect(screenplayTitlePage(document)).toMatchObject({ label: '', titlePage: true });
    expect(paginateScreenplay(document)[0].label).toBe('1');
    expect(paginateScreenplay(document)[0].titlePage).toBeUndefined();
  });

  it('keeps locked content on its numbered page after text is inserted ahead of it', () => {
    const original = script(Array.from({ length: 150 }, (_, index) => `Action line ${index}`).join('\n'));
    useDocumentsStore.getState().hydrate({ schemaVersion: 1, documents: [original] });
    useDocumentsStore.getState().lockProductionPages(original.id);
    const locked = useDocumentsStore.getState().documents[0];
    const pageTwoStart = paginateScreenplay(locked)[1].lines[0].text;
    const originalLines = original.blocks[0].text.split('\n');
    useDocumentsStore.getState().updateBlock(original.id, 'long-action',
      [...originalLines.slice(0, 10),
        ...Array.from({ length: 25 }, (_, index) => `Inserted line ${index}`),
        ...originalLines.slice(10)].join('\n'));
    const pages = paginateScreenplay(useDocumentsStore.getState().documents[0]);
    expect(pages.find(page => page.label === '2')?.lines[0].text).toBe(pageTwoStart);
    expect(pages.some(page => page.label === '1A')).toBe(true);
    useDocumentsStore.getState().reset();
  });

  it('retains the locked page label when an edit removes the exact line boundary', () => {
    const original = script(Array.from({ length: 150 }, (_, index) => `Action line ${index}`).join('\n'));
    useDocumentsStore.getState().hydrate({ schemaVersion: 1, documents: [original] });
    useDocumentsStore.getState().lockProductionPages(original.id);
    const locked = useDocumentsStore.getState().documents[0];
    const secondPage = paginateScreenplay(locked)[1];
    const before = original.blocks[0].text;
    useDocumentsStore.getState().updateBlock(original.id, 'long-action',
      `${before.slice(0, secondPage.firstLineOffset! - 1)} ${before.slice(secondPage.firstLineOffset!)}`);
    const pages = paginateScreenplay(useDocumentsStore.getState().documents[0]);
    expect(pages.some(page => page.label === '2')).toBe(true);
    expect(pages.map(page => page.label)).toEqual([...new Set(pages.map(page => page.label))]);
    useDocumentsStore.getState().reset();
  });

  it('marks every continuation of a dialogue spanning several pages', () => {
    const document = script('');
    document.blocks = [
      { id: 'speaker', kind: 'character', text: 'MARA' },
      { id: 'speech', kind: 'dialogue', text: Array.from({ length: 160 },
        (_, index) => `Dialogue line ${index}`).join('\n') },
    ];
    const pages = paginateScreenplay(document);
    expect(pages.length).toBeGreaterThan(3);
    for (const page of pages.slice(0, -1)) {
      expect(page.lines.at(-1)?.text).toBe('(MORE)');
    }
    for (const page of pages.slice(1)) {
      expect(page.lines[0].text).toBe("MARA (CONT'D)");
      expect(page.firstBlockId).toBe('speech');
    }
    expect(new Set(pages.map(page => page.firstLineOffset)).size).toBe(pages.length);
    expect(pages.at(-1)?.lines.at(-1)?.text).toBe('Dialogue line 159');
  });

  it('keeps a locked continuation page after dialogue is added earlier', () => {
    const document = script('');
    document.blocks = [
      { id: 'speaker', kind: 'character', text: 'MARA' },
      { id: 'speech', kind: 'dialogue', text: Array.from({ length: 120 },
        (_, index) => `Dialogue line ${index}`).join('\n') },
    ];
    useDocumentsStore.getState().hydrate({ schemaVersion: 1, documents: [document] });
    useDocumentsStore.getState().lockProductionPages(document.id);
    const lockedPage = paginateScreenplay(useDocumentsStore.getState().documents[0])[1];
    const lockedText = lockedPage.lines.find(line => !line.synthetic)?.text;
    const originalLines = document.blocks[1].text.split('\n');
    useDocumentsStore.getState().updateBlock(document.id, 'speech', [
      ...originalLines.slice(0, 10),
      ...Array.from({ length: 25 }, (_, index) => `Added line ${index}`),
      ...originalLines.slice(10),
    ].join('\n'));
    const pages = paginateScreenplay(useDocumentsStore.getState().documents[0]);
    expect(pages.find(page => page.label === '2')?.lines.find(line => !line.synthetic)?.text).toBe(lockedText);
    expect(pages.some(page => page.label === '1A')).toBe(true);
    useDocumentsStore.getState().reset();
  });

  it('places dual dialogue in parallel columns and continues long exchanges together', () => {
    const document = script('');
    document.blocks = [
      { id: 'left-cue', kind: 'character', text: 'MARA' },
      { id: 'left-dialogue', kind: 'dialogue', text: Array.from({ length: 70 },
        (_, index) => `Left response ${index}`).join('\n') },
      { id: 'right-cue', kind: 'dual-dialogue', text: 'BOB' },
      { id: 'right-dialogue', kind: 'dialogue', text: Array.from({ length: 70 },
        (_, index) => `Right response ${index}`).join('\n') },
    ];
    const pages = paginateScreenplay(document);
    const leftCue = pages[0].lines.find(line => line.text === 'MARA')!;
    const rightCue = pages[0].lines.find(line => line.text === 'BOB')!;
    const leftSpeech = pages[0].lines.find(line => line.text === 'Left response 0')!;
    const rightSpeech = pages[0].lines.find(line => line.text === 'Right response 0')!;
    expect(leftCue.y).toBe(rightCue.y);
    expect(leftSpeech.y).toBe(rightSpeech.y);
    expect(leftCue.x).toBeLessThan(rightCue.x);
    expect(leftSpeech.x).toBeLessThan(rightSpeech.x);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages[0].lines.filter(line => line.text === '(MORE)')).toHaveLength(2);
    expect(pages[1].lines.filter(line => line.text.endsWith("(CONT'D)"))).toHaveLength(2);
    expect(pages.at(-1)?.lines.some(line => line.text === 'Right response 69')).toBe(true);
  });

  it('keeps dual-dialogue continuation markers at a locked page boundary', () => {
    const document = script('');
    document.blocks = [
      { id: 'left-cue', kind: 'character', text: 'MARA' },
      { id: 'left-dialogue', kind: 'dialogue', text: Array.from({ length: 120 },
        (_, index) => `Left response ${index}`).join('\n') },
      { id: 'right-cue', kind: 'dual-dialogue', text: 'BOB' },
      { id: 'right-dialogue', kind: 'dialogue', text: Array.from({ length: 120 },
        (_, index) => `Right response ${index}`).join('\n') },
    ];
    useDocumentsStore.getState().hydrate({ schemaVersion: 1, documents: [document] });
    useDocumentsStore.getState().lockProductionPages(document.id);
    const lockedPage = paginateScreenplay(useDocumentsStore.getState().documents[0])[1];
    const lockedText = lockedPage.lines.find(line => line.blockId === 'left-dialogue' && !line.synthetic)?.text;
    const originalLines = document.blocks[1].text.split('\n');
    useDocumentsStore.getState().updateBlock(document.id, 'left-dialogue', [
      ...originalLines.slice(0, 10),
      ...Array.from({ length: 25 }, (_, index) => `Added line ${index}`),
      ...originalLines.slice(10),
    ].join('\n'));
    const pages = paginateScreenplay(useDocumentsStore.getState().documents[0]);
    const preservedPage = pages.find(page => page.label === '2')!;
    expect(preservedPage.lines.find(line => line.blockId === 'left-dialogue' && !line.synthetic)?.text)
      .toBe(lockedText);
    const previousPage = pages[pages.indexOf(preservedPage) - 1];
    expect(previousPage.lines.filter(line => line.text === '(MORE)').length).toBeGreaterThan(0);
    expect(preservedPage.lines.some(line => line.text.endsWith("(CONT'D)"))).toBe(true);
    useDocumentsStore.getState().reset();
  });
});
