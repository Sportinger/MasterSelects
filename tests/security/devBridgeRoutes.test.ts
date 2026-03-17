import { describe, it, expect } from 'vitest';
import { isLocalhostOrigin } from '../../src/services/security/devBridgeAuth';

describe('Dev Bridge Auth - isLocalhostOrigin', () => {
  it('accepts http://localhost', () => {
    expect(isLocalhostOrigin('http://localhost')).toBe(true);
  });

  it('accepts http://localhost:5173', () => {
    expect(isLocalhostOrigin('http://localhost:5173')).toBe(true);
  });

  it('accepts http://127.0.0.1', () => {
    expect(isLocalhostOrigin('http://127.0.0.1')).toBe(true);
  });

  it('accepts http://127.0.0.1:5173', () => {
    expect(isLocalhostOrigin('http://127.0.0.1:5173')).toBe(true);
  });

  it('accepts https://localhost', () => {
    expect(isLocalhostOrigin('https://localhost')).toBe(true);
  });

  it('rejects external origins', () => {
    expect(isLocalhostOrigin('https://evil.com')).toBe(false);
  });

  it('rejects origin with localhost as subdomain', () => {
    expect(isLocalhostOrigin('http://localhost.evil.com')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isLocalhostOrigin('')).toBe(false);
  });

  it('rejects malformed origin', () => {
    expect(isLocalhostOrigin('not-a-url')).toBe(false);
  });

  it('rejects origin with different hostname', () => {
    expect(isLocalhostOrigin('http://192.168.1.1:5173')).toBe(false);
  });
});
