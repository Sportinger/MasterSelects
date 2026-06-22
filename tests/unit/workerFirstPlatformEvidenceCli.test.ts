import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

type ProofPlatform =
  | 'windows-chromium'
  | 'linux-chromium-mesa'
  | 'linux-firefox-mesa'
  | 'macos-safari'
  | 'macos-firefox';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const scriptPath = join(repoRoot, 'scripts', 'run-worker-first-platform-evidence.mjs');
const execFileAsync = promisify(execFile);
const requiredPlatforms: ProofPlatform[] = [
  'windows-chromium',
  'linux-chromium-mesa',
  'linux-firefox-mesa',
  'macos-safari',
  'macos-firefox',
];

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const entry = (value as Record<string, unknown>)[key];
      if (entry !== undefined) {
        sorted[key] = canonicalize(entry);
      }
    }
    return sorted;
  }
  return typeof value === 'number' && !Number.isFinite(value) ? null : value;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function hashEvidencePayload(value: unknown): string {
  return createHash('sha256').update(stableStringify(value), 'utf8').digest('hex');
}

function createPackage(platform: ProofPlatform, frameCount: number, strategy = 'worker-cpu-present') {
  const payload = {
    schema: 'worker-first-platform-evidence/v1',
    packageId: `worker-first-platform-evidence:${platform}:1000`,
    createdAt: 1000 + frameCount,
    finishedAt: 1200 + frameCount,
    durationMs: 200,
    platform,
    strategy,
    requiredPlatforms,
    settings: {
      durationMs: 1000,
      width: 1280,
      height: 720,
    },
    capabilityProbe: {
      platform,
      selectedStrategy: strategy,
      browserEngine: platform.includes('firefox') ? 'firefox' : platform.includes('safari') ? 'webkit' : 'chromium',
      os: platform.startsWith('linux') ? 'linux' : platform.startsWith('macos') ? 'macos' : 'windows',
      facts: { workerNavigatorGpu: true },
      timestamp: 1100,
    },
    fixture: {
      success: true,
      error: null,
      data: { projectId: 'solid-text-image' },
    },
    visibleStress: {
      source: 'renderTarget:preview',
      platform,
      strategy,
      playbackDurationMs: 1000,
      frameCount,
      staleVisibleFrameCount: 0,
      nonBlankRatio: 1,
      attached: true,
      viewportIntersecting: true,
      centerOccluded: false,
      errors: [],
    },
    statsBeforeStress: {
      engineReady: true,
      w5GateEvidenceMode: 'stats-observation',
      canStartWorkerWebGpu: false,
      canStartWorkerPresentation: false,
      canStartRenderDispatcherCutover: false,
    },
    statsAfterStress: {
      engineReady: true,
      w5GateEvidenceMode: 'stats-observation',
      canStartWorkerWebGpu: false,
      canStartWorkerPresentation: false,
      canStartRenderDispatcherCutover: false,
    },
    playbackTrace: {
      playbackStatus: 'ok',
      previewFrames: frameCount,
      previewUpdates: frameCount,
      stalePreviewFrames: 0,
      w5GateEvidenceMode: 'stats-observation',
      canStartWorkerWebGpu: false,
      canStartWorkerPresentation: false,
      canStartRenderDispatcherCutover: false,
    },
    acceptedGate: {
      w5GateEvidenceMode: 'accepted-gate-run',
      proofCaptureCounts: {
        goldenFixtures: 38,
        shadowSamples: 10,
        visibleProofs: 1,
      },
      workerShadowParityStatus: 'passed',
      visiblePresentationStatus: 'blocked',
      missingPlatforms: requiredPlatforms.filter((entry) => entry !== platform),
      canStartWorkerWebGpu: false,
      canStartWorkerPresentation: false,
      canStartRenderDispatcherCutover: false,
    },
    checks: {
      capabilityProbeSucceeded: true,
      platformResolved: true,
      fixtureSucceeded: true,
      visibleStressSucceeded: true,
      visibleStressNoStaleFrames: true,
      visibleStressNonBlank: true,
      statsBeforeStressSucceeded: true,
      statsAfterStressSucceeded: true,
      playbackTraceSucceeded: true,
      statsStartPermissionsRemainFalse: true,
      traceStartPermissionsRemainFalse: true,
    },
    errors: {
      fixture: null,
      visibleStress: null,
      statsBeforeStress: null,
      statsAfterStress: null,
      playbackTrace: null,
    },
    w5StartPermissionsRemainStatsGuarded: true,
  };
  return {
    ...payload,
    evidenceHash: hashEvidencePayload(payload),
  };
}

function runCli(args: string[]): string {
  return execFileSync(process.execPath, [scriptPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

async function runCliAsync(args: string[]): Promise<string> {
  const { stdout, stderr } = await execFileAsync(process.execPath, [scriptPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  return `${stdout}${stderr}`;
}

function runCliFailure(args: string[]): { output: string; status: number | null } {
  try {
    runCli(args);
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; status?: number };
    return {
      output: `${failure.stdout ?? ''}${failure.stderr ?? ''}`,
      status: typeof failure.status === 'number' ? failure.status : null,
    };
  }
  throw new Error('Expected CLI command to fail');
}

function createReadinessReport(pkg: ReturnType<typeof createPackage>) {
  const tabId = `tab-${pkg.platform}`;
  return {
    name: 'Worker-First platform evidence package run',
    targetTabId: tabId,
    readiness: {
      targetWaitTimeoutMs: 12000,
      targetWaitedMs: 25,
      targetPollCount: 1,
      selectedTabBeforeSettle: { tabId },
      selectedTabAfterSettle: { tabId },
      postSelectionSettleMs: 12000,
      postSelectionSettleWaitedMs: 12001,
    },
  };
}

function writePackages(outDir: string, options: { reports?: boolean } = {}): void {
  const packages = [
    createPackage('windows-chromium', 287),
    createPackage('linux-chromium-mesa', 10),
    createPackage('linux-firefox-mesa', 82, 'worker-webgpu-main-present'),
  ];
  for (const pkg of packages) {
    const basename = `${pkg.platform}`;
    writeFileSync(
      join(outDir, `${basename}.package.json`),
      `${JSON.stringify(pkg, null, 2)}\n`,
      'utf8',
    );
    if (options.reports) {
      writeFileSync(
        join(outDir, `${basename}.report.json`),
        `${JSON.stringify(createReadinessReport(pkg), null, 2)}\n`,
        'utf8',
      );
    }
  }
}

async function withFakeBridge<T>(
  expectedToken: string,
  run: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const server = createServer((req, res) => {
    if (req.url === '/api/ai-tools' && req.method === 'GET') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ status: 'ready', clients: 1, clientTabs: [] }));
      return;
    }
    if (req.url === '/api/ai-tools/auth-check' && req.method === 'GET') {
      if (req.headers.authorization !== `Bearer ${expectedToken}`) {
        res.statusCode = 401;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Invalid bridge token' }));
        return;
      }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    res.statusCode = 404;
    res.end('not found');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function readRequestJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on('error', reject);
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) as Record<string, unknown> : {});
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function withDelayedCollectBridge<T>(
  expectedToken: string,
  pkg: ReturnType<typeof createPackage>,
  run: (baseUrl: string, state: { statusRequests: number; postBodies: Record<string, unknown>[] }) => Promise<T>,
  options: { success?: boolean; error?: string; readyAfterStatusRequests?: number } = {},
): Promise<T> {
  const success = options.success ?? true;
  const readyAfterStatusRequests = options.readyAfterStatusRequests ?? 2;
  const state = {
    statusRequests: 0,
    postBodies: [] as Record<string, unknown>[],
  };
  const server = createServer(async (req, res) => {
    if (req.url === '/api/ai-tools' && req.method === 'GET') {
      state.statusRequests += 1;
      const loaded = state.statusRequests >= readyAfterStatusRequests;
      const clientTabs = loaded
        ? [{
            tabId: 'ready-tab',
            visibilityState: 'visible',
            hasFocus: true,
            lastSeenAgoMs: 5,
            unresponsiveForMs: 0,
          }]
        : [{
            tabId: 'stale-tab',
            visibilityState: 'visible',
            hasFocus: true,
            lastSeenAgoMs: 45000,
            unresponsiveForMs: 0,
          }];
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        status: 'ready',
        clients: 1,
        clientTabs,
      }));
      return;
    }
    if (req.url === '/api/ai-tools/auth-check' && req.method === 'GET') {
      if (req.headers.authorization !== `Bearer ${expectedToken}`) {
        res.statusCode = 401;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Invalid bridge token' }));
        return;
      }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    if (req.url === '/api/ai-tools' && req.method === 'POST') {
      if (req.headers.authorization !== `Bearer ${expectedToken}`) {
        res.statusCode = 401;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Invalid bridge token' }));
        return;
      }
      const body = await readRequestJson(req);
      state.postBodies.push(body);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        success,
        error: success ? undefined : options.error ?? 'Platform evidence package did not satisfy all checks.',
        data: { package: pkg },
      }));
      return;
    }
    res.statusCode = 404;
    res.end('not found');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  try {
    return await run(`http://127.0.0.1:${address.port}`, state);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('worker-first platform evidence CLI', () => {
  it('prints the real-Mac Safari/Firefox collection runbook', () => {
    const output = runCli(['macos-runbook']);

    expect(output).toContain('Do not use Playwright WebKit');
    expect(output).toContain('--expect-platform macos-safari --wait-ms 12000');
    expect(output).toContain('--expect-platform macos-firefox --wait-ms 12000');
    expect(output).toContain('*.package.json files and their matching *.report.json files');
    expect(output).toContain('tmp/worker-first-platform-evidence');
  });

  it('prints proof details and Mac next-step guidance for a partial matrix', () => {
    const outDir = mkdtempSync(join(tmpdir(), 'worker-first-platform-cli-'));
    try {
      writePackages(outDir);

      const output = runCli(['status', '--out', outDir, '--latest-per-platform']);

      expect(output).toContain('Valid packages: 3/3');
      expect(output).toContain('Missing platforms: macos-safari, macos-firefox');
      expect(output).toContain('windows-chromium: valid strategy=worker-cpu-present frames=287 stale=0 nonBlank=1');
      expect(output).toContain('linux-chromium-mesa: valid strategy=worker-cpu-present frames=10 stale=0 nonBlank=1');
      expect(output).toContain('linux-firefox-mesa: valid strategy=worker-webgpu-main-present frames=82 stale=0 nonBlank=1');
      expect(output).toContain('Readiness reports: 0/3 auditable (missing report: 3, legacy report: 0, invalid: 0)');
      expect(output).toContain('Next: run npm run worker-first:platform:macos-runbook on a real Mac');
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('reports auditable readiness when selected packages have companion collect reports', () => {
    const outDir = mkdtempSync(join(tmpdir(), 'worker-first-platform-cli-'));
    try {
      writePackages(outDir, { reports: true });

      const output = runCli(['status', '--out', outDir, '--latest-per-platform']);

      expect(output).toContain('Valid packages: 3/3');
      expect(output).toContain('Readiness reports: 3/3 auditable (missing report: 0, legacy report: 0, invalid: 0)');
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('writes next-step guidance into expected-failing verify reports', () => {
    const outDir = mkdtempSync(join(tmpdir(), 'worker-first-platform-cli-'));
    try {
      writePackages(outDir);

      const failure = runCliFailure(['verify', '--out', outDir, '--latest-per-platform']);

      expect(failure.status).not.toBe(0);
      expect(failure.output).toContain('Matrix: incomplete');
      expect(failure.output).toContain('Platform proofs:');
      expect(failure.output).toContain('Next: run npm run worker-first:platform:macos-runbook on a real Mac');

      const reportFile = readdirSync(outDir).find((entry) => entry.endsWith('-offline-platform-matrix.report.json'));
      expect(reportFile).toBeTruthy();
      const report = JSON.parse(readFileSync(join(outDir, reportFile ?? ''), 'utf8')) as {
        nextStep?: string;
        result?: { data?: { missingPlatforms?: string[] } };
      };

      expect(report.nextStep).toContain('worker-first:platform:macos-runbook');
      expect(report.result?.data?.missingPlatforms).toEqual(['macos-safari', 'macos-firefox']);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('reports doctor bridge auth failures when the token file does not match the server', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'worker-first-platform-cli-'));
    try {
      writePackages(outDir);
      const tokenFile = join(outDir, 'bridge-token.txt');
      writeFileSync(tokenFile, 'wrong-token\n', 'utf8');

      await withFakeBridge('expected-token', async (baseUrl) => {
        const output = await runCliAsync([
          'doctor',
          '--out',
          outDir,
          '--token-file',
          tokenFile,
          '--base-url',
          baseUrl,
          '--latest-per-platform',
        ]);

        expect(output).toContain('Bridge: ');
        expect(output).toContain('Bridge clients: 1');
        expect(output).toContain('Bridge auth: failed');
        expect(output).toContain('Invalid bridge token');
      });

      const reportFile = readdirSync(outDir).find((entry) => entry.endsWith('-platform-doctor.report.json'));
      expect(reportFile).toBeTruthy();
      const report = JSON.parse(readFileSync(join(outDir, reportFile ?? ''), 'utf8')) as {
        bridgeAuthError?: string;
        tokenFile?: string;
      };

      expect(report.bridgeAuthError).toContain('Invalid bridge token');
      expect(report.tokenFile).toBe(tokenFile);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('waits for MasterSelects to register a bridge tab before collecting evidence', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'worker-first-platform-cli-'));
    try {
      const tokenFile = join(outDir, 'bridge-token.txt');
      writeFileSync(tokenFile, 'expected-token\n', 'utf8');
      const pkg = createPackage('windows-chromium', 12);

      await withDelayedCollectBridge('expected-token', pkg, async (baseUrl, state) => {
        const output = await runCliAsync([
          'collect',
          '--out',
          outDir,
          '--token-file',
          tokenFile,
          '--base-url',
          baseUrl,
          '--expect-platform',
          'windows-chromium',
          '--wait-ms',
          '1000',
        ]);

        expect(output).toContain('Waiting up to 1000ms for a live MasterSelects bridge tab');
        expect(output).toContain('Target tab: ready-tab');
        expect(output).not.toContain('Target tab: stale-tab');
        expect(output).toContain('Waiting 1000ms after target tab selection for MasterSelects to settle');
        expect(state.statusRequests).toBeGreaterThanOrEqual(3);
        expect(state.postBodies[0]).toMatchObject({
          tool: 'runWorkerFirstPlatformEvidencePackage',
          targetTabId: 'ready-tab',
        });
      });

      const packageFile = readdirSync(outDir).find((entry) => entry.endsWith('.package.json'));
      expect(packageFile).toBeTruthy();
      const writtenPackage = JSON.parse(readFileSync(join(outDir, packageFile ?? ''), 'utf8')) as {
        platform?: string;
      };
      expect(writtenPackage.platform).toBe('windows-chromium');

      const reportFile = readdirSync(outDir).find((entry) => entry.endsWith('.report.json'));
      expect(reportFile).toBeTruthy();
      const report = JSON.parse(readFileSync(join(outDir, reportFile ?? ''), 'utf8')) as {
        readiness?: {
          targetWaitTimeoutMs?: number;
          targetWaitedMs?: number;
          targetPollCount?: number;
          selectedTabBeforeSettle?: { tabId?: string };
          selectedTabAfterSettle?: { tabId?: string };
          postSelectionSettleMs?: number;
          postSelectionSettleWaitedMs?: number;
        };
      };
      expect(report.readiness).toMatchObject({
        targetWaitTimeoutMs: 1000,
        targetPollCount: 2,
        selectedTabBeforeSettle: { tabId: 'ready-tab' },
        selectedTabAfterSettle: { tabId: 'ready-tab' },
        postSelectionSettleMs: 1000,
      });
      expect(report.readiness?.targetWaitedMs).toBeGreaterThanOrEqual(200);
      expect(report.readiness?.postSelectionSettleWaitedMs).toBeGreaterThanOrEqual(250);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('writes failed collect payloads outside the selectable package glob', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'worker-first-platform-cli-'));
    try {
      const tokenFile = join(outDir, 'bridge-token.txt');
      writeFileSync(tokenFile, 'expected-token\n', 'utf8');
      const pkg = createPackage('linux-chromium-mesa', 12);

      await withDelayedCollectBridge(
        'expected-token',
        pkg,
        async (baseUrl) => {
          const failure = await (async () => {
            try {
              await runCliAsync([
                'collect',
                '--out',
                outDir,
                '--token-file',
                tokenFile,
                '--base-url',
                baseUrl,
                '--expect-platform',
                'linux-chromium-mesa',
                '--wait-ms',
                '300',
              ]);
            } catch (error) {
              const commandError = error as { stdout?: string; stderr?: string; code?: number };
              return `${commandError.stdout ?? ''}${commandError.stderr ?? ''}`;
            }
            throw new Error('Expected collect to fail');
          })();

          expect(failure).toContain('Platform evidence package did not satisfy all checks');
        },
        { success: false, readyAfterStatusRequests: 1 },
      );

      expect(readdirSync(outDir).filter((entry) => entry.endsWith('.package.json'))).toEqual([]);
      const failedFile = readdirSync(outDir).find((entry) => entry.endsWith('.failed.json'));
      expect(failedFile).toBeTruthy();
      const reportFile = readdirSync(outDir).find((entry) => entry.endsWith('.report.json'));
      expect(reportFile).toBeTruthy();
      const report = JSON.parse(readFileSync(join(outDir, reportFile ?? ''), 'utf8')) as {
        selectablePackage?: boolean;
        packagePath?: string;
      };
      expect(report.selectablePackage).toBe(false);
      expect(report.packagePath).toContain('.failed.json');
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});
