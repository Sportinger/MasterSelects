import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  completeAdapterDebtLedger,
  completeArchitectureGates,
  completeExitCriteriaCoverage,
  completeHighConflictOwnership,
  completeHighConflictTargets,
  completeRefactorLanes,
  completeRetiredPathLedger,
  completeTestMigrationLedger,
} from '../../src/architecture';

const repoRoot = process.cwd();
const architectureRoot = path.join(repoRoot, 'src', 'architecture');

const allowedGateStatuses = new Set(['active', 'satisfied', 'retired']);
const allowedRetiredClassifications = new Set([
  'delete now',
  'delete at gate',
  'keep',
]);
const allowedTestClassifications = new Set([
  'port',
  'replace',
  'split',
  'delete',
  'keep',
]);
const protectedTimelineWriteSets = [
  'src/components/timeline/**',
  'src/stores/timeline/**',
  'src/timeline/architecture/**',
];

function toRepoPath(filePath: string): string {
  return path.relative(repoRoot, filePath).replace(/\\/g, '/');
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

function sourceFilesUnder(root: string): string[] {
  return walkFiles(root).filter((filePath) => /\.ts$/.test(filePath));
}

function lineCount(text: string): number {
  return text.split(/\r?\n/).length;
}

function importedSpecifiers(source: string): string[] {
  const imports = [...source.matchAll(/import\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g)]
    .map((match) => match[1]);
  const exports = [...source.matchAll(/export\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g)]
    .map((match) => match[1]);
  return [...imports, ...exports];
}

function gateIds(): Set<string> {
  return new Set(completeArchitectureGates.map((gate) => gate.id));
}

function laneIds(): Set<string> {
  return new Set(completeRefactorLanes.map((lane) => lane.id));
}

function expectGateRefsToResolve(label: string, refs: readonly string[] | undefined, ids: Set<string>): void {
  for (const ref of refs ?? []) {
    expect(ids.has(ref), `${label} references unknown gate ${ref}`).toBe(true);
  }
}

describe('complete architecture registry', () => {
  it('keeps gate ids, dependencies, and exit coverage coherent', () => {
    const ids = completeArchitectureGates.map((gate) => gate.id);
    expect(new Set(ids).size).toBe(ids.length);

    const idSet = gateIds();
    for (const gate of completeArchitectureGates) {
      expect(allowedGateStatuses.has(gate.status), `${gate.id} has invalid status`).toBe(true);
      expectGateRefsToResolve(`${gate.id}.dependsOn`, gate.dependsOn, idSet);
      if (gate.status === 'retired') {
        expect(gate.retiredByGate, `${gate.id} is retired without retiredByGate`).toBeTruthy();
        expect(idSet.has(gate.retiredByGate ?? ''), `${gate.id}.retiredByGate is unknown`).toBe(true);
      }
    }

    const coverageIds = completeExitCriteriaCoverage.map((entry) => entry.gateId);
    expect(new Set(coverageIds).size).toBe(coverageIds.length);
    expect(new Set(coverageIds)).toEqual(idSet);
    for (const entry of completeExitCriteriaCoverage) {
      expect(entry.criteria.length, `${entry.gateId} has no criteria`).toBeGreaterThan(0);
      expect(entry.evidence.length, `${entry.gateId} has no evidence`).toBeGreaterThan(0);
    }
  });

  it('keeps lane write sets, high-conflict ownership, and debt references coherent', () => {
    const ids = gateIds();
    const lanes = laneIds();

    for (const lane of completeRefactorLanes) {
      expect(lane.writeSet.length, `${lane.id} has no write set`).toBeGreaterThan(0);
      expect(lane.forbiddenWriteSet.length, `${lane.id} has no forbidden write set`).toBeGreaterThan(0);
      expect(lane.exitGates.length, `${lane.id} has no exit gates`).toBeGreaterThan(0);
      expectGateRefsToResolve(`${lane.id}.exitGates`, lane.exitGates, ids);
      expectGateRefsToResolve(`${lane.id}.activeUntilGate`, lane.activeUntilGate ? [lane.activeUntilGate] : [], ids);
    }

    const ownershipCounts = new Map<string, number>();
    for (const ownership of completeHighConflictOwnership) {
      expect(lanes.has(ownership.laneId), `${ownership.path} owner lane is unknown`).toBe(true);
      ownershipCounts.set(ownership.path, (ownershipCounts.get(ownership.path) ?? 0) + 1);
    }
    for (const target of completeHighConflictTargets) {
      expect(ownershipCounts.get(target), `${target} does not have exactly one owner`).toBe(1);
    }
    expect(completeHighConflictOwnership).toHaveLength(completeHighConflictTargets.length);

    for (const debt of completeAdapterDebtLedger) {
      expect(lanes.has(debt.ownerLane), `${debt.id} owner lane is unknown`).toBe(true);
      expect(debt.writeSet.length, `${debt.id} has no write set`).toBeGreaterThan(0);
      expect(ids.has(debt.deleteBy), `${debt.id}.deleteBy is unknown`).toBe(true);
      expectGateRefsToResolve(`${debt.id}.acceptanceTests`, debt.acceptanceTests, ids);
    }
  });

  it('keeps retired-path and test migration ledgers reviewable', () => {
    const ids = gateIds();
    const lanes = laneIds();

    for (const entry of completeRetiredPathLedger) {
      expect(allowedRetiredClassifications.has(entry.classification), `${entry.id} has invalid classification`).toBe(true);
      expect(lanes.has(entry.ownerLane), `${entry.id} owner lane is unknown`).toBe(true);
      expect(
        Boolean(entry.deleteBy || entry.keepReason),
        `${entry.id} needs deleteBy or keepReason`,
      ).toBe(true);
      expectGateRefsToResolve(`${entry.id}.deleteBy`, entry.deleteBy ? [entry.deleteBy] : [], ids);
      expectGateRefsToResolve(`${entry.id}.replacementGate`, entry.replacementGate ? [entry.replacementGate] : [], ids);
    }

    for (const entry of completeTestMigrationLedger) {
      expect(allowedTestClassifications.has(entry.classification), `${entry.path} has invalid classification`).toBe(true);
      expect(lanes.has(entry.ownerLane), `${entry.path} owner lane is unknown`).toBe(true);
      expect(ids.has(entry.replacementGate), `${entry.path} replacement gate is unknown`).toBe(true);
      expect(existsSync(path.join(repoRoot, entry.path)), `${entry.path} does not exist`).toBe(true);
    }
  });

  it('keeps the whole-codebase registry pure and protects Timeline from broad writes', () => {
    const forbiddenSpecifiers = [
      'react',
      '@/components/',
      '@/stores/',
      '@/services/',
      '@/engine/',
      '@/timeline/',
    ];

    for (const filePath of sourceFilesUnder(architectureRoot)) {
      const repoPath = toRepoPath(filePath);
      const source = readFileSync(filePath, 'utf8');
      expect(lineCount(source), `${repoPath} exceeds registry file budget`).toBeLessThanOrEqual(300);
      for (const specifier of importedSpecifiers(source)) {
        for (const forbidden of forbiddenSpecifiers) {
          expect(
            specifier === forbidden || specifier.startsWith(forbidden),
            `${repoPath} imports forbidden ${specifier}`,
          ).toBe(false);
        }
      }
    }

    for (const lane of completeRefactorLanes) {
      for (const protectedPath of protectedTimelineWriteSets) {
        expect(
          lane.writeSet.includes(protectedPath),
          `${lane.id} directly writes protected Timeline path ${protectedPath}`,
        ).toBe(false);
      }
    }
  });
});
