export function buildFlvVideoBody(
  payload: Uint8Array,
  keyframe: boolean,
  sequenceHeader: boolean,
): Uint8Array {
  const body = new Uint8Array(payload.byteLength + 5);
  body[0] = keyframe ? 0x17 : 0x27;
  body[1] = sequenceHeader ? 0 : 1;
  body.set(payload, 5);
  return body;
}

export function buildFlvAudioBody(payload: Uint8Array, sequenceHeader: boolean): Uint8Array {
  const body = new Uint8Array(payload.byteLength + 2);
  body[0] = 0xaf;
  body[1] = sequenceHeader ? 0 : 1;
  body.set(payload, 2);
  return body;
}
