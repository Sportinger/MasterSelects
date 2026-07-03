import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  allowedAdapterPaths,
  classCHardTargets,
  getStateAccessPolicyBaselines,
} from '../../src/architecture';

const repoRoot = process.cwd();
const sourceExtensions = new Set(['.ts', '.tsx']);
const getStateAccessPattern = /\.getState\(/g;

function toRepoPath(filePath: string): string {
  return path.relative(repoRoot, filePath).replace(/\\/g, '/');
}

function resolveRepoPath(repoPath: string): string {
  return path.join(repoRoot, repoPath.replace(/\//g, path.sep));
}

function walkFiles(root: string): string[] {
  if (!existsSync(root)) return [];

  return readdirSync(root).flatMap((entry) => {
    const fullPath = path.join(root, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) return walkFiles(fullPath);
    return [fullPath];
  });
}

function filesUnder(repoPath: string): string[] {
  return walkFiles(resolveRepoPath(repoPath)).filter((filePath) =>
    sourceExtensions.has(path.extname(filePath)),
  );
}

function countMatches(source: string, pattern: RegExp): number {
  return [...source.matchAll(new RegExp(pattern.source, pattern.flags))].length;
}

function isAllowedAdapterPath(repoPath: string): boolean {
  return allowedAdapterPaths.some((pattern) => {
    if (pattern.endsWith('/**')) {
      const prefix = pattern.slice(0, -3);
      return repoPath.startsWith(`${prefix}/`);
    }

    return repoPath === pattern;
  });
}

describe('getState access policy', () => {
  it('freezes bridge adapters and hard targets for P2 reduction packets', () => {
    expect(allowedAdapterPaths).toHaveLength(
      getStateAccessPolicyBaselines.allowedAdapterPathCount,
    );
    expect(classCHardTargets).toHaveLength(
      getStateAccessPolicyBaselines.classCHardTargetFileCount,
    );
    expect(
      classCHardTargets.reduce((sum, target) => sum + target.maxCurrentHits, 0),
    ).toBe(getStateAccessPolicyBaselines.classCHardTargetMaxHits);

    const targetPaths = classCHardTargets.map((target) => target.path);
    expect(new Set(targetPaths).size).toBe(targetPaths.length);

    for (const target of classCHardTargets) {
      expect(
        isAllowedAdapterPath(target.path),
        `${target.path} is both adapter-allowed and hard-targeted`,
      ).toBe(false);
      expect(existsSync(resolveRepoPath(target.path)), `${target.path} is missing`).toBe(true);
    }
  });

  it('rejects new non-adapter access and ceiling increases', () => {
    const targetByPath = new Map(
      classCHardTargets.map((target) => [target.path, target.maxCurrentHits]),
    );
    const unknownFiles: string[] = [];
    const exceededFiles: string[] = [];

    for (const filePath of filesUnder('src')) {
      const repoPath = toRepoPath(filePath);
      const count = countMatches(readFileSync(filePath, 'utf8'), getStateAccessPattern);
      if (count === 0 || isAllowedAdapterPath(repoPath)) continue;

      const ceiling = targetByPath.get(repoPath);
      if (ceiling === undefined) {
        unknownFiles.push(`${repoPath}: ${count}`);
        continue;
      }

      if (count > ceiling) {
        exceededFiles.push(`${repoPath}: ${count} > ${ceiling}`);
      }
    }

    expect(unknownFiles, 'new non-adapter getState files must be classified').toEqual([]);
    expect(exceededFiles, 'getState hard-target ceilings must not increase').toEqual([]);
  }, 15000);
});
