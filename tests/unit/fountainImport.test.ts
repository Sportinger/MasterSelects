import { describe, expect, it } from 'vitest';
import { parseFountainDocument } from '../../src/services/documents/fountainImport';
import { importProjectDocument } from '../../src/services/documents/importDocument';
import { exportFdx, exportFountain } from '../../src/services/documents/exportExchange';
import type { ProjectDocument } from '../../src/types/documents';

const fountain = `Title: Night Shift
Author: A. Writer
Contact: production@example.com

INT. STATION - NIGHT #12#

MARA
(whispering)
We should leave now.

BOB^
I disagree.

===
`;

describe('Fountain screenplay import', () => {
  it('keeps scenes, cues, parentheticals, dialogue and page breaks distinct', () => {
    let nextId = 0;
    const parsed = parseFountainDocument(fountain, () => `block-${++nextId}`);
    expect(parsed.titlePage).toEqual({ title: 'Night Shift', author: 'A. Writer',
      contact: 'production@example.com' });
    expect(parsed.blocks.map(block => block.kind)).toEqual([
      'scene', 'character', 'parenthetical', 'dialogue', 'dual-dialogue', 'dialogue', 'page-break',
    ]);
    expect(parsed.blocks[0]).toMatchObject({ text: 'INT. STATION - NIGHT', sceneNumber: '12' });
    expect(parsed.blocks[4].text).toBe('BOB');
  });

  it('passes title-page metadata through the file importer', async () => {
    const bytes = new TextEncoder().encode(fountain);
    const file = { name: 'night-shift.fountain', type: 'text/plain', size: bytes.length,
      arrayBuffer: async () => bytes.buffer.slice(0) } as File;
    const imported = await importProjectDocument(file);
    expect(imported.kind).toBe('screenplay');
    expect(imported.screenplayTitlePage?.title).toBe('Night Shift');
    expect(imported.blocks[3]).toMatchObject({ kind: 'dialogue', text: 'We should leave now.' });
    expect(imported.source.originalText).toBe(fountain);
  });

  it('reads multiline title fields and forced mixed-case character cues', () => {
    let nextId = 0;
    const source = `Title:\n   The Night\n   Shift\nCredit: Written by\nAuthors: A. Writer\nContact:\n   Main Street\n   Berlin\n\nINT. STUDIO - DAY\n\n@McQueen\nReady.\n\n@O'Brien ^\nAlways.\n`;
    const parsed = parseFountainDocument(source, () => `block-${++nextId}`);
    expect(parsed.titlePage).toEqual({ title: 'The Night\nShift', author: 'A. Writer',
      contact: 'Main Street\nBerlin' });
    expect(parsed.blocks.map(block => block.kind)).toEqual([
      'scene', 'character', 'dialogue', 'dual-dialogue', 'dialogue',
    ]);
    expect(parsed.blocks[1].text).toBe('McQueen');
    const document = { ...scriptDocument, blocks: parsed.blocks,
      screenplay: { ...scriptDocument.screenplay, titlePage: parsed.titlePage } } as ProjectDocument;
    const exported = exportFountain(document);
    expect(exported).toContain('@McQueen\n');
    expect(exported).toContain("@O'Brien ^\n");
    expect(exported).toContain('Contact:\n   Main Street\n   Berlin');
  });

  it('round-trips paired dialogue through the FDX DualDialogue wrapper', async () => {
    const blocks = parseFountainDocument(fountain, () => crypto.randomUUID()).blocks;
    const document = { ...scriptDocument, blocks } as ProjectDocument;
    const fdx = exportFdx(document);
    expect(fdx).toContain('<Paragraph Type="General"><DualDialogue>');
    expect(fdx).toContain('<Paragraph Type="Character"><Text>BOB</Text></Paragraph>');
    const bytes = new TextEncoder().encode(fdx);
    const file = { name: 'night-shift.fdx', type: 'application/xml', size: bytes.length,
      arrayBuffer: async () => bytes.buffer.slice(0) } as File;
    const imported = await importProjectDocument(file);
    expect(imported.blocks.map(block => block.kind)).toEqual([
      'scene', 'character', 'parenthetical', 'dialogue', 'dual-dialogue', 'dialogue',
    ]);
    expect(imported.blocks[4].text).toBe('BOB');
  });
});

const scriptDocument = {
  id: 'script', title: 'Night Shift', kind: 'screenplay', schemaVersion: 1,
  revision: 1, createdAt: 1, updatedAt: 1, blocks: [], links: [], comments: [],
  screenplay: { pageSize: 'letter', sceneNumbers: false, revisions: [] },
};
