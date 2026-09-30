import { describe, expect, it } from 'vitest';
import {
  displayWorkspacePath,
  matchWorkspaceRoot,
  normalizeWorkspacePath,
} from '../../src/services/workspaceRoots';

describe('workspace root paths', () => {
  it('normalizes Windows and POSIX absolute paths', () => {
    expect(normalizeWorkspacePath('d:\\Shows\\Ute\\')).toBe('D:/Shows/Ute');
    expect(normalizeWorkspacePath('D:/')).toBe('D:');
    expect(normalizeWorkspacePath('D:')).toBe('D:');
    expect(normalizeWorkspacePath('/home//me/')).toBe('/home/me');
    expect(normalizeWorkspacePath('/')).toBe('/');
  });

  it('rejects relative paths and dot segments', () => {
    for (const value of ['Shows/Ute', 'D:/Shows/../secret', 'D:/./x', '', 'C:relative']) {
      expect(normalizeWorkspacePath(value)).toBeNull();
    }
  });

  it('picks the longest matching root and returns relative segments', () => {
    const roots = ['D:', 'D:/Shows', '/home/me'];
    expect(matchWorkspaceRoot('D:/Shows/Ute/a.mp4', roots)).toEqual({ root: 'D:/Shows', segments: ['Ute', 'a.mp4'] });
    expect(matchWorkspaceRoot('D:/Other/b.wav', roots)).toEqual({ root: 'D:', segments: ['Other', 'b.wav'] });
    expect(matchWorkspaceRoot('D:', roots)).toEqual({ root: 'D:', segments: [] });
    expect(matchWorkspaceRoot('/home/me/x', roots)).toEqual({ root: '/home/me', segments: ['x'] });
  });

  it('matches Windows paths case-insensitively but never sibling prefixes', () => {
    expect(matchWorkspaceRoot('d:/shows/Ute', ['D:/Shows'])).toEqual({ root: 'D:/Shows', segments: ['Ute'] });
    expect(matchWorkspaceRoot('D:/ShowsExtra/x', ['D:/Shows'])).toBeNull();
    expect(matchWorkspaceRoot('/home/Me/x', ['/home/me'])).toBeNull();
    expect(matchWorkspaceRoot('E:/x', ['D:'])).toBeNull();
  });

  it('displays drive roots with a trailing slash', () => {
    expect(displayWorkspacePath('D:')).toBe('D:/');
    expect(displayWorkspacePath('D:/Shows')).toBe('D:/Shows');
  });
});
