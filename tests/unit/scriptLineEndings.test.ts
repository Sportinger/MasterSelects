// @vitest-environment node
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../..');

// A CRLF checkout (core.autocrlf=true on Windows) breaks scripts at their `#!` line, and vitest
// cannot import an ESM script whose shebang ends in CRLF. .gitattributes pins them to LF.
describe('script line endings', () => {
  it('checks out every tracked ESM/CommonJS/shell script with LF line endings', () => {
    const listing = execFileSync('git', ['ls-files', '--eol', '--', '*.mjs', '*.cjs', '*.sh', 'android/gradlew'],
      { cwd: repoRoot, encoding: 'utf8' });
    const rows = listing.split('\n').filter(Boolean).map((line) => {
      const [info, file] = line.split('\t');
      return { file, attributes: info.split(/\s+/).slice(2).join(' ') };
    });
    expect(rows.length).toBeGreaterThan(20);
    // `-text` marks deliberate byte-exact fixtures.
    const notLf = rows.filter(row => !/eol=lf/.test(row.attributes) && !/-text/.test(row.attributes));
    expect(notLf).toEqual([]);
  });
});
