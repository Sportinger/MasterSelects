// Checks on a running Vite the docs media runner reuses (node scripts/docs-media.mjs --url).
import fs from 'node:fs';
import path from 'node:path';

/** The source a Vite module answer carries: a shader imported ?raw as its string literal, a script in its inline source map. */
export function servedSource(file, text) {
  // Vite appends an inline source map to every module answer, the ?raw one of a shader included.
  const map = text.match(/\/\/# sourceMappingURL=data:application\/json;(?:charset=utf-8;)?base64,([A-Za-z0-9+/=]+)\s*$/u);
  const body = map ? text.slice(0, map.index) : text;
  if (/\.(wgsl|glsl)$/u.test(file)) {
    const literal = body.match(/^export default (".*")\s*;?\s*$/su)?.[1];
    if (literal !== undefined) return JSON.parse(literal);
  }
  return map ? JSON.parse(Buffer.from(map[1], 'base64').toString('utf8')).sourcesContent?.[0] : undefined;
}

/** Whether a script holds code that runs (not only types, interfaces and type imports). */
export const runsCode = (text) => /^\s*(?:export\s+(?:default\s+)?)?(?:async\s+)?(?:const|let|var|function|class|enum)\b|^\s*export\s*\{(?!\s*type\b)|^\s*import\s+(?!type\b)/mu.test(text);

/**
 * Compares the effect code files a running Vite serves with the disk. Vite answers a module from its cache
 * until its watcher reports an edit; a script carries its source in the inline source map, a shader imported
 * ?raw its text. A module Vite has not loaded yet comes fresh from disk.
 * Returns `old` (served in an older version than the disk holds) and `unchecked` (no answer, or an answer
 * without a readable source, each with the reason): the caller must not take those for current.
 */
export async function oldModules(url, root, files) {
  const check = async (file) => {
    const disk = fs.readFileSync(path.join(root, file), 'utf8');
    try {
      const response = await fetch(`${url}/${file}${/\.(wgsl|glsl)$/u.test(file) ? '?import&raw' : ''}`);
      if (!response.ok) return { file, unchecked: `HTTP ${response.status}` };
      const text = await response.text();
      // A file of types only compiles to an empty module without a map: current while the disk holds no code that runs either.
      if (!/\.(wgsl|glsl)$/u.test(file) && !text.trim()) return { file, old: runsCode(disk) };
      const source = servedSource(file, text);
      if (source === undefined) return { file, unchecked: 'no source in the answer' };
      return { file, old: source !== disk };
    } catch (error) {
      return { file, unchecked: error instanceof Error ? error.message : String(error) };
    }
  };
  const old = [];
  const unchecked = [];
  for (let at = 0; at < files.length; at += 8) {
    for (const result of await Promise.all(files.slice(at, at + 8).map(check))) {
      if (result.unchecked) unchecked.push(`${result.file} (${result.unchecked})`);
      else if (result.old) old.push(result.file);
    }
  }
  return { old, unchecked };
}
