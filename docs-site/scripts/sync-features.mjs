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
      return `${imagePrefix}[${label}](/docs/${clean}${suffix})`;
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

// Sidebar groups come from the "## Documentation Index" of docs/Features/README.md:
// every "### Section" there becomes one sidebar group in the same order and every
// linked table row one entry, labelled with its link text. A
// `<!-- docs-sidebar: collapsed -->` line under a heading starts that group
// collapsed. astro.config.mjs reads the result from src/generated/sidebar.json.
const sidebarOut = path.join(here, '..', 'src', 'generated', 'sidebar.json');
// Category pages can land before their index row. They join the group of their
// anchor page, after the last listed page of the same family (alphabetically
// among themselves). Every other page without a row goes into a final "More" group.
const sidebarFamilies = [
  { prefix: 'Effects-', anchor: 'Effects.md' },
  { prefix: 'Transitions-', anchor: 'Transition-Compositions.md' },
];

function readIndexSections(markdown) {
  const sections = [];
  let inIndex = false;
  let section;
  for (const line of markdown.split(/\r?\n/u)) {
    if (/^##\s/u.test(line)) {
      inIndex = /^##\s+Documentation Index\s*$/iu.test(line);
      section = undefined;
      continue;
    }
    if (!inIndex) continue;
    const heading = line.match(/^###\s+(.+?)\s*$/u);
    if (heading) {
      section = { label: heading[1], collapsed: false, rows: [] };
      sections.push(section);
      continue;
    }
    if (!section) continue;
    if (/^<!--\s*docs-sidebar:\s*collapsed\s*-->$/iu.test(line.trim())) section.collapsed = true;
    const row = line.match(/^\|\s*\[([^\]]+)\]\((?:\.\/)?([^)#\s/]+\.md)(?:#[^)\s]*)?\)\s*\|/u);
    if (row) section.rows.push({ label: row[1].trim(), file: row[2] });
  }
  return sections;
}

function buildSidebar() {
  const sections = sourceFiles.includes('README.md') ? readIndexSections(readSourceFile('README.md')) : [];
  if (!sections.length) console.warn('Sidebar: docs/Features/README.md has no "## Documentation Index" sections; every page goes into "More".');
  const groupOf = new Map();
  const groups = sections.map(({ label, collapsed, rows }) => {
    const group = { label, collapsed, entries: [] };
    for (const row of rows) {
      if (!slugByFile.has(row.file)) {
        console.warn(`Sidebar: the index lists ${row.file} under "${label}", but the page does not exist; skipped.`);
      } else if (groupOf.has(row.file)) {
        console.warn(`Sidebar: ${row.file} is listed under "${groupOf.get(row.file).label}" and again under "${label}"; kept the first row.`);
      } else {
        groupOf.set(row.file, group);
        group.entries.push(row);
      }
    }
    return group;
  });
  const more = { label: 'More', collapsed: false, entries: [] };
  const unlisted = sourceFiles.filter((file) => file !== 'README.md' && !groupOf.has(file)).toSorted();
  for (const file of unlisted) {
    const family = sidebarFamilies.find(({ prefix }) => file.startsWith(prefix));
    const home = family && groupOf.get(family.anchor);
    if (home) {
      const last = home.entries.findLastIndex((entry) => entry.file === family.anchor || entry.file.startsWith(family.prefix));
      home.entries.splice(last + 1, 0, { file });
      console.warn(`Sidebar: ${file} has no row in the feature index; placed in "${home.label}" by its name. Add a row to docs/Features/README.md.`);
    } else {
      more.entries.push({ file });
      console.warn(`Sidebar: ${file} has no row in the feature index; listed under "More". Add a row to docs/Features/README.md.`);
    }
  }
  const filled = groups.filter((group) => {
    if (!group.entries.length) console.warn(`Sidebar: the index section "${group.label}" lists no existing page; group left out.`);
    return group.entries.length > 0;
  });
  if (more.entries.length) filled.push(more);
  return filled.map(({ label, collapsed, entries }) => ({
    label,
    ...(collapsed ? { collapsed: true } : {}),
    // Pages without an index row keep their own title as the label.
    items: entries.map(({ label: itemLabel, file }) => ({
      ...(itemLabel ? { label: itemLabel } : {}),
      slug: `features/${slugByFile.get(file)}`,
    })),
  }));
}

const sidebar = buildSidebar();
const sidebarJson = `${JSON.stringify(sidebar, null, 2)}\n`;
// Rewrite only on change: a running `astro dev` restarts when this file changes.
if (!fs.existsSync(sidebarOut) || fs.readFileSync(sidebarOut, 'utf8') !== sidebarJson) {
  fs.mkdirSync(path.dirname(sidebarOut), { recursive: true });
  fs.writeFileSync(sidebarOut, sidebarJson);
}
const sidebarEntries = sidebar.reduce((sum, group) => sum + group.items.length, 0);
console.log(`Sidebar: ${sidebar.length} groups, ${sidebarEntries} feature pages.`);

const sourceLabel = sourceRef ? `Git ref ${sourceRef}` : 'working tree';
console.log(`Converted ${converted} feature pages + overview from ${sourceLabel}; assets ${hasAssets ? 'copied' : 'not found'}.`);
