import { describe, expect, it } from 'vitest';

import {
  isAllowedRelayOrigin,
  isBlockedHostname,
  parseRtmpTarget,
  redactSecret,
} from '../../functions/lib/rtmp/guards';

describe('cloud RTMP security guards', () => {
  it('requires an exact production origin and gates localhost on development', () => {
    const production = {
      ENVIRONMENT: 'production',
      MASTERSELECTS_PUBLIC_URL: 'https://studio.example.com/path',
    };
    expect(isAllowedRelayOrigin(null, production)).toBe(false);
    expect(isAllowedRelayOrigin('https://masterselects.com', production)).toBe(true);
    expect(isAllowedRelayOrigin('https://studio.example.com', production)).toBe(true);
    expect(isAllowedRelayOrigin('https://masterselects.com/', production)).toBe(false);
    expect(isAllowedRelayOrigin('http://localhost:5173', production)).toBe(false);
    expect(isAllowedRelayOrigin('http://localhost:5173', { ...production, ENVIRONMENT: 'development' })).toBe(true);
  });

  it.each([
    'localhost',
    'camera.local',
    'service.internal',
    'name.localhost',
    '127.0.0.1',
    '127.1',
    '0x7f000001',
    '10.2.3.4',
    '172.31.9.8',
    '192.168.1.2',
    '169.254.4.5',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    'fe80::1',
    'fd00::1',
    '::ffff:127.0.0.1',
  ])('blocks private or local target %s', (hostname) => {
    expect(isBlockedHostname(hostname)).toBe(true);
  });

  it('accepts only the scheme-specific ingest port and a bounded app/key', () => {
    expect(parseRtmpTarget('rtmp://ingest.example.com/live/ignored', 'key')).toEqual({
      app: 'live',
      connectHost: 'ingest.example.com',
      displayHost: 'ingest.example.com',
      port: 1935,
      secure: false,
      tcUrl: 'rtmp://ingest.example.com:1935/live',
    });
    expect(parseRtmpTarget('rtmps://ingest.example.com/live', 'key').port).toBe(443);
    expect(() => parseRtmpTarget('rtmp://ingest.example.com:443/live', 'key')).toThrow('port 1935');
    expect(() => parseRtmpTarget('rtmps://ingest.example.com:1935/live', 'key')).toThrow('port 443');
    expect(() => parseRtmpTarget('rtmp://127.0.0.1/live', 'key')).toThrow('not allowed');
    expect(() => parseRtmpTarget('rtmp://user:pass@ingest.example.com/live', 'key')).toThrow('credentials');
    expect(() => parseRtmpTarget('rtmp://ingest.example.com', 'key')).toThrow('application path');
    expect(() => parseRtmpTarget('rtmp://ingest.example.com/live', 'x'.repeat(257))).toThrow('too long');
  });

  it('redacts every occurrence of the in-memory publish secret', () => {
    expect(redactSecret('publish abc failed for abc', 'abc')).toBe(
      'publish [REDACTED] failed for [REDACTED]',
    );
  });
});
