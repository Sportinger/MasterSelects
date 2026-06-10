interface ProxyGenerationLogger {
  debug(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}

export function createProxyVideoDecoder(
  codecConfig: VideoDecoderConfig,
  handleDecodedFrame: (frame: VideoFrame) => void,
  log: ProxyGenerationLogger
): VideoDecoder {
  let errorCount = 0;
  const decoder = new VideoDecoder({
    output: handleDecodedFrame,
    error: (error) => {
      errorCount++;
      if (errorCount <= 5) {
        log.error('Decoder error', error.message || error);
      }
    },
  });

  decoder.configure(codecConfig);
  log.debug('Decoder configured', {
    codec: codecConfig.codec,
    size: `${codecConfig.codedWidth}x${codecConfig.codedHeight}`,
  });
  return decoder;
}
