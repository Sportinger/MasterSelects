import { describe, expect, it } from 'vitest';

import { buildFlvAudioBody, buildFlvVideoBody } from '../../functions/lib/rtmp/flv';
import { MediaQueue } from '../../functions/lib/rtmp/mediaQueue';
import {
  monotonicTimestamp,
  parseMediaFrame,
  TokenBucket,
} from '../../functions/lib/rtmp/relaySession';
import type { MediaFrame } from '../../functions/lib/rtmp/types';

describe('cloud RTMP relay core', () => {
  it('matches the helper FLV tag bodies byte-for-byte', () => {
    expect(buildFlvVideoBody(Uint8Array.of(1, 2, 3), true, true)).toEqual(
      Uint8Array.of(0x17, 0, 0, 0, 0, 1, 2, 3),
    );
    expect(buildFlvVideoBody(Uint8Array.of(4, 5), false, false)).toEqual(
      Uint8Array.of(0x27, 1, 0, 0, 0, 4, 5),
    );
    expect(buildFlvAudioBody(Uint8Array.of(0x12, 0x10), true)).toEqual(
      Uint8Array.of(0xaf, 0, 0x12, 0x10),
    );
  });

  it('parses the little-endian 12-byte browser frame header', () => {
    const bytes = new Uint8Array(15);
    bytes[0] = 3;
    bytes[1] = 1;
    new DataView(bytes.buffer).setBigUint64(4, 12_345_678n, true);
    bytes.set([7, 8, 9], 12);

    expect(parseMediaFrame(bytes)).toEqual({
      keyframe: true,
      kind: 3,
      payload: Uint8Array.of(7, 8, 9),
      timestampMs: 12_345,
    });
  });

  it('clamps regressions and accepts u32 timestamp wraparound', () => {
    expect(monotonicTimestamp(null, 10)).toBe(10);
    expect(monotonicTimestamp(10, 8)).toBe(11);
    expect(monotonicTimestamp(11, 11)).toBe(12);
    expect(monotonicTimestamp(0xffff_fffe, 1)).toBe(1);
  });

  it('drops full-queue delta video and forces recovery keyframes through', async () => {
    const queue = new MediaQueue(2);
    queue.enqueue(frame(1, false));
    queue.enqueue(frame(2, false));
    queue.enqueue(frame(3, false));
    expect(queue.droppedFrames).toBe(1);

    queue.enqueue(frame(4, true));
    const controller = new AbortController();
    expect((await queue.dequeue(controller.signal))?.timestampMs).toBe(4);
    queue.enqueue(frame(5, false));
    expect((await queue.dequeue(controller.signal))?.timestampMs).toBe(5);
    expect(queue.droppedFrames).toBe(3);
  });

  it('never drops audio and enforces a two-second token-bucket burst', () => {
    const queue = new MediaQueue(2);
    queue.enqueue(frame(1, false));
    queue.enqueue(frame(2, false));
    queue.enqueue({ ...frame(3, false), keyframe: false, kind: 4 });
    expect(queue.queuedMessages).toBe(2);
    expect(queue.droppedFrames).toBe(1);

    let now = 0;
    const bucket = new TokenBucket(10, 20, () => now);
    expect(bucket.consume(20)).toBe(true);
    expect(bucket.consume(1)).toBe(false);
    now = 100;
    expect(bucket.consume(1)).toBe(true);
  });

  it('also bounds zero-byte messages by the helper queue capacity', () => {
    const queue = new MediaQueue(100, 2);
    queue.enqueue({ ...frame(1, false), payload: new Uint8Array(0) });
    queue.enqueue({ ...frame(2, false), payload: new Uint8Array(0) });
    queue.enqueue({ ...frame(3, false), payload: new Uint8Array(0) });
    expect(queue.queuedMessages).toBe(2);
    expect(queue.droppedFrames).toBe(1);
  });
});

function frame(timestampMs: number, keyframe: boolean): MediaFrame {
  return {
    keyframe,
    kind: 3,
    payload: Uint8Array.of(1),
    timestampMs,
  };
}
