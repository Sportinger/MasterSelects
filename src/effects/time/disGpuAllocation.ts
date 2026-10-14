/** Balance DIS allocation scopes and preserve the original synchronous failure. */
export async function allocateDisGpuResource<T>(
  device: GPUDevice,
  label: string,
  allocate: () => T,
  release: (resource: T) => void,
): Promise<T> {
  device.pushErrorScope('out-of-memory');
  device.pushErrorScope('validation');
  let resource: { value: T } | undefined;
  let allocationError: unknown;
  try {
    resource = { value: allocate() };
  } catch (error) {
    allocationError = error;
  }
  const scopes = await Promise.allSettled([device.popErrorScope(), device.popErrorScope()]);
  if (!resource) throw allocationError;
  for (const scope of scopes) {
    const error = scope.status === 'rejected' ? scope.reason : scope.value;
    if (scope.status === 'rejected' || error) {
      release(resource.value);
      const message = error instanceof Error || (error && typeof error.message === 'string')
        ? error.message : String(error);
      throw new Error(`${label}: ${message}`, { cause: error });
    }
  }
  return resource.value;
}
