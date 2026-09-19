import { decodeAmf0Values, encodeAmf0Values } from './amf0';
import type { Amf0Value } from './amf0';
import {
  buildSetChunkSizeMessage,
  encodeRtmpMessage,
  RtmpChunkDecoder,
  type RtmpMessage,
} from './chunkStream';
import { performSimpleHandshake, StreamByteReader } from './handshake';
import type { RtmpTarget, RtmpTransport } from './types';

const OUTBOUND_CHUNK_SIZE = 4_096;
const HANDSHAKE_TIMEOUT_MS = 10_000;
const WRITE_TIMEOUT_MS = 8_000;

export interface RtmpClientHooks {
  onDebug(message: string): void;
  onConnected(): Promise<void> | void;
  onPublishing(): Promise<void> | void;
}

export class RtmpClient {
  private readonly decoder = new RtmpChunkDecoder();
  private lastAcknowledgement = 0;
  private publishing = false;
  private receivedBytes = 0;
  private streamId = 0;
  private windowAcknowledgementSize = 0;
  private writeChain = Promise.resolve();
  private readonly transport: RtmpTransport;

  constructor(transport: RtmpTransport) {
    this.transport = transport;
  }

  get sentBytes(): number {
    return this.totalSentBytes;
  }

  private totalSentBytes = 0;

  async run(
    target: RtmpTarget,
    publishName: string,
    hooks: RtmpClientHooks,
    signal: AbortSignal,
  ): Promise<void> {
    const reader = new StreamByteReader(this.transport.readable.getReader());
    const abort = (): void => {
      void this.transport.close();
      void reader.cancel();
    };
    signal.addEventListener('abort', abort, { once: true });
    try {
      await withTimeout(
        performSimpleHandshake(reader, (bytes) => this.write(bytes)),
        HANDSHAKE_TIMEOUT_MS,
        'RTMP handshake timed out',
      );
      if (signal.aborted) return;
      await hooks.onConnected();
      await this.write(buildSetChunkSizeMessage(OUTBOUND_CHUNK_SIZE));
      await this.sendConnect(target);

      while (!signal.aborted) {
        const bytes = await reader.readAvailable();
        if (!bytes) {
          if (signal.aborted) return;
          throw new Error('RTMP server closed the connection');
        }
        this.receivedBytes = (this.receivedBytes + bytes.byteLength) >>> 0;
        let messages = this.decoder.push(bytes, 1);
        while (messages.length) {
          await this.handleMessage(messages[0]!, publishName, hooks);
          messages = this.decoder.push(new Uint8Array(0), 1);
        }
        await this.maybeAcknowledge();
      }
    } finally {
      signal.removeEventListener('abort', abort);
      await Promise.resolve(this.transport.close()).catch(() => undefined);
    }
  }

  async publishAudio(body: Uint8Array, timestamp: number): Promise<void> {
    this.assertPublishing();
    await this.sendMessage(4, 8, this.streamId, timestamp, body);
  }

  async publishVideo(body: Uint8Array, timestamp: number): Promise<void> {
    this.assertPublishing();
    await this.sendMessage(6, 9, this.streamId, timestamp, body);
  }

  async close(): Promise<void> {
    await Promise.resolve(this.transport.close()).catch(() => undefined);
  }

  private async handleMessage(
    message: RtmpMessage,
    publishName: string,
    hooks: RtmpClientHooks,
  ): Promise<void> {
    if (message.typeId === 1) {
      if (message.payload.byteLength < 4) throw new Error('Invalid RTMP SetChunkSize message');
      const size = new DataView(
        message.payload.buffer,
        message.payload.byteOffset,
        4,
      ).getUint32(0, false) & 0x7fff_ffff;
      this.decoder.setChunkSize(size);
      return;
    }
    if (message.typeId === 5) {
      if (message.payload.byteLength >= 4) {
        this.windowAcknowledgementSize = new DataView(
          message.payload.buffer,
          message.payload.byteOffset,
          4,
        ).getUint32(0, false);
      }
      return;
    }
    if (message.typeId === 4) {
      if (!await this.handleUserControl(message.payload)) {
        hooks.onDebug('Ignored RTMP user-control event');
      }
      return;
    }
    if (message.typeId !== 20 && message.typeId !== 17) {
      hooks.onDebug(`Ignored RTMP message type ${message.typeId}`);
      return;
    }

    const commandPayload = message.typeId === 17 && message.payload[0] === 0
      ? message.payload.subarray(1)
      : message.payload;
    const values = decodeAmf0Values(commandPayload);
    const command = values[0];
    if (typeof command !== 'string') return;
    if (command === '_error') throw new Error('RTMP server rejected a command');

    if (command === '_result') {
      const transactionId = typeof values[1] === 'number' ? values[1] : -1;
      if (transactionId === 1) {
        await this.sendCreateStream();
      } else if (transactionId === 2) {
        const streamId = values.find((value, index) => index >= 3 && typeof value === 'number');
        if (typeof streamId !== 'number' || streamId <= 0) {
          throw new Error('RTMP createStream returned an invalid stream ID');
        }
        this.streamId = streamId >>> 0;
        await this.sendPublish(publishName);
      }
      return;
    }

    if (command === 'onStatus') {
      const status = values.find(isAmfObject);
      const code = typeof status?.code === 'string' ? status.code : '';
      const level = typeof status?.level === 'string' ? status.level : '';
      if (code === 'NetStream.Publish.Start') {
        if (!this.publishing) {
          this.publishing = true;
          await hooks.onPublishing();
        }
        return;
      }
      if (
        level.toLowerCase() === 'error'
        || code.startsWith('NetStream.Publish.')
        || /(?:Failed|Rejected|Error)$/.test(code)
      ) {
        throw new Error(code ? `RTMP publish rejected (${code})` : 'RTMP server reported an error');
      }
    }
    hooks.onDebug('Ignored RTMP command event');
  }

  private async handleUserControl(payload: Uint8Array): Promise<boolean> {
    if (payload.byteLength < 2) return false;
    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    const eventType = view.getUint16(0, false);
    if (eventType !== 6 || payload.byteLength < 6) return false;
    const response = new Uint8Array(6);
    const responseView = new DataView(response.buffer);
    responseView.setUint16(0, 7, false);
    responseView.setUint32(2, view.getUint32(2, false), false);
    await this.sendMessage(2, 4, 0, 0, response);
    return true;
  }

  private async maybeAcknowledge(): Promise<void> {
    if (!this.windowAcknowledgementSize) return;
    const distance = (this.receivedBytes - this.lastAcknowledgement) >>> 0;
    if (distance < this.windowAcknowledgementSize) return;
    const payload = new Uint8Array(4);
    new DataView(payload.buffer).setUint32(0, this.receivedBytes, false);
    await this.sendMessage(2, 3, 0, 0, payload);
    this.lastAcknowledgement = this.receivedBytes;
  }

  private async sendConnect(target: RtmpTarget): Promise<void> {
    await this.sendCommand(0, [
      'connect',
      1,
      {
        app: target.app,
        audioCodecs: 4_071,
        capabilities: 15,
        flashVer: 'FMLE/3.0',
        fpad: false,
        objectEncoding: 0,
        tcUrl: target.tcUrl,
        videoCodecs: 252,
        videoFunction: 1,
      },
    ]);
  }

  private async sendCreateStream(): Promise<void> {
    await this.sendCommand(0, ['createStream', 2, null]);
  }

  private async sendPublish(publishName: string): Promise<void> {
    await this.sendCommand(this.streamId, ['publish', 0, null, publishName, 'live']);
  }

  private async sendCommand(messageStreamId: number, values: Parameters<typeof encodeAmf0Values>[0]): Promise<void> {
    await this.sendMessage(3, 20, messageStreamId, 0, encodeAmf0Values(values));
  }

  private async sendMessage(
    chunkStreamId: number,
    typeId: number,
    messageStreamId: number,
    timestamp: number,
    payload: Uint8Array,
  ): Promise<void> {
    await this.write(encodeRtmpMessage({
      chunkStreamId,
      messageStreamId,
      payload,
      timestamp,
      typeId,
    }, OUTBOUND_CHUNK_SIZE));
  }

  private async write(bytes: Uint8Array): Promise<void> {
    if (!bytes.byteLength) return;
    const queuedWrite = this.writeChain.then(() => withTimeout(
      this.transport.write(bytes),
      WRITE_TIMEOUT_MS,
      'RTMP TCP write stalled for more than 8 seconds',
    ));
    this.writeChain = queuedWrite.catch(() => undefined);
    await queuedWrite;
    this.totalSentBytes += bytes.byteLength;
  }

  private assertPublishing(): void {
    if (!this.publishing || !this.streamId) throw new Error('RTMP publisher is not ready');
  }
}

function isAmfObject(value: Amf0Value): value is { [key: string]: Amf0Value } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(message));
      },
    );
  });
}
