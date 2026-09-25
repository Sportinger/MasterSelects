import { describe, expect, it, vi } from 'vitest';

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: ({ data }: { data: Uint8Array }) => {
    // PDF.js may transfer and detach this buffer in its worker.
    data.fill(0);
    return {
      promise: Promise.resolve({
        numPages: 1,
        getPage: async () => ({
          getTextContent: async () => ({ items: [{ str: 'A readable page' }] }),
          cleanup: () => undefined,
        }),
      }),
      destroy: async () => undefined,
    };
  },
}));

import { importProjectDocument } from '../../src/services/documents/importDocument';

describe('PDF document import', () => {
  it('preserves the original PDF bytes when the parser consumes its input buffer', async () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
    const file = {
      name: 'script.pdf', type: 'application/pdf', size: bytes.length,
      arrayBuffer: async () => bytes.buffer.slice(0),
    } as File;

    const imported = await importProjectDocument(file);

    expect(imported.blocks[0]).toMatchObject({ text: 'A readable page', sourcePage: 1 });
    expect(imported.source.originalData).toBe(btoa('%PDF-1'));
  });
});
