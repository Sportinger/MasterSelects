import type { ToolResult } from '../../aiTools/types';
import {
  type BoundaryTransactionV1,
  type CandidateBoundaryResultV1,
  type PublicOperationExecutionDependenciesV1,
  PublicOperationBoundaryError,
} from './candidateOneOperationExecutor';
import {
  getPublicOperationSpecV1,
  isAllowedPublicResultBindingV1,
  PUBLIC_COMPILED_PLAN_DIGEST_V1,
  PUBLIC_COMPILED_PLAN_EXTENSION_V1,
  PUBLIC_OPERATION_EFFECTS_V1,
  PUBLIC_OPERATION_CONTRACT_DIGEST_V1,
  PUBLIC_OPERATION_CONTRACT_V1,
  projectPublicOperationResultV1,
  type PublicOperationEffectV1,
  type PublicOperationIdV1,
  validatePublicOperationArgumentKeysV1,
  validatePublicOperationArgumentsV1,
} from './publicOperationContracts';

type JsonPrimitive = boolean | number | string | null;
export type CandidateTwoArgumentV1 =
  | JsonPrimitive
  | CandidateTwoArgumentV1[]
  | { [key: string]: CandidateTwoArgumentV1 }
  | {
      $result: {
        path: Array<number | string>;
        stepId: string;
      };
    };

export interface CandidateTwoCompiledPlanV1 {
  allowedEffects: PublicOperationEffectV1[];
  batchId: string;
  contractDigest: string;
  contractVersion: string;
  expectedTimelineRevision: number;
  planDigest: string;
  planVersion: string;
  schemaVersion: 1;
  steps: Array<{
    arguments: Record<string, CandidateTwoArgumentV1>;
    operationId: PublicOperationIdV1;
    sequence: number;
    stepId: string;
  }>;
}

interface ResultBindingV1 {
  $result: {
    path: Array<number | string>;
    stepId: string;
  };
}

const FORBIDDEN_PATH_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isResultBinding(value: unknown): value is ResultBindingV1 {
  if (!isRecord(value) || Object.keys(value).length !== 1 || !isRecord(value.$result)) {
    return false;
  }
  const binding = value.$result;
  return Object.keys(binding).length === 2
    && typeof binding.stepId === 'string'
    && binding.stepId.length > 0
    && binding.stepId.length <= 120
    && Array.isArray(binding.path)
    && binding.path.length > 0
    && binding.path.length <= PUBLIC_COMPILED_PLAN_EXTENSION_V1.maximumPathLength
    && binding.path.every((entry) => (
      (typeof entry === 'number' && Number.isInteger(entry) && entry >= 0)
      || (typeof entry === 'string'
        && entry.length > 0
        && entry.length <= 120
        && !FORBIDDEN_PATH_KEYS.has(entry))
    ));
}

function hasOnlyKeys(value: object, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function inspectArgumentTree(
  value: unknown,
  onBinding: (binding: ResultBindingV1) => void,
  depth = 0,
): boolean {
  if (depth > PUBLIC_COMPILED_PLAN_EXTENSION_V1.maximumBindingDepth) {
    throw new PublicOperationBoundaryError('result binding is too deep');
  }
  if (isRecord(value) && Object.hasOwn(value, '$result')) {
    if (!isResultBinding(value)) {
      throw new PublicOperationBoundaryError('result binding is malformed');
    }
    onBinding(value);
    return true;
  }
  if (Array.isArray(value)) {
    if (value.length > PUBLIC_COMPILED_PLAN_EXTENSION_V1.maximumArgumentArrayLength) {
      throw new PublicOperationBoundaryError('argument array is too large');
    }
    return value.reduce(
      (hasBinding, entry) => inspectArgumentTree(entry, onBinding, depth + 1) || hasBinding,
      false,
    );
  }
  if (isRecord(value)) {
    const entries = Object.entries(value);
    if (
      entries.length > PUBLIC_COMPILED_PLAN_EXTENSION_V1.maximumArgumentObjectKeys
      || entries.some(([key]) => FORBIDDEN_PATH_KEYS.has(key))
    ) {
      throw new PublicOperationBoundaryError('argument object is invalid');
    }
    return entries.reduce(
      (hasBinding, [, entry]) => inspectArgumentTree(entry, onBinding, depth + 1) || hasBinding,
      false,
    );
  }
  if (
    value !== null
    && typeof value !== 'boolean'
    && typeof value !== 'string'
    && !(typeof value === 'number' && Number.isFinite(value))
  ) {
    throw new PublicOperationBoundaryError('argument value is not JSON-safe');
  }
  return false;
}

function readResultPath(result: unknown, path: Array<number | string>): unknown {
  let current = result;
  for (const entry of path) {
    if (Array.isArray(current) && typeof entry === 'number') {
      current = current[entry];
      continue;
    }
    if (isRecord(current) && typeof entry === 'string' && !FORBIDDEN_PATH_KEYS.has(entry)) {
      current = Object.hasOwn(current, entry) ? current[entry] : undefined;
      continue;
    }
    throw new PublicOperationBoundaryError('result binding path is invalid');
  }
  if (current === undefined) {
    throw new PublicOperationBoundaryError('result binding did not resolve');
  }
  return current;
}

function resolveArgument(
  value: CandidateTwoArgumentV1,
  priorResults: Map<string, ToolResult>,
  depth = 0,
): unknown {
  if (depth > PUBLIC_COMPILED_PLAN_EXTENSION_V1.maximumBindingDepth) {
    throw new PublicOperationBoundaryError('result binding is too deep');
  }
  if (isResultBinding(value)) {
    const result = priorResults.get(value.$result.stepId);
    if (!result) {
      throw new PublicOperationBoundaryError('result binding must reference a prior step');
    }
    return readResultPath(result, value.$result.path);
  }
  if (Array.isArray(value)) {
    if (value.length > PUBLIC_COMPILED_PLAN_EXTENSION_V1.maximumArgumentArrayLength) {
      throw new PublicOperationBoundaryError('argument array is too large');
    }
    return value.map((entry) => resolveArgument(entry, priorResults, depth + 1));
  }
  if (isRecord(value)) {
    const entries = Object.entries(value);
    if (
      entries.length > PUBLIC_COMPILED_PLAN_EXTENSION_V1.maximumArgumentObjectKeys
      || entries.some(([key]) => FORBIDDEN_PATH_KEYS.has(key))
    ) {
      throw new PublicOperationBoundaryError('argument object is invalid');
    }
    return Object.fromEntries(entries.map(([key, entry]) => [
      key,
      resolveArgument(entry as CandidateTwoArgumentV1, priorResults, depth + 1),
    ]));
  }
  return value;
}

export function validateCandidateTwoCompiledPlanV1(
  plan: CandidateTwoCompiledPlanV1,
): void {
  if (
    !plan
    || typeof plan !== 'object'
    || !hasOnlyKeys(plan, [
      'allowedEffects',
      'batchId',
      'contractDigest',
      'contractVersion',
      'expectedTimelineRevision',
      'planDigest',
      'planVersion',
      'schemaVersion',
      'steps',
    ])
    || plan.schemaVersion !== 1
    || plan.contractVersion !== PUBLIC_OPERATION_CONTRACT_V1.contractVersion
    || plan.contractDigest !== PUBLIC_OPERATION_CONTRACT_DIGEST_V1
    || plan.planVersion !== PUBLIC_COMPILED_PLAN_EXTENSION_V1.planVersion
    || plan.planDigest !== PUBLIC_COMPILED_PLAN_DIGEST_V1
  ) {
    throw new PublicOperationBoundaryError('compiled plan contract mismatch');
  }
  if (
    typeof plan.batchId !== 'string'
    || plan.batchId.length === 0
    || plan.batchId.length > 160
    || !Number.isInteger(plan.expectedTimelineRevision)
    || plan.expectedTimelineRevision < 0
    || !Array.isArray(plan.allowedEffects)
    || new Set(plan.allowedEffects).size !== plan.allowedEffects.length
    || plan.allowedEffects.some((effect) => !PUBLIC_OPERATION_EFFECTS_V1.includes(effect))
    || !Array.isArray(plan.steps)
    || plan.steps.length === 0
    || plan.steps.length > PUBLIC_COMPILED_PLAN_EXTENSION_V1.maximumSteps
  ) {
    throw new PublicOperationBoundaryError('invalid compiled plan envelope');
  }

  const allowedEffects = new Set(plan.allowedEffects);
  const priorStepOperations = new Map<string, PublicOperationIdV1>();
  for (const [index, step] of plan.steps.entries()) {
    if (!step || typeof step !== 'object' || !hasOnlyKeys(
      step,
      ['arguments', 'operationId', 'sequence', 'stepId'],
    )) {
      throw new PublicOperationBoundaryError('invalid compiled plan step');
    }
    const spec = getPublicOperationSpecV1(step.operationId);
    if (
      !spec
      || step.sequence !== index + 1
      || typeof step.stepId !== 'string'
      || step.stepId.length === 0
      || step.stepId.length > 120
      || priorStepOperations.has(step.stepId)
      || spec.effects.some((effect) => !allowedEffects.has(effect))
      || !validatePublicOperationArgumentKeysV1(step.operationId, step.arguments)
    ) {
      throw new PublicOperationBoundaryError('invalid compiled plan step');
    }
    const hasBinding = inspectArgumentTree(step.arguments, (binding) => {
      const sourceOperationId = priorStepOperations.get(binding.$result.stepId);
      if (
        !sourceOperationId
        || !isAllowedPublicResultBindingV1(sourceOperationId, binding.$result.path)
      ) {
        throw new PublicOperationBoundaryError('result binding is not declared by a prior step');
      }
    });
    if (!hasBinding && !validatePublicOperationArgumentsV1(step.operationId, step.arguments)) {
      throw new PublicOperationBoundaryError('invalid compiled plan arguments');
    }
    priorStepOperations.set(step.stepId, step.operationId);
  }
}

export async function executeCandidateTwoCompiledPlanV1(
  plan: CandidateTwoCompiledPlanV1,
  deps: PublicOperationExecutionDependenciesV1,
  signal?: AbortSignal,
): Promise<CandidateBoundaryResultV1> {
  const prepared = await prepareCandidateTwoCompiledPlanV1(plan, deps, signal);
  if (prepared.status === 'failed') return prepared.result;
  throwIfAborted(signal);
  prepared.commit();
  return prepared.result;
}

export interface PreparedCandidateTwoExecutionV1 {
  abort(): void;
  commit(): void;
  result: CandidateBoundaryResultV1 & { success: true };
  status: 'prepared';
}

export type CandidateTwoPreparationV1 = PreparedCandidateTwoExecutionV1 | {
  result: CandidateBoundaryResultV1 & { success: false };
  status: 'failed';
};

/**
 * Executes into an exclusive local transaction without committing it. Verified
 * mode can post the bounded results/fingerprint to the kernel and settle this
 * handle only after the private verdict; Fast mode uses the wrapper above.
 */
export async function prepareCandidateTwoCompiledPlanV1(
  plan: CandidateTwoCompiledPlanV1,
  deps: PublicOperationExecutionDependenciesV1,
  signal?: AbortSignal,
): Promise<CandidateTwoPreparationV1> {
  throwIfAborted(signal);
  validateCandidateTwoCompiledPlanV1(plan);
  if (deps.getTimelineRevision() !== plan.expectedTimelineRevision) {
    throw new PublicOperationBoundaryError('stale timeline revision');
  }

  const requiresTransaction = plan.steps.some((step) => (
    getPublicOperationSpecV1(step.operationId)?.transaction === 'required'
  ));
  const transaction = requiresTransaction
    ? deps.transaction.begin(`Kernel compiled plan ${plan.batchId}`)
    : undefined;
  const priorResults = new Map<string, ToolResult>();
  const results: CandidateBoundaryResultV1['results'] = [];
  try {
    for (const step of plan.steps) {
      throwIfAborted(signal);
      const resolved = resolveArgument(step.arguments, priorResults);
      if (
        !isRecord(resolved)
        || !validatePublicOperationArgumentsV1(step.operationId, resolved)
      ) {
        throw new PublicOperationBoundaryError('resolved operation arguments are invalid');
      }
      if (!deps.authorize(step.operationId, resolved)) {
        throw new PublicOperationBoundaryError('local policy denied operation');
      }
      const dispatched = transaction === undefined
        ? deps.dispatch(step.operationId, resolved)
        : deps.transaction.run(
            transaction,
            () => deps.dispatch(step.operationId, resolved),
          );
      const result = projectPublicOperationResultV1(
        step.operationId,
        await waitForDispatchOrAbort(dispatched, signal),
        resolved,
      );
      throwIfAborted(signal);
      results.push({ operationId: step.operationId, result, sequence: step.sequence });
      if (!result.success) {
        if (transaction !== undefined) deps.transaction.abort(transaction);
        return {
          result: { batchId: plan.batchId, results, success: false },
          status: 'failed',
        };
      }
      priorResults.set(step.stepId, result);
    }
    const result = { batchId: plan.batchId, results, success: true } as const;
    let settled = false;
    const settle = (action: 'abort' | 'commit'): void => {
      if (settled) {
        throw new PublicOperationBoundaryError('prepared operation is already settled');
      }
      if (action === 'abort') {
        try {
          if (transaction !== undefined) deps.transaction.abort(transaction);
        } finally {
          settled = true;
        }
        return;
      }
      try {
        if (transaction !== undefined) deps.transaction.commit(transaction);
        settled = true;
      } catch (error) {
        try {
          if (transaction !== undefined) deps.transaction.abort(transaction);
        } finally {
          settled = true;
        }
        throw error;
      }
    };
    return {
      abort: () => settle('abort'),
      commit: () => settle('commit'),
      result,
      status: 'prepared',
    };
  } catch (error) {
    if (transaction !== undefined) deps.transaction.abort(transaction);
    throw error;
  }
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('Kernel operation execution was canceled.', 'AbortError');
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortReason(signal);
}

async function waitForDispatchOrAbort<T>(
  dispatched: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (!signal) return dispatched;
  throwIfAborted(signal);
  return await new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    dispatched.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', onAbort);
    });
  });
}

export type { BoundaryTransactionV1 };
