import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { NATIVE_HELPER_TARGET_VERSION } from '../../src/services/nativeHelper/releases';
import { APP_VERSION } from '../../src/version';

const repoRoot = process.cwd();

function readRepoFile(repoPath: string): string {
  return readFileSync(path.join(repoRoot, repoPath), 'utf8');
}

describe('app version consistency', () => {
  it('keeps release metadata and user-visible version surfaces aligned', () => {
    const packageJson = JSON.parse(readRepoFile('package.json')) as { version?: string };
    const packageLock = JSON.parse(readRepoFile('package-lock.json')) as {
      version?: string;
      packages?: Record<string, { version?: string }>;
    };
    const changelog = JSON.parse(readRepoFile('src/changelog-data.json')) as {
      title?: string;
    }[];
    const readmeVersion = readRepoFile('README.md')
      .match(/shields\.io\/badge\/version-([0-9]+\.[0-9]+\.[0-9]+)-/u)?.[1];

    expect(packageJson.version).toBe(APP_VERSION);
    expect(packageLock.version).toBe(APP_VERSION);
    expect(packageLock.packages?.['']?.version).toBe(APP_VERSION);
    expect(changelog[0]?.title).toBe(`MasterSelects ${APP_VERSION}`);
    expect(readmeVersion).toBe(APP_VERSION);
  });

  it('keeps the separately versioned Native Helper release surfaces aligned', () => {
    const cargoManifestVersion = readRepoFile('tools/native-helper/Cargo.toml')
      .match(/^\s*version\s*=\s*"([^"]+)"/mu)?.[1];
    const cargoLockVersion = readRepoFile('tools/native-helper/Cargo.lock')
      .match(/\[\[package\]\]\s+name = "masterselects-helper"\s+version = "([^"]+)"/u)?.[1];
    const workflowDefaultVersion = readRepoFile('.github/workflows/native-helper-release.yml')
      .match(/default:\s*'v([^']+)'/u)?.[1];

    expect(cargoManifestVersion).toBe(NATIVE_HELPER_TARGET_VERSION);
    expect(cargoLockVersion).toBe(NATIVE_HELPER_TARGET_VERSION);
    expect(workflowDefaultVersion).toBe(NATIVE_HELPER_TARGET_VERSION);
  });
});
