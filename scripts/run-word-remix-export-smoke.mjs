import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

const outputPathArg = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
const resultPath = resolve(
  outputPathArg ?? resolve(tmpdir(), 'masterselects-word-remix-export-smoke.json'),
);
const token = (
  await readFile(resolve(import.meta.dirname, '..', '.ai-bridge-token'), 'utf8')
).trim();
const includeAudio = process.argv.includes('--audio');
const download = process.argv.includes('--download');

const payload = {
  tool: 'debugExport',
  timeoutMs: 300_000,
  args: {
    startTime: 0,
    endTime: 31.200002,
    width: 320,
    height: 180,
    fps: 8,
    exportMode: 'fast',
    includeAudio,
    codec: 'h264',
    container: 'mp4',
    maxRuntimeMs: 600_000,
    download,
  },
};

try {
  const response = await fetch('http://localhost:5173/api/ai-tools', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(630_000),
  });
  const text = await response.text();
  const result = response.ok
    ? JSON.parse(text)
    : { success: false, error: `HTTP ${response.status}: ${text}` };
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  if (!response.ok || result.success !== true) {
    process.exitCode = 1;
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  await writeFile(
    resultPath,
    `${JSON.stringify({ success: false, error: message }, null, 2)}\n`,
    'utf8',
  );
  process.exitCode = 1;
}
