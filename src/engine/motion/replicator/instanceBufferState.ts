import {
  MOTION_REPLICATOR_DEFAULT_MAX_BUFFER_CAPACITY,
  MOTION_REPLICATOR_INSTANCE_BYTE_STRIDE,
  MOTION_REPLICATOR_INSTANCE_FLOAT_STRIDE,
  MOTION_REPLICATOR_MIN_BUFFER_CAPACITY,
  type ReplicatorBufferUpdate,
  type ReplicatorDirtyUploadRange,
} from './runtimeContracts';
import { planReplicatorInstanceCapacity } from './resourcePlanning';

export interface ReplicatorInstanceBufferOptions {
  maxCapacity?: number;
  minimumCapacity?: number;
}

function validateIdentity(value: string): string {
  let hasControlCharacter = false;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x1f || codeUnit === 0x7f) {
      hasControlCharacter = true;
      break;
    }
  }
  if (value.length < 1 || value.length > 2_048 || hasControlCharacter) {
    throw new RangeError('cacheIdentity must be 1..2048 characters without control characters');
  }
  return value;
}

function validateDenseInstanceData(value: Float32Array, instanceCount: number): void {
  if (Object.getPrototypeOf(value) !== Float32Array.prototype) {
    throw new TypeError('instanceData must use the standard Float32Array prototype');
  }
  if (value.length !== instanceCount * MOTION_REPLICATOR_INSTANCE_FLOAT_STRIDE) {
    throw new RangeError('instanceData length does not match instanceCount and stride');
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Number.isFinite(value[index])) {
      throw new RangeError(`instanceData[${index}] must be finite`);
    }
  }
}

function equalInstance(
  previous: Float32Array,
  next: Float32Array,
  instanceIndex: number,
): boolean {
  const start = instanceIndex * MOTION_REPLICATOR_INSTANCE_FLOAT_STRIDE;
  for (let field = 0; field < MOTION_REPLICATOR_INSTANCE_FLOAT_STRIDE; field += 1) {
    if (!Object.is(previous[start + field], next[start + field])) return false;
  }
  return true;
}

function createRange(instanceStart: number, instanceCount: number): ReplicatorDirtyUploadRange {
  return {
    instanceStart,
    instanceCount,
    byteOffset: instanceStart * MOTION_REPLICATOR_INSTANCE_BYTE_STRIDE,
    byteLength: instanceCount * MOTION_REPLICATOR_INSTANCE_BYTE_STRIDE,
  };
}

function calculateDirtyRanges(
  previous: Float32Array,
  previousCount: number,
  next: Float32Array,
  nextCount: number,
): ReplicatorDirtyUploadRange[] {
  const ranges: ReplicatorDirtyUploadRange[] = [];
  let rangeStart = -1;
  for (let instance = 0; instance < nextCount; instance += 1) {
    const dirty = instance >= previousCount || !equalInstance(previous, next, instance);
    if (dirty && rangeStart < 0) rangeStart = instance;
    if (!dirty && rangeStart >= 0) {
      ranges.push(createRange(rangeStart, instance - rangeStart));
      rangeStart = -1;
    }
  }
  if (rangeStart >= 0) ranges.push(createRange(rangeStart, nextCount - rangeStart));
  return ranges;
}

/**
 * CPU mirror of a dynamic GPU instance buffer. It exposes exact allocation and
 * upload plans so a WebGPU owner can execute them without owning semantic state.
 */
export class ReplicatorInstanceBufferState {
  readonly maxCapacity: number;
  readonly minimumCapacity: number;

  #buffer = new Float32Array(0);
  #capacity = 0;
  #usedInstances = 0;
  #cacheIdentity: string | null = null;
  #cacheHits = 0;
  #cacheMisses = 0;
  #reallocations = 0;
  #uploadedBytes = 0;
  #forceFullUpload = false;

  constructor(options: ReplicatorInstanceBufferOptions = {}) {
    this.maxCapacity = options.maxCapacity ?? MOTION_REPLICATOR_DEFAULT_MAX_BUFFER_CAPACITY;
    this.minimumCapacity = options.minimumCapacity ?? MOTION_REPLICATOR_MIN_BUFFER_CAPACITY;
    planReplicatorInstanceCapacity({
      currentCapacity: 0,
      requiredInstances: 0,
      maxCapacity: this.maxCapacity,
      minimumCapacity: this.minimumCapacity,
    });
  }

  prepare(
    cacheIdentityValue: string,
    instanceData: Float32Array,
    instanceCount: number,
  ): ReplicatorBufferUpdate {
    const cacheIdentity = validateIdentity(cacheIdentityValue);
    if (!Number.isSafeInteger(instanceCount) || instanceCount < 0) {
      throw new RangeError('instanceCount must be a non-negative safe integer');
    }
    validateDenseInstanceData(instanceData, instanceCount);
    const capacityPlan = planReplicatorInstanceCapacity({
      currentCapacity: this.#capacity,
      requiredInstances: instanceCount,
      maxCapacity: this.maxCapacity,
      minimumCapacity: this.minimumCapacity,
    });
    if (!capacityPlan.ok) throw new RangeError(capacityPlan.diagnostic?.message);

    const previousCapacity = this.#capacity;
    const previousData = this.#buffer.subarray(
      0,
      this.#usedInstances * MOTION_REPLICATOR_INSTANCE_FLOAT_STRIDE,
    );
    let cacheHit = false;
    let dirtyRanges: ReplicatorDirtyUploadRange[];

    if (capacityPlan.reallocated) {
      const replacement = new Float32Array(
        capacityPlan.capacity * MOTION_REPLICATOR_INSTANCE_FLOAT_STRIDE,
      );
      replacement.set(instanceData);
      this.#buffer = replacement;
      this.#capacity = capacityPlan.capacity;
      this.#reallocations += 1;
      dirtyRanges = instanceCount === 0 ? [] : [createRange(0, instanceCount)];
    } else if (this.#forceFullUpload) {
      this.#buffer.set(instanceData, 0);
      dirtyRanges = instanceCount === 0 ? [] : [createRange(0, instanceCount)];
    } else {
      dirtyRanges = calculateDirtyRanges(
        previousData,
        this.#usedInstances,
        instanceData,
        instanceCount,
      );
      cacheHit = this.#cacheIdentity === cacheIdentity && dirtyRanges.length === 0;
      this.#buffer.set(instanceData, 0);
    }

    if (cacheHit) this.#cacheHits += 1;
    else this.#cacheMisses += 1;
    const uploadedBytes = dirtyRanges.reduce((total, range) => total + range.byteLength, 0);
    this.#uploadedBytes += uploadedBytes;
    this.#cacheIdentity = cacheIdentity;
    this.#usedInstances = instanceCount;
    this.#forceFullUpload = false;

    return {
      cacheIdentity,
      data: instanceData,
      dirtyRanges,
      stats: {
        cacheHit,
        reallocated: capacityPlan.reallocated,
        previousCapacity,
        capacity: this.#capacity,
        usedInstances: instanceCount,
        allocatedBytes: this.#buffer.byteLength,
        uploadedBytes,
        uploadRangeCount: dirtyRanges.length,
        cumulativeCacheHits: this.#cacheHits,
        cumulativeCacheMisses: this.#cacheMisses,
        cumulativeReallocations: this.#reallocations,
        cumulativeUploadedBytes: this.#uploadedBytes,
      },
    };
  }

  invalidate(): void {
    this.#cacheIdentity = null;
    this.#forceFullUpload = true;
  }
}
