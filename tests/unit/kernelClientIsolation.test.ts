import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const activeBoundaryFiles = [
  'functions/api/kernel/[[path]].ts',
  'functions/lib/hostedAgent/route.ts',
  'src/services/flashboard/FlashBoardHostedAgentTransport.ts',
  'src/services/kernelClient/hostedAgent/fastV2FetchTransport.ts',
];

describe('public Normal Path isolation', () => {
  it('does not embed private provider orchestration or import the private sibling', () => {
    for (const relativePath of activeBoundaryFiles) {
      const source = readFileSync(path.join(repoRoot, relativePath), 'utf8');
      expect(source, relativePath).not.toMatch(/(?:^|[\\/])masterselects-kernel(?:[\\/]|$)/iu);
      expect(source, relativePath).not.toContain('expertPack');
      expect(source, relativePath).not.toContain('blueprint');
    }
  });

  it('does not restore public V1 or deferred-settlement routes', () => {
    const source = activeBoundaryFiles
      .map((relativePath) => readFileSync(path.join(repoRoot, relativePath), 'utf8'))
      .join('\n');
    expect(source).not.toContain('/api/kernel/hosted-agent');
    expect(source).not.toContain('/kernel/hosted-agent');
    expect(source).not.toContain('operation-settlements');
  });
});
