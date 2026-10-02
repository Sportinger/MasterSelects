import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { StreamHash } from '../../src/services/project/repository/segments/streamHash';

describe('streaming SHA-256', () => {
  it('matches native SHA-256 across padding boundaries, partial chunks and offset views', () => {
    for (const length of [0, 1, 55, 56, 63, 64, 65, 127, 128, 129, 8193, 1024 * 1024 + 1]) {
      const backing = new Uint8Array(length + 11);
      const bytes = backing.subarray(7, length + 7);
      for (let i = 0; i < length; i++) bytes[i] = (i * 31) % 251;
      const expected = 'sha256:' + createHash('sha256').update(bytes).digest('hex');
      for (const chunkSize of [1, 63, 64, 65, 4096, Math.max(1, length)]) {
        if (length > 8193 && chunkSize < 4096) continue;
        const hash = new StreamHash();
        for (let offset = 0; offset < length; offset += chunkSize) hash.update(bytes.subarray(offset, offset + chunkSize));
        expect(hash.digest()).toBe(expected);
      }
    }
  });
});
