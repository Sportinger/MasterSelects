import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  completeArchitectureGates,
  completeAdapterDebtLedger,
  foundationProjectSchemaImportClassifications,
  foundationRuntimeHandleClassifications,
  foundationTypeBoundaryBaselines,
  foundationTypeEntryPoints,
} from '../../src/architecture';

const repoRoot = process.cwd();
const sourceExtensions = new Set(['.ts', '.tsx']);
const runtimeHandlePattern =
  /\b(File|Blob|FileSystemFileHandle|HTMLMediaElement|HTMLVideoElement|HTMLAudioElement|HTMLCanvasElement|AudioContext|VideoFrame|ImageBitmap|GPU[A-Za-z]+|Worker|WebCodecsPlayer|NativeDecoder)\b|createObjectURL|revokeObjectURL/g;
const directTypeBarrelImportPattern =
  /from\s+['"]((?:\.\.\/)+src\/types|(?:\.\.\/)+types)['"]/g;
const projectSchemaProductImportPattern =
  /\.\.\/\.\.\/\.\.\/(stores|components|engine)|@\/(stores|components|engine)/g;

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

function fileMatchCounts(files: string[], pattern: RegExp): Map<string, number> {
  const counts = new Map<string, number>();
  for (const filePath of files) {
    const count = countMatches(readFileSync(filePath, 'utf8'), pattern);
    if (count > 0) counts.set(toRepoPath(filePath), count);
  }
  return counts;
}

describe('foundation type boundary registry', () => {
  it('defines focused type tiers without creating another broad type dump', () => {
    const gateIds = new Set(completeArchitectureGates.map((gate) => gate.id));
    const entryIds = foundationTypeEntryPoints.map((entry) => entry.id);
    expect(new Set(entryIds).size).toBe(entryIds.length);

    const compatibilityEntries = foundationTypeEntryPoints.filter(
      (entry) => entry.tier === 'compatibility-facade',
    );
    expect(compatibilityEntries).toHaveLength(1);
    expect(compatibilityEntries[0].path).toBe('src/types/index.ts');
    expect(compatibilityEntries[0].status).toBe('compatibility-debt');

    for (const entry of foundationTypeEntryPoints) {
      expect(gateIds.has(entry.gateId), `${entry.id} references unknown gate`).toBe(true);
      if (entry.retirementGate) {
        expect(gateIds.has(entry.retirementGate), `${entry.id} references unknown retirement gate`).toBe(true);
      }

      const repoPath = entry.path.endsWith('/**') ? entry.path.slice(0, -3) : entry.path;
      expect(existsSync(resolveRepoPath(repoPath)), `${entry.path} does not exist`).toBe(true);
      expect(
        entry.path.startsWith('src/components/') ||
          entry.path.startsWith('src/stores/') ||
          entry.path.startsWith('src/engine/'),
        `${entry.id} points at a forbidden product domain`,
      ).toBe(false);
    }
  });

  it('freezes broad type-barrel fan-in so new compatibility imports are visible', () => {
    const files = [...filesUnder('src'), ...filesUnder('tests')];
    const directImportHits = files.reduce(
      (total, filePath) =>
        total + countMatches(readFileSync(filePath, 'utf8'), directTypeBarrelImportPattern),
      0,
    );

    expect(directImportHits).toBeLessThanOrEqual(
      foundationTypeBoundaryBaselines.directGlobalTypeImportHits,
    );

    const globalTypesLines = readFileSync(resolveRepoPath('src/types/index.ts'), 'utf8')
      .split(/\r?\n/).length;
    expect(globalTypesLines).toBeLessThanOrEqual(
      foundationTypeBoundaryBaselines.globalTypesIndexRawLines,
    );
    expect(foundationTypeBoundaryBaselines.globalTypesIndexTargetLines).toBe(150);

    const debt = completeAdapterDebtLedger.find((entry) => entry.id === 'compat-types-index');
    expect(debt?.deleteBy).toBe('P1_GLOBAL_TYPES_BARREL_THIN');
  });

  it('keeps current runtime-handle leaks classified until lease packets remove them', () => {
    const files = [
      ...filesUnder('src/types'),
      ...filesUnder('src/services/project/types'),
      ...filesUnder('src/signals'),
    ];
    const counts = fileMatchCounts(files, runtimeHandlePattern);
    const classified = new Map(
      foundationRuntimeHandleClassifications.map((entry) => [entry.path, entry]),
    );

    const totalHits = [...counts.values()].reduce((sum, count) => sum + count, 0);
    expect(totalHits).toBeLessThanOrEqual(
      foundationTypeBoundaryBaselines.sharedSchemaRuntimeHandleTokenHits,
    );

    for (const [filePath, count] of counts) {
      const entry = classified.get(filePath);
      expect(entry, `${filePath} has unclassified runtime-handle hits`).toBeTruthy();
      expect(count, `${filePath} exceeds classified runtime-handle hit count`).toBeLessThanOrEqual(
        entry?.maxCurrentHits ?? 0,
      );
    }
  });

  it('keeps project-schema product imports visible for the P1/P3 handoff packet', () => {
    const files = filesUnder('src/services/project/types');
    const counts = fileMatchCounts(files, projectSchemaProductImportPattern);
    const classified = new Map(
      foundationProjectSchemaImportClassifications.map((entry) => [entry.path, entry]),
    );

    const totalHits = [...counts.values()].reduce((sum, count) => sum + count, 0);
    expect(totalHits).toBeLessThanOrEqual(
      foundationTypeBoundaryBaselines.projectSchemaProductImportHits,
    );

    for (const [filePath, count] of counts) {
      const entry = classified.get(filePath);
      expect(entry, `${filePath} has unclassified project-schema product imports`).toBeTruthy();
      expect(entry?.handoffPacket).toBe('P1-P3-SCHEMA-FREEZE-001');
      expect(count, `${filePath} exceeds classified project-schema import count`).toBeLessThanOrEqual(
        entry?.maxCurrentHits ?? 0,
      );
    }
  });
});
