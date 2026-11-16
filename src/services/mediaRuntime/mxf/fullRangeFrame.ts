/**
 * Relabels a decoded frame as full range (data levels override). Chrome lets the stream's own range
 * flag win over VideoDecoderConfig.colorSpace, so the planes are copied into a new frame whose color
 * space says full range; superwhites then survive the YUV to RGB conversion instead of clipping.
 */
export async function relabelFullRange(frame: VideoFrame): Promise<VideoFrame> {
  if (frame.colorSpace.fullRange || !frame.format) return frame;
  try {
    const data = new Uint8Array(frame.allocationSize());
    const layout = await frame.copyTo(data);
    const rect = frame.visibleRect;
    return new VideoFrame(data, {
      format: frame.format,
      codedWidth: rect?.width ?? frame.codedWidth,
      codedHeight: rect?.height ?? frame.codedHeight,
      displayWidth: frame.displayWidth,
      displayHeight: frame.displayHeight,
      timestamp: frame.timestamp,
      ...(frame.duration ? { duration: frame.duration } : {}),
      layout,
      colorSpace: { ...frame.colorSpace.toJSON(), fullRange: true },
    });
  } finally {
    frame.close();
  }
}
