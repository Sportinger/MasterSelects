import { describe, expect, it } from 'vitest';

import {
  buildSetChunkSizeMessage,
  encodeRtmpMessage,
  RtmpChunkDecoder,
} from '../../functions/lib/rtmp/chunkStream';

describe('cloud RTMP chunk streams', () => {
  it('uses fmt0 followed by fmt3 continuations and reassembles the payload', () => {
    const payload = Uint8Array.from({ length: 300 }, (_, index) => index & 0xff);
    const encoded = encodeRtmpMessage({
      chunkStreamId: 6,
      messageStreamId: 3,
      payload,
      timestamp: 42,
      typeId: 9,
    }, 128);

    expect(encoded[0]).toBe(6);
    expect(encoded[12 + 128]).toBe(0xc6);
    const decoded = new RtmpChunkDecoder(128).push(encoded);
    expect(decoded).toEqual([{
      chunkStreamId: 6,
      messageStreamId: 3,
      payload,
      timestamp: 42,
      typeId: 9,
    }]);
  });

  it('writes and reads extended timestamps on every chunk', () => {
    const payload = new Uint8Array(140).fill(9);
    const timestamp = 0x01ff_ffff;
    const encoded = encodeRtmpMessage({
      chunkStreamId: 4,
      messageStreamId: 1,
      payload,
      timestamp,
      typeId: 8,
    }, 128);

    expect(Array.from(encoded.slice(1, 4))).toEqual([0xff, 0xff, 0xff]);
    expect(encoded[16 + 128]).toBe(0xc4);
    expect(new DataView(encoded.buffer, encoded.byteOffset + 17 + 128, 4).getUint32(0, false)).toBe(timestamp);
    expect(new RtmpChunkDecoder(128).push(encoded)[0]?.timestamp).toBe(timestamp);
  });

  it('lets the caller apply SetChunkSize before draining following bytes', () => {
    const setChunkSize = buildSetChunkSizeMessage(4_096);
    const payload = new Uint8Array(1_000).fill(3);
    const media = encodeRtmpMessage({
      chunkStreamId: 6,
      messageStreamId: 1,
      payload,
      timestamp: 0,
      typeId: 9,
    }, 4_096);
    const combined = new Uint8Array(setChunkSize.byteLength + media.byteLength);
    combined.set(setChunkSize);
    combined.set(media, setChunkSize.byteLength);

    const decoder = new RtmpChunkDecoder();
    const first = decoder.push(combined, 1);
    expect(first[0]?.typeId).toBe(1);
    decoder.setChunkSize(4_096);
    expect(decoder.push(new Uint8Array(0), 1)[0]?.payload).toEqual(payload);
  });
});
