import assert from 'node:assert/strict';
import { crc32 } from 'node:zlib';
import { yauzl } from '../../node_modules/playwright-core/lib/utilsBundle.js';

/** Reject incomplete archives and validate every saved trace entry's bytes. */
export async function verifyTraceArchive(bytes) {
  const zip = await new Promise((resolve, reject) =>
    yauzl.fromBuffer(bytes, { lazyEntries: true, validateEntrySizes: true }, (error, archive) => error ? reject(error) : resolve(archive)));
  const names = new Set(); let size = 0;
  try {
    await new Promise((resolve, reject) => {
      zip.once('error', reject); zip.once('end', resolve);
      zip.on('entry', entry => {
        try {
          assert.ok(!names.has(entry.fileName), 'Duplicate trace ZIP entry');
          names.add(entry.fileName);
          assert.ok(!(entry.generalPurposeBitFlag & 1), 'Encrypted trace entry');
          if (entry.fileName.endsWith('/')) { zip.readEntry(); return; }
          zip.openReadStream(entry, (error, stream) => {
            if (error) { reject(error); return; }
            let checksum = 0, count = 0;
            stream.on('error', reject);
            stream.on('data', chunk => { checksum = crc32(chunk, checksum); count += chunk.length; });
            stream.once('end', () => {
              try {
                assert.equal(count, entry.uncompressedSize, 'Trace entry size differs');
                assert.equal(checksum, entry.crc32, 'Trace entry CRC differs');
                size += count; zip.readEntry();
              } catch (failure) { reject(failure); }
            });
          });
        } catch (error) { reject(error); }
      });
      zip.readEntry();
    });
    assert.ok(names.has('trace.trace') && names.has('trace.network'), 'Trace records missing');
    return { entries: names.size, uncompressedBytes: size, allEntryCrcsVerified: true };
  } finally { zip.close(); }
}
