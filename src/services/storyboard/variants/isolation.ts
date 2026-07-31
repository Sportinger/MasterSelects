import type { StoryboardFingerprint } from '../contracts';
import { fingerprintVariantRangeSnapshot } from './fingerprints';
import { variantScopesEqual } from './scope';
import type {
  VariantBoundaryMutationPolicy,
  VariantIsolationResult,
  VariantIsolationViolation,
  VariantRangeSnapshot,
} from './types';

export interface AssertVariantIsolationInput {
  before: VariantRangeSnapshot;
  after: VariantRangeSnapshot;
  expectedBaseFingerprint: StoryboardFingerprint;
  expectedBoundaryFingerprint: StoryboardFingerprint;
  boundaryPolicy: VariantBoundaryMutationPolicy;
}

function fingerprintsEqual(
  left: StoryboardFingerprint,
  right: StoryboardFingerprint,
): boolean {
  return left.schemaVersion === right.schemaVersion
    && left.algorithm === right.algorithm
    && left.value === right.value;
}

function linkedSourceIds(snapshot: VariantRangeSnapshot): string[] {
  const linkedIds = new Set(snapshot.linkedExpansionClipIds);
  return snapshot.source.clips
    .filter((clip) => linkedIds.has(clip.id))
    .map((clip) => clip.sourceClipId ?? clip.id)
    .toSorted();
}

function stringArraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && left.every((entry, index) => entry === right[index]);
}

export async function assertVariantIsolation(
  input: AssertVariantIsolationInput,
): Promise<VariantIsolationResult> {
  const [before, after] = await Promise.all([
    fingerprintVariantRangeSnapshot(input.before),
    fingerprintVariantRangeSnapshot(input.after),
  ]);
  const violations: VariantIsolationViolation[] = [];

  if (!variantScopesEqual(input.before.scope, input.after.scope)) {
    violations.push({
      kind: 'scope-changed',
      message: 'The variant scope changed while the option was being built.',
    });
  }
  const beforeLinkedIds = linkedSourceIds(input.before);
  const afterLinkedIds = linkedSourceIds(input.after);
  if (
    input.before.linkedExpansionPolicy !== input.after.linkedExpansionPolicy
    || !stringArraysEqual(beforeLinkedIds, afterLinkedIds)
  ) {
    violations.push({
      kind: 'linked-policy-changed',
      message: 'The captured linked-clip expansion changed while the option was being built.',
    });
  }
  if (!fingerprintsEqual(before.scope, input.expectedBaseFingerprint)) {
    violations.push({
      kind: 'stale-scope',
      message: 'The selected range no longer matches the variant base fingerprint.',
      expected: input.expectedBaseFingerprint.value,
      actual: before.scope.value,
    });
  }
  if (!fingerprintsEqual(before.boundary, input.expectedBoundaryFingerprint)) {
    violations.push({
      kind: 'stale-boundary',
      message: 'The range boundary no longer matches the captured boundary fingerprint.',
      expected: input.expectedBoundaryFingerprint.value,
      actual: before.boundary.value,
    });
  }
  if (!fingerprintsEqual(before.outside, after.outside)) {
    violations.push({
      kind: 'outside-mutation',
      message: 'Content outside the selected range, tracks, linked clips, and boundary neighborhood changed.',
      expected: before.outside.value,
      actual: after.outside.value,
    });
  }
  if (
    input.boundaryPolicy === 'preserve'
    && !fingerprintsEqual(before.boundary, after.boundary)
  ) {
    violations.push({
      kind: 'boundary-mutation',
      message: 'Boundary content changed under the preserve policy.',
      expected: before.boundary.value,
      actual: after.boundary.value,
    });
  }

  return violations.length === 0
    ? { ok: true, before, after }
    : { ok: false, before, after, violations };
}
