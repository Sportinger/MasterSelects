// Generic dense time-series curve payload shared by audio-intelligence
// artifacts (prosody contours, VAD probability curves). Framing matches the
// established audio payload convention: u32 header length | JSON header |
// Float32 values.

export const DENSE_CURVE_PAYLOAD_VERSION = 1 as const;

export type DenseCurveValueEncoding = 'db' | 'hz' | 'unit' | 'per-second';

export interface DenseCurvePayloadHeader {
  schemaVersion: typeof DENSE_CURVE_PAYLOAD_VERSION;
  metric: string;
  channelIndex?: number;
  windowDuration: number;
  hopDuration: number;
  pointCount: number;
  valueLayout: 'time-series';
  valueEncoding: DenseCurveValueEncoding;
}

export interface DenseCurvePayload {
  header: DenseCurvePayloadHeader;
  values: Float32Array;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const VALUE_ENCODINGS: readonly DenseCurveValueEncoding[] = ['db', 'hz', 'unit', 'per-second'];

function assertPositiveFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive finite number.`);
  }
}

function assertHeader(header: DenseCurvePayloadHeader): void {
  if (header.schemaVersion !== DENSE_CURVE_PAYLOAD_VERSION) {
    throw new Error(`Unsupported dense curve payload schema version: ${header.schemaVersion}`);
  }
  if (!header.metric) {
    throw new Error('Dense curve metric must be a non-empty string.');
  }
  if (header.valueLayout !== 'time-series') {
    throw new Error(`Unsupported dense curve value layout: ${header.valueLayout}`);
  }
  if (!VALUE_ENCODINGS.includes(header.valueEncoding)) {
    throw new Error(`Unsupported dense curve value encoding: ${header.valueEncoding}`);
  }
  assertPositiveFinite(header.windowDuration, 'windowDuration');
  assertPositiveFinite(header.hopDuration, 'hopDuration');
  if (!Number.isInteger(header.pointCount) || header.pointCount < 0) {
    throw new Error('pointCount must be a non-negative integer.');
  }
}

export function encodeDenseCurvePayload(payload: DenseCurvePayload): ArrayBuffer {
  assertHeader(payload.header);
  if (payload.values.length !== payload.header.pointCount) {
    throw new Error('Dense curve payload value count must match pointCount.');
  }

  const headerBytes = textEncoder.encode(JSON.stringify(payload.header));
  const output = new ArrayBuffer(4 + headerBytes.byteLength + payload.values.byteLength);
  const view = new DataView(output);
  view.setUint32(0, headerBytes.byteLength, true);
  new Uint8Array(output, 4, headerBytes.byteLength).set(headerBytes);
  new Uint8Array(output, 4 + headerBytes.byteLength).set(
    new Uint8Array(payload.values.buffer, payload.values.byteOffset, payload.values.byteLength),
  );
  return output;
}

export function decodeDenseCurvePayload(input: ArrayBuffer): DenseCurvePayload {
  const view = new DataView(input);
  const headerLength = view.getUint32(0, true);
  const headerStart = 4;
  const headerEnd = headerStart + headerLength;

  if (headerEnd > input.byteLength) {
    throw new Error('Dense curve payload header exceeds buffer length.');
  }

  const header = JSON.parse(
    textDecoder.decode(new Uint8Array(input, headerStart, headerLength)),
  ) as DenseCurvePayloadHeader;
  assertHeader(header);

  const valuesByteLength = input.byteLength - headerEnd;
  if (valuesByteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
    throw new Error('Dense curve values must be Float32 aligned.');
  }

  const valuesBytes = new Uint8Array(input, headerEnd, valuesByteLength);
  const valuesBuffer = new ArrayBuffer(valuesByteLength);
  new Uint8Array(valuesBuffer).set(valuesBytes);
  const values = new Float32Array(valuesBuffer);

  if (values.length !== header.pointCount) {
    throw new Error('Dense curve payload pointCount does not match decoded values.');
  }

  return { header, values };
}
