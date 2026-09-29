// MXF H.264 decode worker: owns the file reads, the WebCodecs decoder and the
// long-GOP engine, so neither disk reads nor decoder callbacks wait behind the
// editor's busy main thread. Frames are transferred back per request.

import { MxfPacketSource } from '../services/mediaRuntime/mxf/MxfPacketSource';
import { MxfGopEngine, type MxfGopEngineStats } from '../services/mediaRuntime/mxf/mxfGopEngine';
import { createAvcDecoderConfig, WebCodecsGopDecoder } from '../services/mediaRuntime/mxf/webCodecsGopDecoder';

export type MxfAvcDecodeWorkerRequest =
  | { type: 'open'; file: File; codecId: string }
  | { type: 'frame'; id: number; displayIndex: number }
  | { type: 'close' };

export type MxfAvcDecodeWorkerResponse =
  | { type: 'opened'; codec: string }
  | { type: 'frame'; id: number; frame: VideoFrame; stats: MxfGopEngineStats }
  | { type: 'error'; id: number | null; error: string };

let source: MxfPacketSource | null = null;
let engine: MxfGopEngine | null = null;

function post(message: MxfAvcDecodeWorkerResponse, transfer: Transferable[] = []): void {
  (self as unknown as Worker).postMessage(message, transfer);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

self.onmessage = async (event: MessageEvent<MxfAvcDecodeWorkerRequest>) => {
  const request = event.data;
  if (request.type === 'open') {
    try {
      source = await MxfPacketSource.create(request.file, request.codecId);
      const config = await createAvcDecoderConfig(source);
      engine = new MxfGopEngine(source, 'MXF AVC');
      await engine.attachDecoder(async (callbacks) => new WebCodecsGopDecoder(config, callbacks));
      post({ type: 'opened', codec: config.codec });
    } catch (error) {
      post({ type: 'error', id: null, error: errorText(error) });
    }
  } else if (request.type === 'frame') {
    if (!engine) {
      post({ type: 'error', id: request.id, error: 'MXF AVC worker is not open' });
      return;
    }
    const current = engine;
    current.decodeFrame(request.displayIndex).then(
      (frame) => post({ type: 'frame', id: request.id, frame, stats: current.stats }, [frame as unknown as Transferable]),
      (error) => post({ type: 'error', id: request.id, error: errorText(error) }),
    );
  } else if (request.type === 'close') {
    engine?.close();
    source?.dispose();
    engine = null;
    source = null;
    self.close();
  }
};
