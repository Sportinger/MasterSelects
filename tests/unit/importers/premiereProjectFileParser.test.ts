// @vitest-environment node
import { File as NodeFile } from 'node:buffer';
import { gzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { parsePremiereProjectFile } from '../../../src/importers/premiere/premiereProjectFileParser';

describe('Premiere project file streaming parser', () => {
  it('decompresses gzip incrementally and reports progress before building', async () => {
    const xml = '<PremiereData><Sequence ObjectUID="seq-gzip"><Name>Gzip Sequence</Name></Sequence></PremiereData>';
    const file = new NodeFile([gzipSync(xml)], 'Gzip.prproj', { type: 'application/octet-stream' });
    const onProgress = vi.fn();

    const result = await parsePremiereProjectFile(file as unknown as File, [], null, { onProgress });

    expect(result.compositions[0]?.name).toBe('Gzip Sequence');
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ phase: 'parsing' }));
    expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'complete', percent: 100 }));
  });
});
