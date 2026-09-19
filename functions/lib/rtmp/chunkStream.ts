import { concatBytes } from './amf0';

export interface RtmpMessage {
  chunkStreamId: number;
  messageStreamId: number;
  payload: Uint8Array;
  timestamp: number;
  typeId: number;
}

interface ChunkHeader {
  extendedTimestamp: boolean;
  fmt: number;
  messageLength: number;
  messageStreamId: number;
  timestamp: number;
  timestampDelta: number;
  typeId: number;
}

interface PartialMessage {
  header: ChunkHeader;
  payload: Uint8Array;
  received: number;
}

export function encodeRtmpMessage(message: RtmpMessage, chunkSize: number): Uint8Array {
  if (message.chunkStreamId < 2 || message.chunkStreamId > 63) {
    throw new Error('RTMP encoder supports chunk stream IDs 2 through 63');
  }
  if (message.payload.byteLength > 0xff_ffff) throw new Error('RTMP message is too large');
  if (chunkSize <= 0) throw new Error('RTMP chunk size must be positive');

  const timestamp = message.timestamp >>> 0;
  const extended = timestamp >= 0xff_ffff;
  const firstHeader = new Uint8Array(12 + (extended ? 4 : 0));
  firstHeader[0] = message.chunkStreamId;
  writeU24(firstHeader, 1, extended ? 0xff_ffff : timestamp);
  writeU24(firstHeader, 4, message.payload.byteLength);
  firstHeader[7] = message.typeId;
  new DataView(firstHeader.buffer).setUint32(8, message.messageStreamId >>> 0, true);
  if (extended) new DataView(firstHeader.buffer).setUint32(12, timestamp, false);

  const chunks: Uint8Array[] = [];
  let offset = 0;
  let first = true;
  do {
    const end = Math.min(offset + chunkSize, message.payload.byteLength);
    if (first) {
      chunks.push(firstHeader, message.payload.subarray(offset, end));
      first = false;
    } else {
      const continuation = new Uint8Array(1 + (extended ? 4 : 0));
      continuation[0] = 0xc0 | message.chunkStreamId;
      if (extended) new DataView(continuation.buffer).setUint32(1, timestamp, false);
      chunks.push(continuation, message.payload.subarray(offset, end));
    }
    offset = end;
  } while (offset < message.payload.byteLength);
  return concatBytes(chunks);
}

export function buildSetChunkSizeMessage(chunkSize: number): Uint8Array {
  const payload = new Uint8Array(4);
  new DataView(payload.buffer).setUint32(0, chunkSize & 0x7fff_ffff, false);
  return encodeRtmpMessage({
    chunkStreamId: 2,
    messageStreamId: 0,
    payload,
    timestamp: 0,
    typeId: 1,
  }, 128);
}

export class RtmpChunkDecoder {
  private buffer: Uint8Array = new Uint8Array(0);
  private chunkSize: number;
  private readonly partials = new Map<number, PartialMessage>();
  private readonly previousHeaders = new Map<number, ChunkHeader>();

  constructor(chunkSize = 128) {
    this.chunkSize = chunkSize;
  }

  setChunkSize(chunkSize: number): void {
    if (!Number.isInteger(chunkSize) || chunkSize <= 0 || chunkSize > 0x7fff_ffff) {
      throw new Error('Invalid inbound RTMP chunk size');
    }
    this.chunkSize = chunkSize;
  }

  push(bytes: Uint8Array, maxMessages = Number.POSITIVE_INFINITY): RtmpMessage[] {
    if (bytes.byteLength) this.buffer = concatBytes([this.buffer, bytes]);
    const messages: RtmpMessage[] = [];
    while (messages.length < maxMessages && this.readChunk(messages)) {
      // Drain every complete chunk currently buffered.
    }
    return messages;
  }

  private readChunk(messages: RtmpMessage[]): boolean {
    const basic = parseBasicHeader(this.buffer);
    if (!basic) return false;
    const previous = this.previousHeaders.get(basic.chunkStreamId);
    const current = this.partials.get(basic.chunkStreamId);
    const messageHeaderLength = basic.fmt === 0 ? 11 : basic.fmt === 1 ? 7 : basic.fmt === 2 ? 3 : 0;
    if (this.buffer.byteLength < basic.length + messageHeaderLength) return false;
    if (basic.fmt !== 3 && current && current.received < current.header.messageLength) {
      throw new Error('RTMP message header interrupted a partial chunk stream');
    }
    if (basic.fmt !== 0 && !previous) throw new Error('RTMP compressed header has no predecessor');

    let offset = basic.length;
    let header = basic.fmt === 3
      ? (current?.header ?? nextRepeatedHeader(previous!))
      : parseMessageHeader(this.buffer, offset, basic.fmt, previous);
    offset += messageHeaderLength;

    const rawTimestamp = basic.fmt === 3
      ? (header.extendedTimestamp ? 0xff_ffff : header.timestamp)
      : readU24(this.buffer, basic.length);
    const extended = rawTimestamp === 0xff_ffff || (basic.fmt === 3 && header.extendedTimestamp);
    if (extended) {
      if (this.buffer.byteLength < offset + 4) return false;
      const value = new DataView(this.buffer.buffer, this.buffer.byteOffset + offset, 4).getUint32(0, false);
      offset += 4;
      if (basic.fmt === 0) header = { ...header, extendedTimestamp: true, timestamp: value };
      else if (basic.fmt === 1 || basic.fmt === 2) {
        header = { ...header, extendedTimestamp: true, timestamp: (previous!.timestamp + value) >>> 0, timestampDelta: value };
      } else {
        header = { ...header, extendedTimestamp: true };
      }
    }

    const partial = current ?? {
      header,
      payload: new Uint8Array(header.messageLength),
      received: 0,
    };
    const remaining = partial.header.messageLength - partial.received;
    const bodyLength = Math.min(this.chunkSize, remaining);
    if (this.buffer.byteLength < offset + bodyLength) return false;
    partial.payload.set(this.buffer.subarray(offset, offset + bodyLength), partial.received);
    partial.received += bodyLength;
    this.buffer = this.buffer.slice(offset + bodyLength);
    this.previousHeaders.set(basic.chunkStreamId, partial.header);

    if (partial.received === partial.header.messageLength) {
      this.partials.delete(basic.chunkStreamId);
      messages.push({
        chunkStreamId: basic.chunkStreamId,
        messageStreamId: partial.header.messageStreamId,
        payload: partial.payload,
        timestamp: partial.header.timestamp,
        typeId: partial.header.typeId,
      });
    } else {
      this.partials.set(basic.chunkStreamId, partial);
    }
    return true;
  }
}

function parseBasicHeader(bytes: Uint8Array): { chunkStreamId: number; fmt: number; length: number } | null {
  if (bytes.byteLength < 1) return null;
  const fmt = bytes[0]! >>> 6;
  const marker = bytes[0]! & 0x3f;
  if (marker === 0) {
    if (bytes.byteLength < 2) return null;
    return { chunkStreamId: 64 + bytes[1]!, fmt, length: 2 };
  }
  if (marker === 1) {
    if (bytes.byteLength < 3) return null;
    return { chunkStreamId: 64 + bytes[1]! + bytes[2]! * 256, fmt, length: 3 };
  }
  return { chunkStreamId: marker, fmt, length: 1 };
}

function parseMessageHeader(
  bytes: Uint8Array,
  offset: number,
  fmt: number,
  previous: ChunkHeader | undefined,
): ChunkHeader {
  const rawTimestamp = readU24(bytes, offset);
  if (fmt === 0) {
    return {
      extendedTimestamp: rawTimestamp === 0xff_ffff,
      fmt,
      messageLength: readU24(bytes, offset + 3),
      messageStreamId: new DataView(bytes.buffer, bytes.byteOffset + offset + 7, 4).getUint32(0, true),
      timestamp: rawTimestamp,
      timestampDelta: 0,
      typeId: bytes[offset + 6]!,
    };
  }
  const prior = previous!;
  const delta = rawTimestamp;
  return {
    extendedTimestamp: rawTimestamp === 0xff_ffff,
    fmt,
    messageLength: fmt === 1 ? readU24(bytes, offset + 3) : prior.messageLength,
    messageStreamId: prior.messageStreamId,
    timestamp: (prior.timestamp + delta) >>> 0,
    timestampDelta: delta,
    typeId: fmt === 1 ? bytes[offset + 6]! : prior.typeId,
  };
}

function nextRepeatedHeader(previous: ChunkHeader): ChunkHeader {
  const timestamp = previous.fmt === 0
    ? previous.timestamp
    : (previous.timestamp + previous.timestampDelta) >>> 0;
  return { ...previous, timestamp };
}

function readU24(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! * 0x1_0000 + bytes[offset + 1]! * 0x100 + bytes[offset + 2]!;
}

function writeU24(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 16) & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = value & 0xff;
}
