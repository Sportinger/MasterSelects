import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const cwd = process.cwd();
const mode = process.argv[2] ?? 'once';
const intervalSeconds = Number(process.argv[3] ?? 60);

function runGit(args) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trimEnd();
  } catch (error) {
    const stderr = error?.stderr?.toString?.() ?? '';
    throw new Error(stderr || `git ${args.join(' ')} failed`);
  }
}

function parseNumstatLine(line) {
  const [addedRaw, deletedRaw, ...pathParts] = line.split('\t');
  const filePath = pathParts.join('\t');
  const added = addedRaw === '-' ? null : Number(addedRaw);
  const deleted = deletedRaw === '-' ? null : Number(deletedRaw);
  return {
    filePath,
    added,
    deleted,
    net: added === null || deleted === null ? null : added - deleted,
  };
}

function getTrackedChanges() {
  const output = runGit(['diff', '--numstat', 'HEAD', '--']);
  if (!output.trim()) {
    return [];
  }
  return output.split(/\r?\n/).filter(Boolean).map(parseNumstatLine);
}

function getUntrackedFiles() {
  const output = runGit(['ls-files', '--others', '--exclude-standard']);
  if (!output.trim()) {
    return [];
  }
  return output.split(/\r?\n/).filter(Boolean).map((filePath) => {
    const absolutePath = path.resolve(cwd, filePath);
    const stat = fs.statSync(absolutePath);
    const bytes = stat.size;
    const buffer = fs.readFileSync(absolutePath);
    const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
    const binary = sample.includes(0);
    if (binary) {
      return { filePath, lines: null, bytes, binary: true };
    }
    const text = buffer.toString('utf8');
    const lines = text.length === 0 ? 0 : text.split(/\r\n|\r|\n/).length;
    return { filePath, lines, bytes, binary: false };
  });
}

function getBranch() {
  const branch = runGit(['branch', '--show-current']);
  return branch || '(detached)';
}

function pad(value, width, align = 'left') {
  const text = String(value);
  if (text.length >= width) {
    return text;
  }
  const padding = ' '.repeat(width - text.length);
  return align === 'right' ? `${padding}${text}` : `${text}${padding}`;
}

function formatNumber(value) {
  if (value === null || Number.isNaN(value)) {
    return '-';
  }
  return String(value);
}

function printReport() {
  const tracked = getTrackedChanges();
  const untracked = getUntrackedFiles();
  const added = tracked.reduce((sum, row) => sum + (row.added ?? 0), 0);
  const deleted = tracked.reduce((sum, row) => sum + (row.deleted ?? 0), 0);
  const newLines = untracked.reduce((sum, row) => sum + (row.lines ?? 0), 0);
  const timestamp = new Date().toISOString();

  console.log(`Swarm status - ${timestamp}`);
  console.log(`Branch: ${getBranch()}`);
  console.log(
    `Summary: ${tracked.length} tracked changed, ${untracked.length} new untracked, +${added} -${deleted} tracked net ${added - deleted}, +${newLines} new-file LOC`,
  );

  if (tracked.length > 0) {
    console.log('');
    console.log('Tracked changes vs HEAD:');
    console.log(`${pad('ADD', 7, 'right')} ${pad('DEL', 7, 'right')} ${pad('NET', 7, 'right')} PATH`);
    for (const row of tracked.toSorted((a, b) => a.filePath.localeCompare(b.filePath))) {
      console.log(
        `${pad(formatNumber(row.added), 7, 'right')} ${pad(formatNumber(row.deleted), 7, 'right')} ${pad(formatNumber(row.net), 7, 'right')} ${row.filePath}`,
      );
    }
  }

  if (untracked.length > 0) {
    console.log('');
    console.log('New untracked files:');
    console.log(`${pad('LOC', 7, 'right')} ${pad('BYTES', 10, 'right')} PATH`);
    for (const row of untracked.toSorted((a, b) => a.filePath.localeCompare(b.filePath))) {
      const loc = row.binary ? 'binary' : formatNumber(row.lines);
      console.log(`${pad(loc, 7, 'right')} ${pad(row.bytes, 10, 'right')} ${row.filePath}`);
    }
  }

  if (tracked.length === 0 && untracked.length === 0) {
    console.log('No tracked or untracked working-tree changes.');
  }
}

if (mode === 'watch') {
  if (!Number.isFinite(intervalSeconds) || intervalSeconds < 5) {
    throw new Error('watch interval must be at least 5 seconds');
  }
  printReport();
  setInterval(() => {
    console.log('');
    printReport();
  }, intervalSeconds * 1000);
} else if (mode === 'once') {
  printReport();
} else {
  throw new Error('Usage: node scripts/swarm-status.mjs [once|watch] [intervalSeconds]');
}
