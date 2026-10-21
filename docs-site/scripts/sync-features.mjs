// Sync docs/Features/*.md into the Starlight content collection.
//
// docs/Features stays the single source of truth (edited alongside the
// code); this script converts each page for the docs site: adds the
// frontmatter Starlight requires, drops the repo-internal back-link,
// rewrites feature-to-feature links to site routes, points links that
// leave docs/Features at GitHub, and copies the shared assets folder.
//
// Usage: node scripts/sync-features.mjs [--build] [--source-ref <ref>]   (from docs-site/)
//   --build   always clear the Astro content cache (production builds)
//
// The site lives under the `/docs` base, so every generated route starts with /docs.
// Pictures become links to the full-size file, with width/height and lazy loading.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const featuresDir = path.join(repoRoot, 'docs', 'Features');
const outDir = path.join(here, '..', 'src', 'content', 'docs', 'features');
const overviewOut = path.join(here, '..', 'src', 'content', 'docs', 'getting-started', 'overview.md');
const assetsOut = path.join(here, '..', 'public', 'assets');
const astroCacheDir = path.join(here, '..', '.astro');
const featurePath = 'docs/Features';
const forBuild = process.argv.includes('--build');
const siteBase = '/docs';
const sourceRefFlag = process.argv.indexOf('--source-ref');
const sourceRef = sourceRefFlag >= 0 ? process.argv[sourceRefFlag + 1] : undefined;

if (sourceRefFlag >= 0 && !sourceRef) {
  throw new Error('--source-ref requires a Git ref, for example HEAD.');
}

function gitOutput(args, options = {}) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
}

function listGitFiles(ref) {
  return gitOutput(['ls-tree', '-r', '--name-only', ref, '--', featurePath], { encoding: 'utf8' })
    .split(/\r?\n/u)
    .filter(Boolean);
}

const gitFiles = sourceRef ? listGitFiles(sourceRef) : [];
const sourceFiles = sourceRef
  ? gitFiles
      .filter((name) => path.posix.dirname(name) === featurePath && name.endsWith('.md'))
      .map((name) => path.posix.basename(name))
  : fs.readdirSync(featuresDir).filter((name) => name.endsWith('.md'));
const slugByFile = new Map(sourceFiles.map((name) => [name, name.replace(/\.md$/, '').toLowerCase()]));

function readSourceFile(relativePath, encoding = 'utf8') {
  if (!sourceRef) return fs.readFileSync(path.join(featuresDir, relativePath), encoding);
  return gitOutput(['show', `${sourceRef}:${path.posix.join(featurePath, relativePath)}`], { encoding });
}

/** Pixel size of a PNG, JPEG or WebP file, or undefined. */
function imageSize(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const ascii = (offset, length) => String.fromCharCode(...u8.subarray(offset, offset + length));
  if (u8.length > 24 && ascii(1, 3) === 'PNG') return { width: view.getUint32(16), height: view.getUint32(20) };
  if (u8.length > 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    const chunk = ascii(12, 4);
    if (chunk === 'VP8X') return { width: 1 + (u8[24] | u8[25] << 8 | u8[26] << 16), height: 1 + (u8[27] | u8[28] << 8 | u8[29] << 16) };
    if (chunk === 'VP8 ') return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
    if (chunk === 'VP8L') { const bits = view.getUint32(21, true); return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) }; }
  }
  if (u8[0] === 0xff && u8[1] === 0xd8) {
    for (let offset = 2; offset + 9 < u8.length;) {
      if (u8[offset] !== 0xff) return undefined;
      const marker = u8[offset + 1], length = view.getUint16(offset + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
      offset += 2 + length;
    }
  }
  return undefined;
}

const escapeAttribute = (value) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function readAsset(relativePath) {
  try { return sourceRef ? gitOutput(['show', `${sourceRef}:${path.posix.join(featurePath, relativePath)}`]) : fs.readFileSync(path.join(featuresDir, relativePath)); }
  catch { return undefined; }
}

function convert(markdown, { title }) {
  let body = markdown;
  // Drop the repo-internal "[Back to Project](../../README.md)" back-link line.
  body = body.replace(/^\[Back to [^\]]+\]\([^)]*\)\s*\n+/i, '');
  // The first H1 becomes the frontmatter title.
  const h1 = body.match(/^#\s+(.+?)\s*$/m);
  const pageTitle = title ?? h1?.[1] ?? 'Untitled';
  if (h1) body = body.replace(h1[0], '').replace(/^\s*\n/, '');

  let images = 0;
  body = body.replace(/(!?)\[([^\]]+)\]\(([^)\s]+)\)/g, (full, imagePrefix, label, target) => {
    if (/^(https?:|mailto:|#)/.test(target)) return full;
    const [rawPath, anchor = ''] = target.split('#');
    const suffix = anchor ? `#${anchor}` : '';
    const clean = rawPath.replace(/^\.\//, '');
    // Feature-to-feature links become site routes.
    const fileName = path.posix.basename(clean);
    if (slugByFile.has(fileName) && !clean.includes('/')) {
      return `${imagePrefix}[${label}](${siteBase}/features/${slugByFile.get(fileName)}/${suffix})`;
    }
    if (fileName === 'README.md' && (clean === 'README.md' || clean === './README.md')) {
      return `${imagePrefix}[${label}](${siteBase}/getting-started/overview/${suffix})`;
    }
    // Shared images move into the site's public/ folder. A picture opens its full-size file
    // (graphs and fine detail stay readable on small screens) and loads lazily below the top.
    if (clean.startsWith('assets/')) {
      const url = `${siteBase}/${clean}${suffix}`;
      if (!imagePrefix) return `[${label}](${url})`;
      const size = imageSize(readAsset(clean) ?? new Uint8Array());
      const dimensions = size ? ` width="${size.width}" height="${size.height}"` : '';
      const loading = images++ ? ' loading="lazy"' : '';
      return `<a class="docs-shot-zoom" href="${url}" title="Open the full-size picture"><img src="${url}" alt="${escapeAttribute(label)}"${dimensions}${loading} decoding="async"></a>`;
    }
    // Repository-internal destinations are not public documentation routes.
    // Keep their readable labels without linking to the frozen public repo.
    return label;
  });

  const safeTitle = pageTitle.replace(/"/g, '\\"');
  return `---\ntitle: "${safeTitle}"\n---\n\n${body}`;
}

// A running `astro dev` (recorded in .astro/dev.json) imports generated modules
// from this cache and restarts with an empty content collection when its
// settings vanish: keep the cache only while an astro dev server of this very
// site runs. A stale record whose PID now belongs to another process does not
// count, and builds (--build) always start from a clean cache.
async function devServerRunning() {
  let pid, url;
  try { ({ pid, url } = JSON.parse(fs.readFileSync(path.join(astroCacheDir, 'dev.json'), 'utf8'))); } catch { return false; }
  if (!Number.isInteger(pid) || pid <= 0) return false;
  const siteDir = path.resolve(here, '..');
  if (fs.existsSync('/proc')) {
    try {
      const commandLine = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0');
      const cwd = fs.realpathSync(`/proc/${pid}/cwd`);
      return commandLine.some((part) => /astro(\.mjs)?$/.test(part)) && commandLine.includes('dev') && cwd === fs.realpathSync(siteDir);
    } catch { return false; }
  }
  // Without /proc (Windows, macOS) a recorded PID may belong to another process by now: only a
  // dev server that answers on its recorded address counts as running.
  if (typeof url !== 'string') return false;
  try { await fetch(url, { signal: AbortSignal.timeout(1500) }); return true; } catch { return false; }
}
if (forBuild || !(await devServerRunning())) fs.rmSync(astroCacheDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

// Pages are updated in place: a running `astro dev` watches these files, and
// removing the whole folder would end those watches (the site then keeps
// serving the previous text). Unchanged pages are not rewritten.
function writeIfChanged(file, content) {
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === content) return;
  fs.writeFileSync(file, content);
}

let converted = 0;
const written = new Set();
for (const name of sourceFiles) {
  const markdown = readSourceFile(name, 'utf8');
  if (name === 'README.md') {
    fs.mkdirSync(path.dirname(overviewOut), { recursive: true });
    writeIfChanged(overviewOut, convert(markdown, { title: 'Overview' }));
    continue;
  }
  const outName = `${slugByFile.get(name)}.md`;
  writeIfChanged(path.join(outDir, outName), convert(markdown, {}));
  written.add(outName);
  converted += 1;
}
for (const name of fs.readdirSync(outDir)) {
  if (!written.has(name)) fs.rmSync(path.join(outDir, name), { recursive: true, force: true });
}

const assetsSrc = path.join(featuresDir, 'assets');
const gitAssetFiles = gitFiles.filter((name) => name.startsWith(`${featurePath}/assets/`));
const hasAssets = sourceRef ? gitAssetFiles.length > 0 : fs.existsSync(assetsSrc);
if (hasAssets) {
  fs.rmSync(assetsOut, { recursive: true, force: true });
  if (sourceRef) {
    for (const assetPath of gitAssetFiles) {
      const relativePath = assetPath.slice(`${featurePath}/`.length);
      const destination = path.join(here, '..', 'public', relativePath);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, gitOutput(['show', `${sourceRef}:${assetPath}`]));
    }
  } else {
    fs.cpSync(assetsSrc, assetsOut, { recursive: true });
  }
}

const sourceLabel = sourceRef ? `Git ref ${sourceRef}` : 'working tree';
console.log(`Converted ${converted} feature pages + overview from ${sourceLabel}; assets ${hasAssets ? 'copied' : 'not found'}.`);
