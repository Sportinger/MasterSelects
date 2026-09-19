import { describe, expect, it } from 'vitest';

import { decodeAmf0Values, encodeAmf0Values } from '../../functions/lib/rtmp/amf0';

describe('cloud RTMP AMF0 codec', () => {
  it('round-trips the connect command and typed object fields', () => {
    const values = [
      'connect',
      1,
      {
        app: 'live',
        flashVer: 'FMLE/3.0',
        fpad: false,
        objectEncoding: 0,
        tcUrl: 'rtmp://example.com:1935/live',
      },
    ] as const;

    expect(decodeAmf0Values(encodeAmf0Values([...values]))).toEqual(values);
  });

  it('decodes result arrays including null and undefined values', () => {
    const encoded = encodeAmf0Values(['_result', 2, null, 7, [true, undefined, 'ok']]);
    expect(decodeAmf0Values(encoded)).toEqual(['_result', 2, null, 7, [true, undefined, 'ok']]);
  });

  it('rejects truncated values instead of reading beyond the message', () => {
    expect(() => decodeAmf0Values(Uint8Array.of(2, 0, 4, 0x61))).toThrow('Truncated AMF0 value');
  });
});
