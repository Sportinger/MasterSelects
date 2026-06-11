import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultManifestPath = path.join(repoRoot, 'docs', 'Features', 'assets', 'docs-screenshot-manifest.json');

const browserCandidates = process.platform === 'win32'
  ? [
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    ]
  : process.platform === 'darwin'
    ? [
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
      ]
    : [
        '/usr/bin/microsoft-edge',
        '/usr/bin/microsoft-edge-stable',
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
      ];

function parseArgs(argv) {
  const args = {
    baseUrl: process.env.DOCS_SCREENSHOT_BASE_URL ?? null,
    browser: process.env.DOCS_SCREENSHOT_BROWSER ?? null,
    id: null,
    manifest: defaultManifestPath,
  };

  for (const arg of argv) {
    if (arg.startsWith('--base-url=')) {
      args.baseUrl = arg.slice('--base-url='.length);
    } else if (arg.startsWith('--browser=')) {
      args.browser = arg.slice('--browser='.length);
    } else if (arg.startsWith('--id=')) {
      args.id = arg.slice('--id='.length);
    } else if (arg.startsWith('--manifest=')) {
      args.manifest = path.resolve(repoRoot, arg.slice('--manifest='.length));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function readManifest(manifestPath) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.version !== 1 || !Array.isArray(manifest.shots)) {
    throw new Error(`Invalid screenshot manifest: ${path.relative(repoRoot, manifestPath)}`);
  }
  return manifest;
}

function findBrowser(explicitBrowser) {
  if (explicitBrowser) {
    const browserPath = path.resolve(explicitBrowser);
    if (!fs.existsSync(browserPath)) {
      throw new Error(`DOCS_SCREENSHOT_BROWSER does not exist: ${browserPath}`);
    }
    return browserPath;
  }

  const browserPath = browserCandidates.find(candidate => fs.existsSync(candidate));
  if (!browserPath) {
    throw new Error(
      'No supported Chromium browser found. Set DOCS_SCREENSHOT_BROWSER to msedge.exe, chrome.exe, or chromium.',
    );
  }

  return browserPath;
}

function toUrl(baseUrl, shotPath) {
  return new URL(shotPath, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString();
}

function runBrowser(browserPath, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(browserPath, args, {
      cwd: repoRoot,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('exit', code => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new Error(`Browser exited with code ${code}\n${stdout}\n${stderr}`.trim()));
    });
  });
}

async function assertDevServer(baseUrl) {
  try {
    const response = await fetch(baseUrl, { method: 'GET' });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (error) {
    throw new Error(
      `Cannot reach ${baseUrl}. Start the dev server first, for example: npm run dev\n${error.message}`,
    );
  }
}

async function captureShot(browserPath, baseUrl, shot) {
  const outputPath = path.resolve(repoRoot, shot.output);
  const outputDir = path.dirname(outputPath);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'masterselects-docs-shot-'));
  const width = Number(shot.window?.width ?? 1280);
  const height = Number(shot.window?.height ?? 900);
  const waitMs = Number(shot.waitMs ?? 5000);
  const url = toUrl(baseUrl, shot.path);

  fs.mkdirSync(outputDir, { recursive: true });

  const browserArgs = [
    '--headless=new',
    '--no-first-run',
    '--disable-extensions',
    '--disable-background-timer-throttling',
    '--disable-gpu',
    '--hide-scrollbars',
    '--run-all-compositor-stages-before-draw',
    `--user-data-dir=${userDataDir}`,
    `--window-size=${width},${height}`,
    `--virtual-time-budget=${waitMs}`,
    `--screenshot=${outputPath}`,
    url,
  ];

  try {
    await runBrowser(browserPath, browserArgs);
  } finally {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }

  const stats = fs.statSync(outputPath);
  if (stats.size < 2048) {
    throw new Error(`Screenshot is unexpectedly small: ${shot.output} (${stats.size} bytes)`);
  }

  return {
    output: path.relative(repoRoot, outputPath),
    size: stats.size,
    url,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = readManifest(args.manifest);
  const baseUrl = args.baseUrl ?? manifest.baseUrl;
  const browserPath = findBrowser(args.browser);
  const shots = args.id
    ? manifest.shots.filter(shot => shot.id === args.id)
    : manifest.shots;

  if (shots.length === 0) {
    throw new Error(`No screenshot entries matched id: ${args.id}`);
  }

  await assertDevServer(baseUrl);
  console.log(`[docs-screenshots] Browser: ${browserPath}`);
  console.log(`[docs-screenshots] Base URL: ${baseUrl}`);

  for (const shot of shots) {
    const result = await captureShot(browserPath, baseUrl, shot);
    console.log(`[docs-screenshots] ${shot.id}: ${result.output} (${result.size} bytes)`);
  }
}

main().catch(error => {
  console.error(`[docs-screenshots] ${error.message}`);
  process.exit(1);
});
