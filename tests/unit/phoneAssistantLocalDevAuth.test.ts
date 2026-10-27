import { describe, expect, it } from 'vitest';

import { isLocalDevAuthHost } from '../../src/components/common/localDevAuth';

describe('Dev Quick Login host rule', () => {
  it('offers it on the main dev server and on any localhost port of a development build', () => {
    expect(isLocalDevAuthHost('localhost', '5173', false)).toBe(true);
    expect(isLocalDevAuthHost('127.0.0.1', '5182', true)).toBe(true);
    expect(isLocalDevAuthHost('localhost', '5174', true)).toBe(true);
  });

  it('never offers it on other hosts or on other ports of a production build', () => {
    expect(isLocalDevAuthHost('127.0.0.1', '5182', false)).toBe(false);
    expect(isLocalDevAuthHost('www.masterselects.com', '5173', true)).toBe(false);
    expect(isLocalDevAuthHost('192.168.1.20', '5173', true)).toBe(false);
  });
});
