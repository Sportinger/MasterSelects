import type { ToolResult } from '../../aiTools/types';
import {
  getPublicOperationSpecV1,
  PUBLIC_OPERATION_EFFECTS_V1,
  PUBLIC_OPERATION_CONTRACT_DIGEST_V1,
  PUBLIC_OPERATION_CONTRACT_V1,
  projectPublicOperationResultV1,
  type PublicOperationEffectV1,
  type PublicOperationIdV1,
  validatePublicOperationArgumentsV1,
} from './publicOperationContracts';

export interface CandidateOneEnvelopeV1 {
  allowedEffects: PublicOperationEffectV1[];
  batchId: string;
  contractDigest: string;
  contractVersion: string;
  expectedTimelineRevision: number;
  operation: {
    arguments: Record<string, unknown>;
    operationId: PublicOperationIdV1;
    sequence: 1;
  };
  schemaVersion: 1;
}

export interface BoundaryTransactionV1 {
  abort(handle: unknown): void;
  begin(label: string): unknown;
  commit(handle: unknown): void;
  run<T>(handle: unknown, action: () => T): T;
}

export interface PublicOperationExecutionDependenciesV1 {
  authorize(
    operationId: PublicOperationIdV1,
    argumentsValue: Record<string, unknown>,
  ): boolean;
  dispatch(
    operationId: PublicOperationIdV1,
    argumentsValue: Record<string, unknown>,
  ): Promise<ToolResult>;
  getCommittedStateFingerprint?(): Promise<string>;
  getPreparedStateFingerprint?(): Promise<string>;
  getTimelineRevision(): number;
  transaction: BoundaryTransactionV1;
}

export interface CandidateBoundaryResultV1 {
  batchId: string;
  results: Array<{
    operationId: PublicOperationIdV1;
    result: ToolResult;
    sequence: number;
  }>;
  success: boolean;
}

export class PublicOperationBoundaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PublicOperationBoundaryError';
  }
}

export class PublicOperationTransactionOwnershipLostError extends Error {
  constructor() {
    super('kernel operation lost history transaction ownership');
    this.name = 'PublicOperationTransactionOwnershipLostError';
  }
}

function hasOnlyKeys(value: object, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function validateEnvelope(envelope: CandidateOneEnvelopeV1): void {
  if (
    !envelope
    || typeof envelope !== 'object'
    || !hasOnlyKeys(envelope, [
      'allowedEffects',
      'batchId',
      'contractDigest',
      'contractVersion',
      'expectedTimelineRevision',
      'operation',
      'schemaVersion',
    ])
    || envelope.schemaVersion !== 1
    || envelope.contractVersion !== PUBLIC_OPERATION_CONTRACT_V1.contractVersion
    || envelope.contractDigest !== PUBLIC_OPERATION_CONTRACT_DIGEST_V1
  ) {
    throw new PublicOperationBoundaryError('operation contract mismatch');
  }
  if (
    typeof envelope.batchId !== 'string'
    || envelope.batchId.length === 0
    || envelope.batchId.length > 160
    || !Number.isInteger(envelope.expectedTimelineRevision)
    || envelope.expectedTimelineRevision < 0
    || !Array.isArray(envelope.allowedEffects)
    || new Set(envelope.allowedEffects).size !== envelope.allowedEffects.length
    || envelope.allowedEffects.some((effect) => !PUBLIC_OPERATION_EFFECTS_V1.includes(effect))
    || !envelope.operation
    || typeof envelope.operation !== 'object'
    || !hasOnlyKeys(envelope.operation, ['arguments', 'operationId', 'sequence'])
  ) {
    throw new PublicOperationBoundaryError('invalid operation envelope');
  }

  const spec = getPublicOperationSpecV1(envelope.operation.operationId);
  if (!spec || envelope.operation.sequence !== 1) {
    throw new PublicOperationBoundaryError('unknown or invalid operation');
  }
  const allowedEffects = new Set(envelope.allowedEffects);
  if (spec.effects.some((effect) => !allowedEffects.has(effect))) {
    throw new PublicOperationBoundaryError('operation exceeds allowed effects');
  }
  if (!validatePublicOperationArgumentsV1(spec.id, envelope.operation.arguments)) {
    throw new PublicOperationBoundaryError('invalid operation arguments');
  }
}

export async function executeCandidateOneEnvelopeV1(
  envelope: CandidateOneEnvelopeV1,
  deps: PublicOperationExecutionDependenciesV1,
): Promise<CandidateBoundaryResultV1> {
  validateEnvelope(envelope);
  if (deps.getTimelineRevision() !== envelope.expectedTimelineRevision) {
    throw new PublicOperationBoundaryError('stale timeline revision');
  }
  if (!deps.authorize(envelope.operation.operationId, envelope.operation.arguments)) {
    throw new PublicOperationBoundaryError('local policy denied operation');
  }

  const spec = getPublicOperationSpecV1(envelope.operation.operationId);
  if (!spec) throw new PublicOperationBoundaryError('unknown operation');
  const dispatch = async () => projectPublicOperationResultV1(
    envelope.operation.operationId,
    await deps.dispatch(
      envelope.operation.operationId,
      envelope.operation.arguments,
    ),
    envelope.operation.arguments,
  );
  if (spec.transaction === 'none') {
    const result = await dispatch();
    return {
      batchId: envelope.batchId,
      results: [{
        operationId: envelope.operation.operationId,
        result,
        sequence: 1,
      }],
      success: result.success,
    };
  }

  const transaction = deps.transaction.begin(`Kernel operation ${envelope.batchId}`);
  try {
    const result = await deps.transaction.run(transaction, dispatch);
    if (!result.success) {
      deps.transaction.abort(transaction);
      return {
        batchId: envelope.batchId,
        results: [{
          operationId: envelope.operation.operationId,
          result,
          sequence: 1,
        }],
        success: false,
      };
    }
    deps.transaction.commit(transaction);
    return {
      batchId: envelope.batchId,
      results: [{
        operationId: envelope.operation.operationId,
        result,
        sequence: 1,
      }],
      success: true,
    };
  } catch (error) {
    deps.transaction.abort(transaction);
    throw error;
  }
}
