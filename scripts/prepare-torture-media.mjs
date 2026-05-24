import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const DEFAULT_OUTPUT_DIR = path.join(repoRoot, 'fixtures', 'torture-media');
const DEFAULT_ROLES = [
  {
    id: 'primary-motion',
    role: 'primary color and motion source',
    fileName: 'primary_motion.mp4',
    checks: ['timeline import', 'color effects', 'voxel relief', 'export frame identity'],
  },
  {
    id: 'blend-mask',
    role: 'blend and mask source',
    fileName: 'blend_mask.mp4',
    checks: ['layer blending', 'ellipse mask', 'animated mask offset', 'cross dissolve'],
  },
  {
    id: 'detail-nested',
    role: 'detail and nested composition source',
    fileName: 'detail_nested.mp4',
    checks: ['nested composition', 'sub-nested composition', 'blur/scaling', 'scrub stability'],
  },
];

function usage() {
  return [
    'Usage:',
    '  npm run fixtures:torture-media -- [options] <video...>',
    '',
    'Options:',
    '  --out <dir>       Fixture directory. Default: fixtures/torture-media',
    '  --mode <mode>     copy or reference. Default: copy',
    '  --force           Recopy files even if the target exists',
    '',
    'Example:',
    '  npm run fixtures:torture-media -- --force "C:/Videos/a.mp4" "C:/Videos/b.mp4" "C:/Videos/c.mp4"',
  ].join('\n');
}

function parseArgs(argv) {
  const args = {
    outDir: DEFAULT_OUTPUT_DIR,
    mode: 'copy',
    force: false,
    sources: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    }
    if (arg === '--out') {
      const value = argv[index + 1];
      if (!value) throw new Error('--out requires a directory');
      args.outDir = path.resolve(value);
      index += 1;
      continue;
    }
    if (arg === '--mode') {
      const value = argv[index + 1];
      if (value !== 'copy' && value !== 'reference') {
        throw new Error('--mode must be copy or reference');
      }
      args.mode = value;
      index += 1;
      continue;
    }
    if (arg === '--force') {
      args.force = true;
      continue;
    }
    if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`);
    }
    args.sources.push(path.resolve(arg));
  }

  if (args.sources.length === 0) {
    throw new Error(`No source videos provided.\n\n${usage()}`);
  }

  return args;
}

function toPortablePath(filePath) {
  return filePath.replace(/\\/g, '/');
}

async function statFile(filePath) {
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) {
    throw new Error(`Not a file: ${filePath}`);
  }
  return stat;
}

function findFfprobe() {
  if (process.env.FFPROBE_PATH) {
    return process.env.FFPROBE_PATH;
  }

  if (process.env.FFMPEG_PATH) {
    const parsed = path.parse(process.env.FFMPEG_PATH);
    return path.join(parsed.dir, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
  }

  return 'ffprobe';
}

function parseFps(rate) {
  if (!rate || typeof rate !== 'string') return undefined;
  const [num, den] = rate.split('/').map(Number);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return undefined;
  return Math.round((num / den) * 1000) / 1000;
}

function probeVideo(filePath) {
  const ffprobe = findFfprobe();
  const result = spawnSync(ffprobe, [
    '-v', 'error',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    filePath,
  ], {
    encoding: 'utf8',
    windowsHide: true,
  });

  if (result.error || result.status !== 0 || !result.stdout) {
    return {
      probeAvailable: false,
      probeError: result.error?.message || result.stderr?.trim() || `ffprobe exited ${result.status}`,
    };
  }

  try {
    const data = JSON.parse(result.stdout);
    const videoStream = data.streams?.find((stream) => stream.codec_type === 'video');
    const audioStream = data.streams?.find((stream) => stream.codec_type === 'audio');
    const duration = Number(videoStream?.duration ?? data.format?.duration);
    return {
      probeAvailable: true,
      durationSeconds: Number.isFinite(duration) ? Math.round(duration * 1000) / 1000 : undefined,
      width: videoStream?.width,
      height: videoStream?.height,
      fps: parseFps(videoStream?.avg_frame_rate ?? videoStream?.r_frame_rate),
      videoCodec: videoStream?.codec_name,
      hasAudio: Boolean(audioStream),
      audioCodec: audioStream?.codec_name,
      container: data.format?.format_name,
    };
  } catch (error) {
    return {
      probeAvailable: false,
      probeError: error instanceof Error ? error.message : String(error),
    };
  }
}

async function copySource(sourcePath, targetPath, force) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });

  if (!force) {
    try {
      const [sourceStat, targetStat] = await Promise.all([
        fs.stat(sourcePath),
        fs.stat(targetPath),
      ]);
      if (sourceStat.size === targetStat.size) {
        return { copied: false, reason: 'target exists with same size' };
      }
    } catch {
      // Missing target falls through to copy.
    }
  }

  await fs.copyFile(sourcePath, targetPath);
  return { copied: true };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = args.outDir;
  const mediaDir = path.join(outDir, 'media');
  const manifestPath = path.join(outDir, 'manifest.local.json');
  const items = [];

  await fs.mkdir(outDir, { recursive: true });
  if (args.mode === 'copy') {
    await fs.mkdir(mediaDir, { recursive: true });
  }

  for (let index = 0; index < args.sources.length; index += 1) {
    const sourcePath = args.sources[index];
    const sourceStat = await statFile(sourcePath);
    const role = DEFAULT_ROLES[index] ?? {
      id: `source-${index + 1}`,
      role: `source ${index + 1}`,
      fileName: `source_${index + 1}${path.extname(sourcePath) || '.mp4'}`,
      checks: ['timeline import'],
    };
    const targetPath = args.mode === 'copy'
      ? path.join(mediaDir, role.fileName)
      : sourcePath;
    const copyResult = args.mode === 'copy'
      ? await copySource(sourcePath, targetPath, args.force)
      : { copied: false, reason: 'reference mode' };
    const targetStat = await statFile(targetPath);
    const probe = probeVideo(targetPath);

    items.push({
      id: role.id,
      role: role.role,
      checks: role.checks,
      fileName: path.basename(targetPath),
      mimeType: 'video/mp4',
      path: toPortablePath(targetPath),
      sourcePath: toPortablePath(sourcePath),
      sourceSizeBytes: sourceStat.size,
      sizeBytes: targetStat.size,
      copied: copyResult.copied,
      copyReason: copyResult.reason,
      ...probe,
    });
  }

  const manifest = {
    version: 1,
    name: 'MasterSelects Torture Media',
    generatedAt: new Date().toISOString(),
    mode: args.mode,
    fixtureDir: toPortablePath(outDir),
    mediaDir: toPortablePath(mediaDir),
    importPaths: items.map((item) => item.path),
    suggestedFrameTimesSeconds: [0.25, 1, 2, 3.5, 5],
    items,
  };

  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  console.log(`Wrote ${toPortablePath(manifestPath)}`);
  for (const item of items) {
    const duration = item.durationSeconds ? `${item.durationSeconds}s` : 'duration unknown';
    const sizeMb = Math.round((item.sizeBytes / 1024 / 1024) * 10) / 10;
    console.log(`- ${item.id}: ${item.fileName} (${sizeMb} MB, ${duration})`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
