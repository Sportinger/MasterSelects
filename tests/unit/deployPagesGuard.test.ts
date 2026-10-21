// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeployGuardError, deployPages } from '../../scripts/deploy-pages.mjs';
import { checkGreenCi, checkOwnBuild, onlyVersionLinesChanged } from '../../scripts/deploy-pages-checks.mjs';

const HEAD = 'a'.repeat(40);
const PREVIOUS = 'https://prev123.masterselects.pages.dev';

let root: string;
let calls: string[][];
let served: Record<string, string>;

function writeBuild(overrides: Record<string, unknown> = {}): void {
  mkdirSync(path.join(root, 'dist', 'assets'), { recursive: true });
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '3.2.6' }));
  writeFileSync(path.join(root, 'dist', 'build-info.json'), JSON.stringify({
    schema: 'masterselects-build/v1', version: '3.2.6', buildId: '2026-10-21T20:00:00.000Z',
    sourceRevision: HEAD, sourceDirty: false, releaseId: `masterselects-3.2.6-${HEAD}`, ...overrides,
  }));
  writeFileSync(path.join(root, 'dist', 'index.html'), '<script type="module" crossorigin src="/assets/index-new.js"></script>');
  writeFileSync(path.join(root, 'dist', 'assets', 'index-new.js'), 'new URL("/assets/projectStorage.worker-new1.js",import.meta.url)');
  writeFileSync(path.join(root, 'dist', 'assets', 'projectStorage.worker-new1.js'), 'self.onmessage=()=>{}');
}

function fakeRun(options: { greenRuns?: string[]; dirty?: boolean } = {}) {
  return (command: string, args: string[]): string => {
    calls.push([command, ...args]);
    const line = [command, ...args].join(' ');
    if (line === 'git rev-parse HEAD') return `${HEAD}\n`;
    if (line.startsWith('gh run list')) return JSON.stringify((options.greenRuns ?? [HEAD]).map(headSha => ({ headSha })));
    if (line.startsWith('git status')) return options.dirty ? ' M src/App.tsx\n' : '';
    if (line.startsWith('npx wrangler pages deployment list')) {
      return `Fetching deployments...\n${JSON.stringify([{ Deployment: `${PREVIOUS}/`, Source: 'bbbbbbb' }])}`;
    }
    if (line.startsWith('npx wrangler pages deploy ')) return '';
    if (line.startsWith('npm run build:deploy')) return '';
    throw new Error(`unexpected command: ${line}`);
  };
}

function deployCalls(): string[][] {
  return calls.filter(call => call.slice(0, 4).join(' ') === 'npx wrangler pages deploy');
}

async function runDeploy(argv: string[], run = fakeRun()) {
  return deployPages({ argv, cwd: root, run, log: () => {} });
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'deploy-pages-'));
  calls = [];
  served = {
    [`${PREVIOUS}/editor`]: '<script type="module" crossorigin src="/assets/index-prev.js"></script><link rel="stylesheet" href="/assets/index-prev.css">',
    [`${PREVIOUS}/assets/index-prev.js`]: 'const w=new URL("/assets/projectStorage.worker-prev1.js",import.meta.url);import("./App-prev.js")',
    [`${PREVIOUS}/assets/index-prev.css`]: 'body{}',
    [`${PREVIOUS}/assets/App-prev.js`]: 'export default 1',
    [`${PREVIOUS}/assets/projectStorage.worker-prev1.js`]: 'self.onmessage=()=>{}',
  };
  vi.stubGlobal('fetch', vi.fn(async (url: string) => (url in served
    ? new Response(served[url], { status: 200, headers: { 'content-type': 'application/javascript' } })
    : new Response('not found', { status: 404, headers: { 'content-type': 'text/html' } }))));
  writeBuild();
});

afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(root, { recursive: true, force: true });
});

describe('deploy:pages guard', () => {
  it('runs every check and retention in a dry run but never deploys', async () => {
    const result = await runDeploy(['--dry-run', '--skip-build']);
    expect(result.deployed).toBe(false);
    expect(deployCalls()).toEqual([]);
    for (const name of ['index-prev.js', 'index-prev.css', 'App-prev.js', 'projectStorage.worker-prev1.js']) {
      expect(existsSync(path.join(root, 'dist', 'assets', name))).toBe(true);
    }
    expect(result.deployArgs).toEqual(['wrangler', 'pages', 'deploy', 'dist', '--project-name', 'masterselects', '--branch', 'main']);
  });

  it('builds first and deploys with the documented flags once all checks pass', async () => {
    const result = await runDeploy([]);
    expect(result.deployed).toBe(true);
    const order = calls.map(call => call.slice(0, 4).join(' '));
    expect(order.indexOf('npm run build:deploy')).toBeLessThan(order.indexOf('npx wrangler pages deployment'));
    expect(deployCalls()).toEqual([['npx', 'wrangler', 'pages', 'deploy', 'dist', '--project-name', 'masterselects', '--branch', 'main']]);
  });

  it('refuses to deploy when the previous storage worker could not be retained', async () => {
    delete served[`${PREVIOUS}/assets/projectStorage.worker-prev1.js`];
    const error = await runDeploy(['--skip-build']).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DeployGuardError);
    expect((error as Error).message).toMatch(/storage worker projectStorage\.worker-prev1\.js of the previous deployment is not in dist\/assets/);
    expect(deployCalls()).toEqual([]);
  });

  it('refuses to deploy when the previous deployment serves no entry page', async () => {
    served = {};
    const error = await runDeploy(['--skip-build']).catch((caught: unknown) => caught);
    expect((error as Error).message).toMatch(/served no entry page/);
    expect((error as Error).message).toMatch(/no projectStorage\.worker-\*\.js is reachable/);
    expect(deployCalls()).toEqual([]);
  });

  it('refuses a build from a dirty checkout or another commit before touching deployments', async () => {
    writeBuild({ sourceDirty: true, sourceRevision: 'c'.repeat(40) });
    const error = await runDeploy(['--skip-build'], fakeRun({ dirty: true })).catch((caught: unknown) => caught);
    expect((error as DeployGuardError).step).toBe('Build check');
    expect((error as DeployGuardError).problems).toHaveLength(3);
    expect(calls.some(call => call.includes('deployment'))).toBe(false);
    expect(deployCalls()).toEqual([]);
  });

  it('refuses to deploy without a green Security Checks run', async () => {
    const error = await runDeploy(['--skip-build'], fakeRun({ greenRuns: [] })).catch((caught: unknown) => caught);
    expect((error as DeployGuardError).step).toBe('CI check');
    expect(calls.some(call => call[1] === 'run' && call[2] === 'build:deploy')).toBe(false);
    expect(deployCalls()).toEqual([]);
  });
});

describe('deploy:pages checks', () => {
  const bump = [
    '--- a/package.json', '+++ b/package.json', '@@ -3 +3 @@', '-  "version": "3.2.5",', '+  "version": "3.2.6",',
  ].join('\n');

  it('accepts a release commit that only bumps the version of a green commit', () => {
    const green = 'b'.repeat(40);
    const covered = checkGreenCi({
      head: HEAD,
      successfulRuns: [{ headSha: green }],
      describeRange: () => ({ files: ['package.json', 'package-lock.json', 'src/version.ts', 'src/changelog-data.json'], manifestDiff: bump }),
    });
    expect(covered).toEqual({ problems: [], coveredBy: green });
  });

  it('rejects a green parent when code or package scripts changed since', () => {
    const codeChange = checkGreenCi({
      head: HEAD, successfulRuns: [{ headSha: 'b'.repeat(40) }],
      describeRange: () => ({ files: ['src/version.ts', 'src/App.tsx'], manifestDiff: '' }),
    });
    expect(codeChange.coveredBy).toBeNull();
    expect(onlyVersionLinesChanged(`${bump}\n+    "deploy": "rm -rf /",`)).toBe(false);
    const notAncestor = checkGreenCi({ head: HEAD, successfulRuns: [{ headSha: 'b'.repeat(40) }], describeRange: () => null });
    expect(notAncestor.problems[0]).toMatch(/no green Security Checks run/);
  });

  it('requires the new build to carry its own entry chunks and storage worker', () => {
    expect(checkOwnBuild({ indexHtmlReferences: new Set(['index-new.js']), hasAsset: () => true, assetNames: ['index-new.js'] }))
      .toEqual(['dist/assets contains no projectStorage.worker-*.js']);
    expect(checkOwnBuild({ indexHtmlReferences: new Set(), hasAsset: () => true, assetNames: ['projectStorage.worker-x1.js'] }))
      .toEqual(['dist/index.html references no /assets/ entry chunk']);
  });
});
