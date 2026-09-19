export class StreamByteReader {
  private buffered: Uint8Array = new Uint8Array(0);
  private done = false;
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;

  constructor(reader: ReadableStreamDefaultReader<Uint8Array>) {
    this.reader = reader;
  }

  async readExactly(length: number): Promise<Uint8Array> {
    while (this.buffered.byteLength < length && !this.done) await this.pull();
    if (this.buffered.byteLength < length) throw new Error('RTMP server closed during handshake');
    const result = this.buffered.slice(0, length);
    this.buffered = this.buffered.slice(length);
    return result;
  }

  async readAvailable(): Promise<Uint8Array | null> {
    if (this.buffered.byteLength === 0 && !this.done) await this.pull();
    if (this.buffered.byteLength === 0) return null;
    const result = this.buffered;
    this.buffered = new Uint8Array(0);
    return result;
  }

  async cancel(): Promise<void> {
    await this.reader.cancel().catch(() => undefined);
  }

  private async pull(): Promise<void> {
    const next = await this.reader.read();
    if (next.done) {
      this.done = true;
      return;
    }
    if (!next.value.byteLength) return;
    const combined = new Uint8Array(this.buffered.byteLength + next.value.byteLength);
    combined.set(this.buffered);
    combined.set(next.value, this.buffered.byteLength);
    this.buffered = combined;
  }
}

export function buildSimpleHandshakeC0C1(nowMs = Date.now()): Uint8Array {
  const bytes = new Uint8Array(1 + 1_536);
  bytes[0] = 3;
  new DataView(bytes.buffer).setUint32(1, Math.floor(nowMs / 1_000) >>> 0, false);
  // C1 bytes 4..1535 deliberately remain zero for the RTMP simple handshake.
  return bytes;
}

export async function performSimpleHandshake(
  reader: StreamByteReader,
  write: (bytes: Uint8Array) => Promise<void>,
): Promise<void> {
  await write(buildSimpleHandshakeC0C1());
  const response = await reader.readExactly(1 + 1_536 + 1_536);
  if (response[0] !== 3) throw new Error('RTMP server returned an unsupported handshake version');
  await write(response.slice(1, 1 + 1_536));
}
