import {
  isCompressed,
  isJpeg,
  parseFrameHeader,
} from './protocol';
import type { Response } from './protocol';
import type {
  DecodedFrame,
  NativeHelperCommandHost,
  NativeHelperJsonMessage,
} from './nativeHelperClientTypes';

type NativeHelperLogger = {
  debug: (message: string, data?: unknown) => void;
  error: (message: string, data?: unknown) => void;
  warn: (message: string, data?: unknown) => void;
};

export async function handleNativeHelperMessage(
  host: NativeHelperCommandHost,
  data: string | ArrayBuffer,
  log: NativeHelperLogger,
): Promise<void> {
  if (typeof data === 'string') {
    await handleJsonMessage(host, data, log);
    return;
  }

  handleBinaryFrame(host, data, log);
}
async function handleJsonMessage(
  host: NativeHelperCommandHost,
  data: string,
  log: NativeHelperLogger,
): Promise<void> {
  try {
    const message = JSON.parse(data) as NativeHelperJsonMessage;
    if (!message.id) {
      return;
    }

    const isProgress = message.type === 'progress';
    const callback = host.getPendingRequest(message.id);

    if (callback) {
      if (!isProgress) {
        host.deletePendingRequest(message.id);
      }
      callback(message as Response);
    }
  } catch (err) {
    log.error('Failed to parse response', err);
  }
}
function handleBinaryFrame(
  host: NativeHelperCommandHost,
  data: ArrayBuffer,
  log: NativeHelperLogger,
): void {
  const header = parseFrameHeader(data);

  if (!header) {
    log.error('Invalid frame header');
    return;
  }

  const payloadStart = 16;
  const payload = new Uint8Array(data, payloadStart);
  const jpegFrame = isJpeg(header.flags);

  if (!jpegFrame && isCompressed(header.flags)) {
    log.warn('LZ4 decompression not implemented, using raw data');
  }

  const frame: DecodedFrame = {
    width: header.width,
    height: header.height,
    frameNum: header.frameNum,
    data: new Uint8ClampedArray(payload),
    requestId: header.requestId,
    isJpeg: jpegFrame,
  };

  host.dispatchFrame(frame);
}
