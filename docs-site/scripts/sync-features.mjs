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
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const featuresDir = path.join(repoRoot, 'docs', 'Features');
const outDir = path.join(here, '..', 'src', 'content', 'docs', 'features');
const overviewOut = path.join(here, '..', 'src', 'content', 'docs', 'getting-started', 'overview.md');
const assetsOut = path.join(here, '..', 'public', 'assets');

const GITHUB_BLOB = 'https://github.com/Sportinger/MasterSelects/blob/master';

const sourceFiles = fs.readdirSync(featuresDir).filter((name) => name.endsWith('.md'));
const slugByFile = new Map(sourceFiles.map((name) => [name, name.replace(/\.md$/, '').toLowerCase()]));

function convert(markdown, { title }) {
  let body = markdown;
  // Drop the repo-internal "[Back to Project](../../README.md)" back-link line.
  body = body.replace(/^\[Back to [^\]]+\]\([^)]*\)\s*\n+/i, '');
  // The first H1 becomes the frontmatter title.
  const h1 = body.match(/^#\s+(.+?)\s*$/m);
  const pageTitle = title ?? h1?.[1] ?? 'Untitled';
  if (h1) body = body.replace(h1[0], '').replace(/^\s*\n/, '');

  body = body.replace(/\]\(([^)\s]+)\)/g, (full, target) => {
    if (/^(https?:|mailto:|#)/.test(target)) return full;
    const [rawPath, anchor = ''] = target.split('#');
    const suffix = anchor ? `#${anchor}` : '';
    const clean = rawPath.replace(/^\.\//, '');
    // Feature-to-feature links become site routes.
    const fileName = path.posix.basename(clean);
    if (slugByFile.has(fileName) && !clean.includes('/')) {
      return `](/features/${slugByFile.get(fileName)}/${suffix})`;
    }
    if (fileName === 'README.md' && (clean === 'README.md' || clean === './README.md')) {
      return `](/getting-started/overview/${suffix})`;
    }
    // Shared images move into the site's public/ folder.
    if (clean.startsWith('assets/')) {
      return `](/${clean}${suffix})`;
    }
    // Anything that leaves docs/Features points at the repository.
    const resolved = path.posix.normalize(path.posix.join('docs/Features', clean));
    return `](${GITHUB_BLOB}/${resolved}${suffix})`;
  });

  const safeTitle = pageTitle.replace(/"/g, '\\"');
  return `---\ntitle: "${safeTitle}"\n---\n\n${body}`;
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

let converted = 0;
for (const name of sourceFiles) {
  const markdown = fs.readFileSync(path.join(featuresDir, name), 'utf-8');
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
if (fs.existsSync(assetsSrc)) {
  fs.rmSync(assetsOut, { recursive: true, force: true });
  fs.cpSync(assetsSrc, assetsOut, { recursive: true });
}

console.log(`Converted ${converted} feature pages + overview; assets ${fs.existsSync(assetsSrc) ? 'copied' : 'not found'}.`);
