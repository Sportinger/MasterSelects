import { describe, expect, it } from 'vitest';
import { createMemoryArchiveOutput } from '../../src/components/mobileSkin/project/phoneProjectArchive';
import { parsePhoneProjectVersions } from '../../src/components/mobileSkin/project/phoneProjectVersions';

describe('phone project archive and versions', () => {
  it('collects the archive stream in memory and refuses an empty archive', async () => {
    const output = createMemoryArchiveOutput();
    await output.write(new Uint8Array([1, 2, 3]));
    await output.write(new Uint8Array([4]));
    await output.close();
    expect(output.result()?.size).toBe(4);
    await expect(createMemoryArchiveOutput().close()).rejects.toThrow('empty');
  });

  it('parses named versions newest first and skips rows without a revision', () => {
    const versions = parsePhoneProjectVersions([
      { key: 'named-version:1', value: { name: 'First', revisionId: 'r1', createdAt: 1 } },
      { key: 'named-version:2', value: { name: 'Second', revisionId: 'r2', createdAt: 5 } },
      { key: 'named-version:3', value: { name: 'Broken' } },
    ]);
    expect(versions.map((version) => version.name)).toEqual(['Second', 'First']);
  });
});
