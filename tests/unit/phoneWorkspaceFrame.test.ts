import { beforeEach, describe, expect, it } from 'vitest';
import {
  defaultPhoneWorkspaceSidesOpen, isPhoneWorkspaceSideCollapsed, readPhoneWorkspaceSideChoice, setPhoneWorkspaceSideCollapsed,
} from '../../src/components/mobileSkin/workspace/phoneWorkspaceCatalog';

beforeEach(() => window.localStorage.clear());

describe('phone workspace side panels', () => {
  it('open on their own only in landscape with room for the editor', () => {
    expect(defaultPhoneWorkspaceSidesOpen(915, 412, 2)).toBe(true); // Pixel 7 landscape
    expect(defaultPhoneWorkspaceSidesOpen(844, 390, 2)).toBe(true); // iPhone landscape
    expect(defaultPhoneWorkspaceSidesOpen(412, 915, 2)).toBe(false); // portrait
    expect(defaultPhoneWorkspaceSidesOpen(640, 360, 2)).toBe(false); // small landscape: editor would be < 320 px
    expect(defaultPhoneWorkspaceSidesOpen(640, 360, 1)).toBe(true);
    expect(defaultPhoneWorkspaceSidesOpen(915, 412, 0)).toBe(false);
  });

  it('remember the choice per editor and side, and report none before a toggle', () => {
    expect(readPhoneWorkspaceSideChoice('nodes', 'left')).toBeUndefined();
    setPhoneWorkspaceSideCollapsed('nodes', 'left', true);
    setPhoneWorkspaceSideCollapsed('nodes', 'right', false);
    expect(readPhoneWorkspaceSideChoice('nodes', 'left')).toBe(true);
    expect(readPhoneWorkspaceSideChoice('nodes', 'right')).toBe(false);
    expect(isPhoneWorkspaceSideCollapsed('nodes', 'left')).toBe(true);
    expect(readPhoneWorkspaceSideChoice('mixer', 'left')).toBeUndefined();
  });

  it('survive broken storage content', () => {
    window.localStorage.setItem('ms.phoneWorkspace.collapsed', '{not json');
    expect(readPhoneWorkspaceSideChoice('nodes', 'left')).toBeUndefined();
  });
});
