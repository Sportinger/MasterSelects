import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript',
  '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.gz': 'application/gzip',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.woff': 'font/woff', '.ttf': 'font/ttf', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.txt': 'text/plain', '.xml': 'application/xml', '.pdf': 'application/pdf',
};

export async function prepareEditor(root) {
  const dist = path.join(root, 'dist');
  // The build must include the local FFmpeg tier, not only the initial HTML.
  for (const file of ['index.html', 'ffmpeg/ffmpeg-core.js', 'ffmpeg/ffmpeg-core.wasm.gz']) await stat(path.join(dist, file));
  const target = path.resolve(root, 'android/app/src/main/assets/editor');
  const allowedParent = path.resolve(root, 'android/app/src/main/assets');
  if (path.dirname(target) !== allowedParent || path.basename(target) !== 'editor') throw new Error('Unsafe asset output path');
  // This is the generated, gitignored bundle only. Never touch source assets or user projects.
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  const files = {};
  let bytes = 0;
  async function copyDirectory(relative = '') {
    for (const entry of await readdir(path.join(dist, relative), { withFileTypes: true })) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error(`Refusing symbolic link in editor bundle: ${name}`);
      // Documentation stays available online. Dev fixtures and server routing files are not app assets.
      if (!relative && ['docs', 'downloads', '_headers', '_redirects', '.well-known', 'test_prores.mov', 'test-videos'].includes(entry.name)) continue;
      if (entry.isDirectory()) { await copyDirectory(name); continue; }
      if (!entry.isFile() || /(?:\.map|\.env|\.pem|\.key)$/i.test(entry.name)) continue;
      const source = path.join(dist, name);
      const data = await readFile(source);
      // AAPT expands .gz assets and drops the suffix. Keep the HTTP URL intact
      // while storing its compressed bytes under a name AAPT leaves alone.
      const asset = name.endsWith('.gz') ? `${name}.bin` : name;
      files[name] = { asset, size: data.length, mime: MIME[path.extname(name).toLowerCase()] || 'application/octet-stream',
        sha256: createHash('sha256').update(data).digest('hex') };
      bytes += data.length;
      await mkdir(path.dirname(path.join(target, asset)), { recursive: true });
      await cp(source, path.join(target, asset));
    }
  }
  await copyDirectory();
  await writeFile(path.join(allowedParent, 'editor-files.json'), JSON.stringify(files));
  console.log(`Bundled ${Object.keys(files).length} editor assets (${(bytes / 1024 / 1024).toFixed(1)} MiB), including FFmpeg.`);
}
