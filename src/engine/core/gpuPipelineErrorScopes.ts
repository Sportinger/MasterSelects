/**
 * GPU pipeline creation fails in three distinct ways: invalid descriptors or
 * shaders (validation), a driver compiler that gives up (internal, e.g. Vulkan
 * `CreateGraphicsPipelines failed with VK_ERROR_UNKNOWN` on mobile drivers), or
 * memory exhaustion. A scope for `validation` alone lets the other two escape as
 * uncaptured errors; the caller then keeps the invalid pipeline, and every frame
 * that sets it invalidates its whole command buffer, so all layers stop rendering.
 */
const PIPELINE_ERROR_FILTERS: readonly GPUErrorFilter[] = ['out-of-memory', 'internal', 'validation'];

export interface PipelineCreationFailure {
  kind: GPUErrorFilter;
  message: string;
}

export function canScopePipelineErrors(device: GPUDevice): boolean {
  return typeof device.pushErrorScope === 'function' && typeof device.popErrorScope === 'function';
}

export function pushPipelineErrorScopes(device: GPUDevice): void {
  for (const filter of PIPELINE_ERROR_FILTERS) device.pushErrorScope(filter);
}

/**
 * Pops the scopes pushed by `pushPipelineErrorScopes`. All pops are issued
 * synchronously so no other scope can interleave; the innermost error wins.
 */
export function popPipelineErrorScopes(device: GPUDevice): Promise<PipelineCreationFailure | null> {
  const pops = [...PIPELINE_ERROR_FILTERS].reverse().map(kind => ({ kind, error: device.popErrorScope() }));
  return Promise.all(pops.map(async ({ kind, error }) => {
    const value = await error;
    return value ? { kind, message: value.message } : null;
  })).then(results => results.find(result => result !== null) ?? null);
}
