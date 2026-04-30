import { PROJECT_FOLDERS } from './constants';

export interface RawTargetPath {
  folderPath: string;
  fileName: string;
  relativePath: string;
}

function sanitizePathPart(part: string, fallback: string): string {
  const sanitized = Array.from(part)
    .map((char) => (char.charCodeAt(0) < 32 || '<>:"|?*'.includes(char) ? '_' : char))
    .join('')
    .trim();

  if (!sanitized || sanitized === '.' || sanitized === '..') {
    return fallback;
  }

  return sanitized;
}

function splitRawPath(path: string, fallbackFileName: string): string[] {
  const normalized = path
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
  const withoutRawPrefix = normalized.toLowerCase().startsWith(`${PROJECT_FOLDERS.RAW.toLowerCase()}/`)
    ? normalized.slice(PROJECT_FOLDERS.RAW.length + 1)
    : normalized;
  const parts = withoutRawPrefix.split('/').filter(Boolean);

  if (parts.length === 0) {
    parts.push(fallbackFileName);
  }

  return parts.map((part, index) => {
    const isLast = index === parts.length - 1;
    return sanitizePathPart(part, isLast ? fallbackFileName : `folder-${index + 1}`);
  });
}

export function getRawRelativePath(folderPath: string, fileName: string): string {
  return [PROJECT_FOLDERS.RAW, folderPath, fileName]
    .filter(Boolean)
    .join('/');
}

export function buildRawTargetPath(fileName: string | undefined, fallbackFileName: string): RawTargetPath {
  const parts = splitRawPath(fileName || fallbackFileName, fallbackFileName);
  const targetFileName = parts[parts.length - 1] || fallbackFileName;
  const folderPath = parts.slice(0, -1).join('/');

  return {
    folderPath,
    fileName: targetFileName,
    relativePath: getRawRelativePath(folderPath, targetFileName),
  };
}

export function parseRawRelativePath(relativePath: string): RawTargetPath | null {
  const normalized = relativePath
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/');
  const parts = normalized.split('/').filter(Boolean);

  if (parts[0]?.toLowerCase() !== PROJECT_FOLDERS.RAW.toLowerCase() || parts.length < 2) {
    return null;
  }

  const rawParts = parts.slice(1);
  if (rawParts.some((part) => part === '.' || part === '..')) {
    return null;
  }

  const fileName = rawParts[rawParts.length - 1] || '';
  if (!fileName) {
    return null;
  }

  const folderPath = rawParts.slice(0, -1).join('/');
  return {
    folderPath,
    fileName,
    relativePath: getRawRelativePath(folderPath, fileName),
  };
}

export function addFileNameSuffix(fileName: string, counter: number): string {
  const extIndex = fileName.lastIndexOf('.');
  return extIndex > 0
    ? `${fileName.slice(0, extIndex)}_${counter}${fileName.slice(extIndex)}`
    : `${fileName}_${counter}`;
}
