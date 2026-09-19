export type Amf0Value = boolean | number | string | null | undefined | Amf0Value[] | {
  [key: string]: Amf0Value;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function encodeAmf0Values(values: Amf0Value[]): Uint8Array {
  return concatBytes(values.map(encodeAmf0Value));
}

export function encodeAmf0Value(value: Amf0Value): Uint8Array {
  if (value === null) return Uint8Array.of(5);
  if (value === undefined) return Uint8Array.of(6);
  if (typeof value === 'number') {
    const bytes = new Uint8Array(9);
    bytes[0] = 0;
    new DataView(bytes.buffer).setFloat64(1, value, false);
    return bytes;
  }
  if (typeof value === 'boolean') return Uint8Array.of(1, value ? 1 : 0);
  if (typeof value === 'string') return encodeString(value);
  if (Array.isArray(value)) {
    const header = new Uint8Array(5);
    header[0] = 10;
    new DataView(header.buffer).setUint32(1, value.length, false);
    return concatBytes([header, ...value.map(encodeAmf0Value)]);
  }

  const properties: Uint8Array[] = [Uint8Array.of(3)];
  for (const [key, entry] of Object.entries(value)) {
    const keyBytes = encoder.encode(key);
    if (keyBytes.byteLength > 0xffff) throw new Error('AMF0 object key is too long');
    properties.push(withU16Length(keyBytes), encodeAmf0Value(entry));
  }
  properties.push(Uint8Array.of(0, 0, 9));
  return concatBytes(properties);
}

export function decodeAmf0Values(bytes: Uint8Array): Amf0Value[] {
  const values: Amf0Value[] = [];
  let offset = 0;
  while (offset < bytes.byteLength) {
    const decoded = decodeValue(bytes, offset);
    values.push(decoded.value);
    offset = decoded.offset;
  }
  return values;
}

function encodeString(value: string): Uint8Array {
  const bytes = encoder.encode(value);
  if (bytes.byteLength <= 0xffff) return concatBytes([Uint8Array.of(2), withU16Length(bytes)]);
  const header = new Uint8Array(5);
  header[0] = 12;
  new DataView(header.buffer).setUint32(1, bytes.byteLength, false);
  return concatBytes([header, bytes]);
}

function withU16Length(bytes: Uint8Array): Uint8Array {
  const result = new Uint8Array(bytes.byteLength + 2);
  new DataView(result.buffer).setUint16(0, bytes.byteLength, false);
  result.set(bytes, 2);
  return result;
}

function decodeValue(bytes: Uint8Array, start: number): { offset: number; value: Amf0Value } {
  ensureAvailable(bytes, start, 1);
  const marker = bytes[start]!;
  let offset = start + 1;
  if (marker === 0) {
    ensureAvailable(bytes, offset, 8);
    return { offset: offset + 8, value: new DataView(bytes.buffer, bytes.byteOffset + offset, 8).getFloat64(0, false) };
  }
  if (marker === 1) {
    ensureAvailable(bytes, offset, 1);
    return { offset: offset + 1, value: bytes[offset] !== 0 };
  }
  if (marker === 2 || marker === 12) {
    const lengthBytes = marker === 2 ? 2 : 4;
    ensureAvailable(bytes, offset, lengthBytes);
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, lengthBytes);
    const length = lengthBytes === 2 ? view.getUint16(0, false) : view.getUint32(0, false);
    offset += lengthBytes;
    ensureAvailable(bytes, offset, length);
    return { offset: offset + length, value: decoder.decode(bytes.subarray(offset, offset + length)) };
  }
  if (marker === 3 || marker === 8) {
    if (marker === 8) {
      ensureAvailable(bytes, offset, 4);
      offset += 4;
    }
    const value: Record<string, Amf0Value> = {};
    while (true) {
      ensureAvailable(bytes, offset, 2);
      const length = new DataView(bytes.buffer, bytes.byteOffset + offset, 2).getUint16(0, false);
      offset += 2;
      if (length === 0 && bytes[offset] === 9) return { offset: offset + 1, value };
      ensureAvailable(bytes, offset, length);
      const key = decoder.decode(bytes.subarray(offset, offset + length));
      offset += length;
      const decoded = decodeValue(bytes, offset);
      value[key] = decoded.value;
      offset = decoded.offset;
    }
  }
  if (marker === 5) return { offset, value: null };
  if (marker === 6) return { offset, value: undefined };
  if (marker === 10) {
    ensureAvailable(bytes, offset, 4);
    const length = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, false);
    offset += 4;
    const value: Amf0Value[] = [];
    for (let index = 0; index < length; index += 1) {
      const decoded = decodeValue(bytes, offset);
      value.push(decoded.value);
      offset = decoded.offset;
    }
    return { offset, value };
  }
  throw new Error(`Unsupported AMF0 marker ${marker}`);
}

function ensureAvailable(bytes: Uint8Array, offset: number, length: number): void {
  if (offset + length > bytes.byteLength) throw new Error('Truncated AMF0 value');
}

export function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
