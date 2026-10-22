// Checks on a running Vite the docs media runner reuses (node scripts/docs-media.mjs --url).
import fs from 'node:fs';
import path from 'node:path';

/**
 * The effect code files a running Vite serves in an older version than the disk holds. Vite answers a module
 * from its cache until its watcher reports an edit; a script carries its source in the inline source map, a
 * shader imported ?raw its text. A module Vite has not loaded yet comes fresh from disk.
 */
export async function oldModules(url, root, files) {
  const differs = async (file) => {
    const disk = fs.readFileSync(path.join(root, file), 'utf8');
    try {
      if (/\.(wgsl|glsl)$/u.test(file)) {
        const text = await (await fetch(`${url}/${file}?import&raw`)).text();
        const literal = text.match(/^export default (".*")\s*;?\s*$/su)?.[1];
        return literal !== undefined && JSON.parse(literal) !== disk;
      }
      const text = await (await fetch(`${url}/${file}`)).text();
      const map = text.match(/sourceMappingURL=data:application\/json;(?:charset=utf-8;)?base64,([A-Za-z0-9+/=]+)/u)?.[1];
      const source = map ? JSON.parse(Buffer.from(map, 'base64').toString('utf8')).sourcesContent?.[0] : undefined;
      return source !== undefined && source !== disk;
    } catch {
      return false;
    }
  };
  const old = [];
  for (let at = 0; at < files.length; at += 8) {
    const batch = files.slice(at, at + 8);
    (await Promise.all(batch.map(differs))).forEach((stale, index) => { if (stale) old.push(batch[index]); });
  }
  return old;
}
