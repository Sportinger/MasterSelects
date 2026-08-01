import type { MotionLayerDefinition, ReplicatorDefinition } from '../../../types/motionDesign';
import {
  migrateMotionReplicatorContract,
  type MotionReplicatorContractV2,
} from '../replicator/contracts';
import { migrateLegacyMotionDesignBundle } from '../replicator/legacyBundleAdapter';
import {
  parseMotionModifierStackContract,
  type MotionModifierStackContractV1,
} from '../modifiers/contracts';

export interface NormalizedMotionReplicatorBundle {
  replicator: ReplicatorDefinition;
  modifierStack?: MotionModifierStackContractV1;
}

function isV2Replicator(value: unknown): value is MotionReplicatorContractV2 {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && (value as { contract?: unknown }).contract === 'masterselects.motion-replicator';
}

/**
 * Main-integration boundary for old timeline/project values. Legacy MD3 and MD4
 * data are split once, while V2 values are re-admitted through their frozen
 * contracts. No runtime device limit is persisted here.
 */
export function normalizeMotionReplicatorBundle(
  replicatorValue: unknown,
  modifierStackValue?: unknown,
): NormalizedMotionReplicatorBundle {
  if (isV2Replicator(replicatorValue)) {
    const replicator = migrateMotionReplicatorContract(replicatorValue);
    return {
      replicator,
      ...(modifierStackValue === undefined
        ? {}
        : { modifierStack: parseMotionModifierStackContract(modifierStackValue) }),
    };
  }

  const migration = migrateLegacyMotionDesignBundle(replicatorValue);
  if (!migration.ok) {
    throw new Error(migration.diagnostics.map((diagnostic) => diagnostic.message).join('; '));
  }
  return {
    replicator: migration.replicator,
    modifierStack: migration.modifierStack,
  };
}

export function normalizeMotionLayerDefinition(
  motion: MotionLayerDefinition,
): MotionLayerDefinition {
  if (!motion.replicator) return structuredClone(motion);
  const normalized = normalizeMotionReplicatorBundle(
    motion.replicator,
    motion.modifierStack,
  );
  const clone = structuredClone(motion);
  delete clone.replicatorRecovery;
  return {
    ...clone,
    replicator: normalized.replicator,
    ...(normalized.modifierStack === undefined
      ? {}
      : { modifierStack: normalized.modifierStack }),
  };
}

/**
 * Load/recovery boundary: invalid legacy data is removed from the executable
 * contract and retained in an explicit observable quarantine field.
 */
export function normalizeMotionLayerDefinitionForLoad(
  motion: MotionLayerDefinition,
): MotionLayerDefinition {
  try {
    return normalizeMotionLayerDefinition(motion);
  } catch (error) {
    const clone = structuredClone(motion);
    const raw = structuredClone(clone.replicator);
    delete clone.replicator;
    delete clone.modifierStack;
    return {
      ...clone,
      replicatorRecovery: {
        raw,
        diagnostic: error instanceof Error
          ? error.message
          : 'Unknown Motion Replicator migration failure',
      },
    };
  }
}
