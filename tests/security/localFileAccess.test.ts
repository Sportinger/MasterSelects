import { describe, it, expect, beforeEach } from 'vitest';
import {
  isPathAllowed,
  validateFilePath,
  addAllowedRoot,
  clearAllowedRoots,
} from '../../src/services/security/fileAccessBroker';

describe('File Access Broker', () => {
  beforeEach(() => {
    clearAllowedRoots();
  });

  describe('isPathAllowed', () => {
    it('denies all paths when no roots are configured', () => {
      expect(isPathAllowed('/some/path')).toBe(false);
    });

    it('allows paths under configured roots', () => {
      addAllowedRoot('/project/root');
      expect(isPathAllowed('/project/root/file.mp4')).toBe(true);
    });

    it('allows the root directory itself', () => {
      addAllowedRoot('/project/root');
      expect(isPathAllowed('/project/root')).toBe(true);
    });

    it('allows paths in subdirectories', () => {
      addAllowedRoot('/project/root');
      expect(isPathAllowed('/project/root/sub/dir/file.mp4')).toBe(true);
    });

    it('rejects paths outside configured roots', () => {
      addAllowedRoot('/project/root');
      expect(isPathAllowed('/other/path/file.mp4')).toBe(false);
    });

    it('rejects traversal attempts', () => {
      addAllowedRoot('/project/root');
      expect(isPathAllowed('/project/root/../../../etc/passwd')).toBe(false);
    });

    it('rejects relative paths', () => {
      addAllowedRoot('/project/root');
      expect(isPathAllowed('relative/path/file.mp4')).toBe(false);
    });

    it('rejects empty paths', () => {
      addAllowedRoot('/project/root');
      expect(isPathAllowed('')).toBe(false);
    });

    it('handles Windows-style paths', () => {
      addAllowedRoot('C:/Users/test/project');
      expect(isPathAllowed('C:\\Users\\test\\project\\file.mp4')).toBe(true);
    });

    it('handles Windows-style traversal', () => {
      addAllowedRoot('C:/Users/test/project');
      expect(isPathAllowed('C:\\Users\\test\\project\\..\\..\\secret')).toBe(false);
    });

    it('supports multiple allowed roots', () => {
      addAllowedRoot('/project/root');
      addAllowedRoot('/tmp/downloads');
      expect(isPathAllowed('/project/root/file.mp4')).toBe(true);
      expect(isPathAllowed('/tmp/downloads/video.mp4')).toBe(true);
      expect(isPathAllowed('/home/user/secrets')).toBe(false);
    });
  });

  describe('validateFilePath', () => {
    it('returns not allowed for empty path', () => {
      const result = validateFilePath('');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Empty path');
    });

    it('returns not allowed for traversal', () => {
      addAllowedRoot('/project');
      const result = validateFilePath('/project/../../../etc/passwd');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Path traversal detected');
    });

    it('returns not allowed for relative path', () => {
      addAllowedRoot('/project');
      const result = validateFilePath('relative/path');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Path must be absolute');
    });

    it('returns not allowed when no roots configured', () => {
      const result = validateFilePath('/some/path');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('No allowed roots configured');
    });

    it('returns not allowed for path outside roots', () => {
      addAllowedRoot('/project');
      const result = validateFilePath('/other/path');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Path is outside allowed roots');
    });

    it('returns allowed with resolved path for valid path', () => {
      addAllowedRoot('/project');
      const result = validateFilePath('/project/file.mp4');
      expect(result.allowed).toBe(true);
      expect(result.resolved).toBeTruthy();
    });

    it('directory listing uses same restrictions as file reads', () => {
      addAllowedRoot('/project');
      // Both file and directory paths go through the same validation
      expect(validateFilePath('/project/subdir').allowed).toBe(true);
      expect(validateFilePath('/other/subdir').allowed).toBe(false);
    });
  });
});
