import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('public repository contents', () => {
  it('does not publish private planning directories or local credential files', () => {
    const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
      .split('\0').filter(file => file && existsSync(file));
    const privatePaths = tracked.filter(file =>
      /^(?:docs\/(?:private|plans|ongoing|completed\/plans)\/|plan\.md$|\.certs\/)/.test(file)
      || /(?:^|\/)(?:\.env(?:\.[^/]+)?|\.dev\.vars|\.ai-bridge-token)$/.test(file)
        && !file.endsWith('.example'));
    expect(privatePaths).toEqual([]);
  });
});
