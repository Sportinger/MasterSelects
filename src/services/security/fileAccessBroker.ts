// File Access Broker
// Restricts file access to explicit allowed roots
// Browser-safe: does not use Node.js path module
declare const __DEV_ALLOWED_FILE_ROOTS__: string[] | undefined;

const allowedRoots: string[] = [];

/**
 * Add an allowed root directory.
 * Paths are normalized to forward slashes for cross-platform consistency.
 */
export function addAllowedRoot(root: string): void {
  const normalized = normalizePath(root);
  if (!allowedRoots.includes(normalized)) {
    allowedRoots.push(normalized);
  }
}

/**
 * Clear all allowed roots (useful for testing).
 */
export function clearAllowedRoots(): void {
  allowedRoots.length = 0;
}

/**
 * Get current allowed roots (for debugging).
 */
export function getAllowedRoots(): readonly string[] {
  return allowedRoots;
}

/**
 * Normalize a file path: convert backslashes, remove trailing slashes,
 * collapse multiple slashes.
 */
function normalizePath(filePath: string): string {
  let normalized = filePath.replace(/\\/g, '/');
  // Collapse multiple slashes (but preserve drive letter like C:/)
  normalized = normalized.replace(/\/{2,}/g, '/');
  // Remove trailing slash unless it's the root
  if (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

function seedInitialRoots(): void {
  const initialRoots = typeof __DEV_ALLOWED_FILE_ROOTS__ !== 'undefined' && Array.isArray(__DEV_ALLOWED_FILE_ROOTS__)
    ? __DEV_ALLOWED_FILE_ROOTS__
    : [];

  for (const root of initialRoots) {
    const normalized = normalizePath(root);
    if (normalized && !allowedRoots.includes(normalized)) {
      allowedRoots.push(normalized);
    }
  }
}

/**
 * Check if a path contains traversal sequences.
 */
function hasTraversal(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  const segments = normalized.split('/');
  return segments.some(seg => seg === '..');
}

/**
 * Check if a file path is allowed under the current roots.
 */
export function isPathAllowed(filePath: string): boolean {
  if (!filePath || filePath.trim() === '') {
    return false;
  }

  if (hasTraversal(filePath)) {
    return false;
  }

  const trimmed = filePath.trim();
  const isAbsolute = trimmed.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(trimmed);
  if (!isAbsolute) {
    return false;
  }

  if (allowedRoots.length === 0) {
    return false;
  }

  const normalized = normalizePath(filePath);

  return allowedRoots.some(root => {
    return normalized === root || normalized.startsWith(root + '/');
  });
}

/**
 * Validate a file path and return details.
 */
export function validateFilePath(filePath: string): { allowed: boolean; resolved: string; reason?: string } {
  if (!filePath || filePath.trim() === '') {
    return { allowed: false, resolved: '', reason: 'Empty path' };
  }

  if (hasTraversal(filePath)) {
    return { allowed: false, resolved: '', reason: 'Path traversal detected' };
  }

  const trimmed = filePath.trim();
  const isAbsolute = trimmed.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(trimmed);
  if (!isAbsolute) {
    return { allowed: false, resolved: '', reason: 'Path must be absolute' };
  }

  const resolved = normalizePath(filePath);

  if (allowedRoots.length === 0) {
    return { allowed: false, resolved, reason: 'No allowed roots configured' };
  }

  const isUnderRoot = allowedRoots.some(root =>
    resolved === root || resolved.startsWith(root + '/')
  );

  if (!isUnderRoot) {
    return { allowed: false, resolved, reason: 'Path is outside allowed roots' };
  }

  return { allowed: true, resolved };
}

seedInitialRoots();
