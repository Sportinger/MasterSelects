// Sync docs/Features/*.md into the Starlight content collection.
//
// docs/Features stays the single source of truth (edited alongside the
// code); this script converts each page for the docs site: adds the
// frontmatter Starlight requires, drops the repo-internal back-link,
// rewrites feature-to-feature links to site routes, points links that
// leave docs/Features at GitHub, and copies the shared assets folder.
//
// Usage: node scripts/sync-features.mjs   (from docs-site/)

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

function convert(markdown, { title }) {
  let body = markdown;
  // Drop the repo-internal "[Back to Project](../../README.md)" back-link line.
  body = body.replace(/^\[Back to [^\]]+\]\([^)]*\)\s*\n+/i, '');
  // The first H1 becomes the frontmatter title.
  const h1 = body.match(/^#\s+(.+?)\s*$/m);
  const pageTitle = title ?? h1?.[1] ?? 'Untitled';
  if (h1) body = body.replace(h1[0], '').replace(/^\s*\n/, '');

  body = body.replace(/(!?)\[([^\]]+)\]\(([^)\s]+)\)/g, (full, imagePrefix, label, target) => {
    if (/^(https?:|mailto:|#)/.test(target)) return full;
    const [rawPath, anchor = ''] = target.split('#');
    const suffix = anchor ? `#${anchor}` : '';
    const clean = rawPath.replace(/^\.\//, '');
    // Feature-to-feature links become site routes.
    const fileName = path.posix.basename(clean);
    if (slugByFile.has(fileName) && !clean.includes('/')) {
      return `${imagePrefix}[${label}](/features/${slugByFile.get(fileName)}/${suffix})`;
    }
    if (fileName === 'README.md' && (clean === 'README.md' || clean === './README.md')) {
      return `${imagePrefix}[${label}](/getting-started/overview/${suffix})`;
    }
    // Shared images move into the site's public/ folder.
    if (clean.startsWith('assets/')) {
      return `${imagePrefix}[${label}](/${clean}${suffix})`;
    }
    // Repository-internal destinations are not public documentation routes.
    // Keep their readable labels without linking to the frozen public repo.
    return label;
  });

  const safeTitle = pageTitle.replace(/"/g, '\\"');
  return `---\ntitle: "${safeTitle}"\n---\n\n${body}`;
}

fs.rmSync(astroCacheDir, { recursive: true, force: true });
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

let converted = 0;
for (const name of sourceFiles) {
  const markdown = readSourceFile(name, 'utf8');
  if (name === 'README.md') {
    fs.mkdirSync(path.dirname(overviewOut), { recursive: true });
    fs.writeFileSync(overviewOut, convert(markdown, { title: 'Overview' }));
    continue;
  }
  const outName = `${slugByFile.get(name)}.md`;
  fs.writeFileSync(path.join(outDir, outName), convert(markdown, {}));
  converted += 1;
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
