import type { RtmpTarget } from './types';

const LOCAL_DEVELOPMENT_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:8788',
  'http://127.0.0.1:8788',
] as const;
const PRODUCTION_ORIGINS = [
  'https://masterselects.com',
  'https://www.masterselects.com',
] as const;
const MAX_APP_LENGTH = 256;
const MAX_STREAM_KEY_LENGTH = 256;

export interface OriginEnvironment {
  ENVIRONMENT?: string;
  MASTERSELECTS_PUBLIC_URL?: string;
}

export function isAllowedRelayOrigin(origin: string | null, env: OriginEnvironment): boolean {
  if (!origin) return false;

  const allowed = new Set<string>(PRODUCTION_ORIGINS);
  if (env.MASTERSELECTS_PUBLIC_URL) {
    try {
      allowed.add(new URL(env.MASTERSELECTS_PUBLIC_URL).origin);
    } catch {
      // A malformed deployment variable must not broaden the allowlist.
    }
  }
  if ((env.ENVIRONMENT ?? '').toLowerCase() === 'development') {
    for (const localOrigin of LOCAL_DEVELOPMENT_ORIGINS) allowed.add(localOrigin);
  }
  return allowed.has(origin);
}

export function parseRtmpTarget(rawUrl: unknown, streamKey: unknown): RtmpTarget {
  if (typeof rawUrl !== 'string' || rawUrl.length === 0 || rawUrl.length > 2_048) {
    throw new Error('Invalid RTMP target URL');
  }
  if (typeof streamKey !== 'string' || streamKey.length === 0) {
    throw new Error('RTMP stream key must not be empty');
  }
  if (streamKey.length > MAX_STREAM_KEY_LENGTH) {
    throw new Error('RTMP stream key is too long');
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Invalid RTMP target URL');
  }

  const secure = parsed.protocol === 'rtmps:';
  if (parsed.protocol !== 'rtmp:' && !secure) {
    throw new Error('RTMP target URL must use the rtmp or rtmps scheme');
  }
  if (parsed.username || parsed.password) {
    throw new Error('RTMP target URL must not contain credentials');
  }

  const expectedPort = secure ? 443 : 1935;
  const port = parsed.port ? Number(parsed.port) : expectedPort;
  if (port !== expectedPort) {
    throw new Error(`RTMP target URL must use port ${expectedPort}`);
  }

  const hostname = stripIpv6Brackets(parsed.hostname).replace(/\.$/, '').toLowerCase();
  if (!hostname) throw new Error('RTMP target URL must contain a host');
  if (isBlockedHostname(hostname)) {
    throw new Error('RTMP target host is not allowed');
  }

  const app = parsed.pathname.split('/').find((segment) => segment.length > 0);
  if (!app) throw new Error('RTMP target URL must contain an application path');
  if (app.length > MAX_APP_LENGTH) throw new Error('RTMP application path is too long');

  const displayHost = hostname.includes(':') ? `[${hostname}]` : hostname;
  return {
    app,
    connectHost: hostname,
    displayHost,
    port,
    secure,
    tcUrl: `${secure ? 'rtmps' : 'rtmp'}://${displayHost}:${port}/${app}`,
  };
}

export function redactSecret(message: string, secret: string): string {
  return secret ? message.split(secret).join('[REDACTED]') : message;
}

export function isBlockedHostname(rawHostname: string): boolean {
  const hostname = stripIpv6Brackets(rawHostname).replace(/\.$/, '').toLowerCase();
  if (
    hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname.endsWith('.local')
    || hostname.endsWith('.internal')
  ) {
    return true;
  }

  const ipv4 = parseIpv4Literal(hostname);
  if (ipv4) return isBlockedIpv4(ipv4);

  const ipv6 = parseIpv6Literal(hostname);
  if (!ipv6) return false;
  if (ipv6.every((word, index) => word === (index === 7 ? 1 : 0))) return true;
  if ((ipv6[0]! & 0xffc0) === 0xfe80) return true;
  if ((ipv6[0]! & 0xfe00) === 0xfc00) return true;

  const mappedIpv4 = ipv6.slice(0, 5).every((word) => word === 0) && ipv6[5] === 0xffff
    ? [ipv6[6]! >>> 8, ipv6[6]! & 0xff, ipv6[7]! >>> 8, ipv6[7]! & 0xff]
    : null;
  return mappedIpv4 ? isBlockedIpv4(mappedIpv4) : false;
}

function stripIpv6Brackets(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
}

function parseIpv4Literal(hostname: string): number[] | null {
  const parts = hostname.split('.');
  if (parts.length > 4 || parts.some((part) => !/^(?:0x[0-9a-f]+|[0-9]+)$/i.test(part))) {
    return null;
  }
  const values = parts.map(parseIpv4Part);
  if (values.some((value) => value === null)) return null;
  const nums = values as number[];

  let packed: number;
  if (nums.length === 1 && nums[0]! <= 0xffff_ffff) {
    packed = nums[0]!;
  } else if (nums.length === 2 && nums[0]! <= 0xff && nums[1]! <= 0xff_ffff) {
    packed = nums[0]! * 0x1_000_000 + nums[1]!;
  } else if (
    nums.length === 3 && nums[0]! <= 0xff && nums[1]! <= 0xff && nums[2]! <= 0xffff
  ) {
    packed = nums[0]! * 0x1_000_000 + nums[1]! * 0x1_0000 + nums[2]!;
  } else if (nums.length === 4 && nums.every((value) => value <= 0xff)) {
    return nums;
  } else {
    return null;
  }
  return [
    Math.floor(packed / 0x1_000_000) & 0xff,
    Math.floor(packed / 0x1_0000) & 0xff,
    Math.floor(packed / 0x100) & 0xff,
    packed & 0xff,
  ];
}

function parseIpv4Part(part: string): number | null {
  const radix = /^0x/i.test(part) ? 16 : part.length > 1 && part.startsWith('0') ? 8 : 10;
  const value = Number.parseInt(part.replace(/^0x/i, ''), radix);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function isBlockedIpv4([a, b, c, d]: number[]): boolean {
  return a === 127
    || a === 10
    || (a === 172 && b! >= 16 && b! <= 31)
    || (a === 192 && b === 168)
    || (a === 169 && b === 254)
    || (a === 100 && b! >= 64 && b! <= 127)
    || (a === 0 && b === 0 && c === 0 && d === 0);
}

function parseIpv6Literal(hostname: string): number[] | null {
  if (!hostname.includes(':')) return null;
  let normalized = hostname;
  const lastColon = normalized.lastIndexOf(':');
  const tail = normalized.slice(lastColon + 1);
  if (tail.includes('.')) {
    const ipv4 = parseIpv4Literal(tail);
    if (!ipv4 || ipv4.length !== 4) return null;
    normalized = `${normalized.slice(0, lastColon)}:${((ipv4[0]! << 8) | ipv4[1]!).toString(16)}:${((ipv4[2]! << 8) | ipv4[3]!).toString(16)}`;
  }

  const halves = normalized.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  if (halves.length === 1 && left.length !== 8) return null;
  const missing = 8 - left.length - right.length;
  if (missing < (halves.length === 2 ? 1 : 0)) return null;
  const words = [...left, ...Array.from({ length: missing }, () => '0'), ...right];
  if (words.length !== 8 || words.some((word) => !/^[0-9a-f]{1,4}$/i.test(word))) return null;
  return words.map((word) => Number.parseInt(word, 16));
}
