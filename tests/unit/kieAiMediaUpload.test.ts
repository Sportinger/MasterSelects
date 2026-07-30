import { afterEach, describe, expect, it, vi } from 'vitest';

import { createKieAiMediaTools } from '../../src/services/kieAi/mediaUpload';

describe('Kie.ai media uploads', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uploads parallel image references with distinct names and detected PNG media types', async () => {
    const uploadedFiles: Array<{ fileName: string; mimeType: string }> = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body;
      if (!(body instanceof FormData)) {
        throw new Error('Expected a multipart upload');
      }

      const fileName = String(body.get('fileName'));
      const file = body.get('file');
      if (!(file instanceof Blob)) {
        throw new Error('Expected an uploaded image blob');
      }

      uploadedFiles.push({ fileName, mimeType: file.type });
      return new Response(JSON.stringify({
        data: {
          fileUrl: `https://cdn.example.com/${fileName}`,
        },
        success: true,
      }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const mediaTools = createKieAiMediaTools(() => 'kie_test_key', () => true);
    const uploadedUrls = await Promise.all([
      mediaTools.uploadImage('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB'),
      mediaTools.uploadImage('data:application/octet-stream;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAAC'),
    ]);

    expect(uploadedFiles).toHaveLength(2);
    expect(new Set(uploadedFiles.map(({ fileName }) => fileName)).size).toBe(2);
    expect(uploadedFiles.every(({ fileName }) => fileName.endsWith('.png'))).toBe(true);
    expect(uploadedFiles.every(({ mimeType }) => mimeType === 'image/png')).toBe(true);
    expect(uploadedUrls).toEqual(uploadedFiles.map(
      ({ fileName }) => `https://cdn.example.com/${fileName}`,
    ));
  });
});
