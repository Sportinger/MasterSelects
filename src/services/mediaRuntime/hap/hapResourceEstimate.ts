// Resource estimates for HAP provider admission. HAP decode holds RGBA
// frames (current + prefetch + in-flight worker output) plus the demux blob
// cache — far lighter than a general-purpose video decoder.

export const HAP_BLOB_CACHE_BYTES = 32 * 1024 * 1024;

export interface HapResourceEstimate {
  heapBytes: number;
  decodedFrameBytes: number;
}

export function estimateHapResources(options: {
  width: number;
  height: number;
}): HapResourceEstimate {
  const decodedFrameBytes = Math.max(1, options.width) * Math.max(1, options.height) * 4;
  // current frame + prefetched frame + worker output + packet copies.
  return {
    decodedFrameBytes,
    heapBytes: HAP_BLOB_CACHE_BYTES + decodedFrameBytes * 3 + decodedFrameBytes,
  };
}
