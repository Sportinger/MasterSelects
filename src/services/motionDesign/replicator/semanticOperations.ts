import {
  InertDescriptorPreflightError,
  preflightExactRecord,
  readInertOwnValue,
  type InertRecord,
} from './descriptorPreflight';
import {
  MotionReplicatorContractError,
  migrateMotionReplicatorContract,
  type MotionReplicatorContractV2,
  type MotionReplicatorLayout,
  type ReplicatorTerminalTransform,
} from './contracts';

export type MotionReplicatorSemanticOperation =
  | { type: 'set-enabled'; expectedRevision: number; enabled: boolean }
  | { type: 'set-layout'; expectedRevision: number; layout: MotionReplicatorLayout }
  | {
      type: 'set-terminal-transform';
      expectedRevision: number;
      terminalTransform: ReplicatorTerminalTransform;
    }
  | { type: 'set-user-limit'; expectedRevision: number; userLimit: number | null };

export type MotionReplicatorSemanticOperationDiagnosticCode =
  | 'MOTION_REPLICATOR_OPERATION_INVALID'
  | 'MOTION_REPLICATOR_OPERATION_STALE_REVISION'
  | 'MOTION_REPLICATOR_OPERATION_REVISION_EXHAUSTED';

export interface MotionReplicatorSemanticOperationDiagnostic {
  code: MotionReplicatorSemanticOperationDiagnosticCode;
  severity: 'error';
  message: string;
  path?: string;
  expectedRevision?: number;
  actualRevision?: number;
}

export interface SuccessfulMotionReplicatorSemanticOperationPlan {
  ok: true;
  operation: MotionReplicatorSemanticOperation['type'];
  previousRevision: number;
  nextRevision: number;
  changed: boolean;
  changedPaths: readonly string[];
  contract: MotionReplicatorContractV2;
  diagnostics: [];
}

export interface FailedMotionReplicatorSemanticOperationPlan {
  ok: false;
  operation: null;
  previousRevision: null;
  nextRevision: null;
  changed: false;
  changedPaths: [];
  contract: null;
  diagnostics: readonly MotionReplicatorSemanticOperationDiagnostic[];
}

export type MotionReplicatorSemanticOperationPlan =
  | SuccessfulMotionReplicatorSemanticOperationPlan
  | FailedMotionReplicatorSemanticOperationPlan;

function fail(
  code: MotionReplicatorSemanticOperationDiagnosticCode,
  message: string,
  options: Omit<MotionReplicatorSemanticOperationDiagnostic, 'code' | 'severity' | 'message'> = {},
): FailedMotionReplicatorSemanticOperationPlan {
  return {
    ok: false,
    operation: null,
    previousRevision: null,
    nextRevision: null,
    changed: false,
    changedPaths: [],
    contract: null,
    diagnostics: [{ code, severity: 'error', message, ...options }],
  };
}

function readOperation(value: unknown): {
  record: InertRecord;
  type: MotionReplicatorSemanticOperation['type'];
  expectedRevision: number;
} {
  const envelope = preflightExactRecord(
    value,
    'operation',
    ['type', 'expectedRevision'],
    ['enabled', 'layout', 'terminalTransform', 'userLimit'],
  );
  const type = readInertOwnValue(envelope, 'type');
  if (
    type !== 'set-enabled'
    && type !== 'set-layout'
    && type !== 'set-terminal-transform'
    && type !== 'set-user-limit'
  ) {
    throw new RangeError('operation.type is not supported');
  }
  const variantFields: Record<MotionReplicatorSemanticOperation['type'], readonly string[]> = {
    'set-enabled': ['enabled'],
    'set-layout': ['layout'],
    'set-terminal-transform': ['terminalTransform'],
    'set-user-limit': ['userLimit'],
  };
  const record = preflightExactRecord(
    envelope,
    'operation',
    ['type', 'expectedRevision', ...variantFields[type]],
  );
  const expectedRevision = readInertOwnValue(record, 'expectedRevision');
  if (!Number.isSafeInteger(expectedRevision) || (expectedRevision as number) < 0) {
    throw new RangeError('operation.expectedRevision must be a non-negative safe integer');
  }
  return { record, type, expectedRevision: expectedRevision as number };
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Plans one semantic MD3 mutation without touching a store or history stack.
 * Main can commit the returned contract in one revision-bound application.
 */
export function planMotionReplicatorSemanticOperation(
  currentValue: unknown,
  operationValue: unknown,
): MotionReplicatorSemanticOperationPlan {
  try {
    const current = migrateMotionReplicatorContract(currentValue);
    const operation = readOperation(operationValue);
    if (operation.expectedRevision !== current.revision) {
      return fail(
        'MOTION_REPLICATOR_OPERATION_STALE_REVISION',
        `Expected revision ${operation.expectedRevision}; current revision is ${current.revision}`,
        {
          path: 'operation.expectedRevision',
          expectedRevision: operation.expectedRevision,
          actualRevision: current.revision,
        },
      );
    }

    let candidate: MotionReplicatorContractV2;
    let changedPaths: readonly string[];
    if (operation.type === 'set-enabled') {
      const enabled = readInertOwnValue(operation.record, 'enabled');
      if (typeof enabled !== 'boolean') throw new RangeError('operation.enabled must be a boolean');
      candidate = migrateMotionReplicatorContract({ ...current, enabled });
      changedPaths = ['replicator.enabled'];
    } else if (operation.type === 'set-layout') {
      candidate = migrateMotionReplicatorContract({
        ...current,
        layout: readInertOwnValue(operation.record, 'layout'),
      });
      changedPaths = ['replicator.layout'];
    } else if (operation.type === 'set-terminal-transform') {
      candidate = migrateMotionReplicatorContract({
        ...current,
        terminalTransform: readInertOwnValue(operation.record, 'terminalTransform'),
      });
      changedPaths = ['replicator.terminalTransform'];
    } else {
      const userLimit = readInertOwnValue(operation.record, 'userLimit');
      if (userLimit === null) {
        const withoutUserLimit = { ...current };
        delete withoutUserLimit.userLimit;
        candidate = migrateMotionReplicatorContract(withoutUserLimit);
      } else {
        candidate = migrateMotionReplicatorContract({ ...current, userLimit });
      }
      changedPaths = ['replicator.userLimit'];
    }

    const changed = !canonicalEqual(current, candidate);
    if (!changed) {
      return {
        ok: true,
        operation: operation.type,
        previousRevision: current.revision,
        nextRevision: current.revision,
        changed: false,
        changedPaths: [],
        contract: current,
        diagnostics: [],
      };
    }
    if (current.revision === Number.MAX_SAFE_INTEGER) {
      return fail(
        'MOTION_REPLICATOR_OPERATION_REVISION_EXHAUSTED',
        'Replicator revision cannot advance beyond Number.MAX_SAFE_INTEGER',
        { path: 'replicator.revision', actualRevision: current.revision },
      );
    }
    const nextRevision = current.revision + 1;
    candidate = migrateMotionReplicatorContract({ ...candidate, revision: nextRevision });
    return {
      ok: true,
      operation: operation.type,
      previousRevision: current.revision,
      nextRevision,
      changed: true,
      changedPaths,
      contract: candidate,
      diagnostics: [],
    };
  } catch (error) {
    if (error instanceof InertDescriptorPreflightError || error instanceof MotionReplicatorContractError) {
      return fail('MOTION_REPLICATOR_OPERATION_INVALID', error.message, { path: error.path });
    }
    return fail(
      'MOTION_REPLICATOR_OPERATION_INVALID',
      error instanceof Error ? error.message : 'Unknown Replicator operation failure',
    );
  }
}
