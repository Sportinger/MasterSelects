// Documentation site sync (docs-site/scripts/sync-features.mjs): routes, the nested sidebar
// from the feature index, unpublished pages, galleries, clips and redirects.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { convertPage, galleryHtml, preparePage, stripBackLinks } from '../../docs-site/scripts/lib/convertPage.mjs';
import { loadEffectCatalog, parseEffectGroups } from '../../docs-site/scripts/lib/effectCatalog.mjs';
import { buildSidebar, effectGroupIndex, readIndexSections } from '../../docs-site/scripts/lib/featureIndex.mjs';
import { PAGE_BUDGETS, devServerServesAsset, pageBudgetIssues } from '../../docs-site/scripts/lib/media.mjs';
import { buildAnchorRedirects, buildRedirects } from '../../docs-site/scripts/lib/redirects.mjs';
import { pageSlug } from '../../docs-site/scripts/lib/routes.mjs';

const pickerGroups = [
  { id: 'color', label: 'Color & Tone', effects: ['brightness', 'contrast'] },
  { id: 'blur', label: 'Blur & Sharpen', effects: ['box-blur', 'gaussian-blur', 'sharpen'] },
  { id: 'generate', label: 'Generate', effects: ['color-wheel'] },
  { id: 'keying', label: 'Keying', effects: ['chroma-key'] },
  { id: 'time', label: 'Time', effects: ['slit-scan', 'time-stack'] },
];

const index = `# Docs

## Documentation Index

### Getting Started

| Document | Description |
|---|---|
| [Welcome](../../docs-site/src/content/docs/getting-started/welcome.md) | Start |
| [Overview](./README.md) | Map |

<!-- planned:
| [Your first edit](./guides/your-first-edit.md) | Not written yet |
-->

### Effects

| Document | Description |
|---|---|
| [Nodes basics](./Node-Workspace.md) | Nodes |

<!-- docs-sidebar: effect-groups keying+time -->

| Document | Group | Description |
|---|---|---|
| [Overview](./Effects-Blur.md) | \`blur\` | Blurs |
| [Overview](./Effects-Keying-Time.md) | \`keying\` | Keying and time |
| [Time Stack](./Time-Stack.md) | \`time\` | Old page |

### Transitions
<!-- docs-sidebar: collapsed -->

| Document | Description |
|---|---|
| [Dissolve](./Transitions-Dissolve.md) | Crossfade |

### Developers
<!-- docs-sidebar: collapsed -->

| Document | Description |
|---|---|
| [GPU Engine](./GPU-Engine.md) | Engine |

#### Testing
<!-- docs-sidebar: expanded -->

| Document | Description |
|---|---|
| [LAN Device Testing](./LAN-Device-Testing.md) | Devices |
| [GPU Engine](./GPU-Engine.md) | Listed twice |

#### Empty

| Document | Description |
|---|---|
| [Missing](./Missing-Page.md) | Does not exist |

### Unpublished
<!-- docs-sidebar: unpublished -->

| Document | Description |
|---|---|
| [Social Operations](./Social-Operations.md) | Internal |

## Current Stack
| [Ignored](./Ignored.md) | after the index |
`;

const pages = [
  'README.md', 'Node-Workspace.md', 'Effects-Blur.md', 'Effects-Keying-Time.md', 'Effects-Generate.md', 'Time-Stack.md',
  'Transitions-Dissolve.md', 'Transitions-Wipe.md', 'GPU-Engine.md', 'LAN-Device-Testing.md', 'Social-Operations.md',
  'Orphan.md', 'guides/trim-split-move.md', 'effects/gaussian-blur.md', 'effects/box-blur.md', 'effects/time-stack.md',
];

function sidebarFor(extraPages: string[] = []) {
  const { sections, notes } = readIndexSections(index);
  const result = buildSidebar({
    sections,
    pages: [...pages, ...extraPages],
    sitePages: new Set(['getting-started/welcome', '']),
    effectGroups: pickerGroups,
    effectNames: new Map([['gaussian-blur', 'Gaussian Blur'], ['box-blur', 'Box Blur']]),
  });
  return { ...result, notes: [...notes, ...result.notes] };
}

describe('docs site routes', () => {
  it('publishes top-level pages, guides, effect pages and the effect catalog under their own folders', () => {
    expect(pageSlug('Timeline.md')).toBe('features/timeline');
    expect(pageSlug('guides/trim-split-move.md')).toBe('guides/trim-split-move');
    expect(pageSlug('effects/gaussian-blur.md')).toBe('effects/gaussian-blur');
    expect(pageSlug('effects/index.md')).toBe('effects');
    expect(pageSlug('README.md')).toBe('getting-started/overview');
    expect(pageSlug('assets/effects/glow.webp')).toBeUndefined();
    expect(pageSlug('other/page.md')).toBeUndefined();
  });
});

describe('docs site sidebar', () => {
  it('keeps the index order, collapsed groups and nested subgroups, and lists planned rows nowhere', () => {
    const { sidebar } = sidebarFor();
    expect(sidebar.map((group: { label: string }) => group.label)).toEqual(['Getting Started', 'Effects', 'Transitions', 'Developers', 'More']);
    expect(sidebar[0]).toEqual({
      label: 'Getting Started',
      items: [
        { label: 'Welcome', slug: 'getting-started/welcome' },
        { label: 'Overview', slug: 'getting-started/overview' },
      ],
    });
    const developers = sidebar[3];
    expect(developers.collapsed).toBe(true);
    expect(developers.items).toEqual([
      { label: 'GPU Engine', slug: 'features/gpu-engine' },
      { label: 'Testing', collapsed: false, items: [{ label: 'LAN Device Testing', slug: 'features/lan-device-testing' }] },
    ]);
    expect(JSON.stringify(sidebar)).not.toContain('your-first-edit');
  });

  it('builds the effect subgroups in picker order with merged labels, rows first and effect pages after them', () => {
    const effects = sidebarFor().sidebar[1];
    expect(effects.collapsed).toBeUndefined();
    expect(effects.items).toEqual([
      { label: 'Nodes basics', slug: 'features/node-workspace' },
      {
        label: 'Blur & Sharpen',
        collapsed: true,
        items: [
          { label: 'Overview', slug: 'features/effects-blur' },
          { label: 'Box Blur', slug: 'effects/box-blur' },
          { label: 'Gaussian Blur', slug: 'effects/gaussian-blur' },
        ],
      },
      { label: 'Generate', collapsed: true, items: [{ slug: 'features/effects-generate' }] },
      {
        label: 'Keying & Time',
        collapsed: true,
        items: [
          { label: 'Overview', slug: 'features/effects-keying-time' },
          { label: 'Time Stack', slug: 'features/time-stack' },
          { slug: 'effects/time-stack' },
        ],
      },
    ]);
  });

  it('places pages without a row by family, reports every placement and never lists missing or unpublished pages', () => {
    const { sidebar, unpublished, notes } = sidebarFor();
    const text = notes.map((note: { text: string }) => note.text).join('\n');
    expect(sidebar[2].items).toEqual([{ label: 'Dissolve', slug: 'features/transitions-dissolve' }, { slug: 'features/transitions-wipe' }]);
    expect(sidebar[4]).toEqual({ label: 'More', items: [{ slug: 'features/orphan' }, { slug: 'guides/trim-split-move' }] });
    expect([...unpublished]).toEqual(['Social-Operations.md']);
    expect(JSON.stringify(sidebar)).not.toMatch(/social-operations|missing-page|ignored/u);
    expect(text).toContain('Effects-Generate.md has no row');
    expect(text).toContain('Transitions-Wipe.md has no row');
    expect(text).toContain('Missing-Page.md under "Developers › Empty", but the page does not exist');
    expect(text).toContain('GPU-Engine.md is listed under "Developers" and again under "Developers › Testing"');
    expect(text).toContain('effect groups without pages yet: Color & Tone');
  });

  it('puts unlisted guides into the Guides group and the effect catalog first into Effects', () => {
    const guides = `## Documentation Index\n\n### Guides\n\n| Document | Description |\n|---|---|\n| [Using effects](./Effects.md) | Effects |\n\n### Effects\n\n<!-- docs-sidebar: effect-groups -->\n`;
    const { sidebar } = buildSidebar({
      sections: readIndexSections(guides).sections,
      pages: ['Effects.md', 'guides/import-media.md', 'effects/index.md', 'effects/sharpen.md'],
      effectGroups: pickerGroups,
    });
    expect(sidebar).toEqual([
      { label: 'Guides', items: [{ label: 'Using effects', slug: 'features/effects' }, { slug: 'guides/import-media' }] },
      { label: 'Effects', items: [{ slug: 'effects' }, { label: 'Blur & Sharpen', collapsed: true, items: [{ slug: 'effects/sharpen' }] }] },
    ]);
  });

  it('reads the picker groups of the app', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../src/effects/effectCatalogGroups.ts'), 'utf8');
    const parsed = parseEffectGroups(source);
    expect(parsed?.groups.map((group: { id: string }) => group.id)).toEqual(
      ['color', 'blur', 'stylize', 'generate', 'distort', 'pixel', 'print', 'lines', 'textile', 'text', 'analog', 'keying', 'time', 'tracking', 'scene'],
    );
    expect(parsed?.groups[1]).toEqual({ id: 'blur', label: 'Blur & Sharpen', effects: ['box-blur', 'gaussian-blur', 'motion-blur', 'radial-blur', 'zoom-blur', 'sharpen'] });
    expect(loadEffectCatalog({ groupsSource: source }).source).toBe('effectCatalogGroups.ts');
  });

  it('leaves effects hidden from the picker out of their group', () => {
    for (const hidden of ["new Set(['rom1'])", "new Set<string>(['rom1'])"]) {
      const source = `export const EFFECT_GROUPS = [\n  { id: 'stylize', label: 'Light & Stylize', effects: ['glow', 'rom1'] },\n] as const;\nexport const EFFECTS_HIDDEN_FROM_CATALOG: ReadonlySet<string> = ${hidden};`;
      expect(loadEffectCatalog({ groupsSource: source }).groups[0].effects).toEqual(['glow']);
    }
  });
});

describe('docs site page conversion', () => {
  const sources = new Map([
    ['effects/gaussian-blur.md', '# Gaussian Blur\n\n## Node setup\n'],
    ['Effects.md', '# Effects\n\n## Split compare\n'],
    ['Product-Analytics.md', '# Analytics\n'],
  ]);
  // A WebP header (VP8X) that says 640 × 360.
  const poster = new Uint8Array(32);
  poster.set([...'RIFF'].map((c) => c.charCodeAt(0)), 0);
  poster.set([...'WEBPVP8X'].map((c) => c.charCodeAt(0)), 8);
  poster.set([639 & 0xff, 639 >> 8, 0, 359 & 0xff, 359 >> 8, 0], 24);
  const assets = new Map<string, Uint8Array>([
    ['assets/clips/drag.mp4', new Uint8Array(10)],
    ['assets/clips/drag.webm', new Uint8Array(10)],
    ['assets/clips/still.webp', poster],
  ]);
  function convert(file: string, markdown: string) {
    const warnings: string[] = [];
    const prepared = new Map([...sources, [file, markdown]].map(([name, text]) => [name, preparePage(text, {})]));
    const text = convertPage(prepared.get(file), {
      file,
      published: (page: string) => pageSlug(page),
      exists: (page: string) => prepared.has(page),
      unpublished: (page: string) => page === 'Product-Analytics.md',
      anchorsOf: (page: string) => prepared.get(page)?.anchors,
      asset: (name: string) => assets.get(name),
      checkAsset: () => {},
      warn: (message: string) => warnings.push(message),
    });
    return { text, warnings };
  }

  it('removes "Back to" links anywhere but keeps code and the rest of a navigation line', () => {
    const markdown = '[Back to Index](./README.md)\n\n# Title\n\n[<- Back to Index](./README.md) | [Timeline](./Timeline.md)\n\nText\n\n[← Back to Index](./README.md)\n\n```md\n[Back to Index](./README.md)\n```\n';
    expect(stripBackLinks(markdown)).toBe('# Title\n\n[Timeline](./Timeline.md)\n\nText\n\n```md\n[Back to Index](./README.md)\n```\n');
  });

  it('resolves links relative to the page, checks anchors and keeps only the text of unpublished pages', () => {
    const { text, warnings } = convert('guides/trim-split-move.md', [
      '# Trim',
      '',
      'See [Using effects](../Effects.md#split-compare), [Gaussian Blur](../effects/gaussian-blur.md#node-setup),',
      '[the old anchor](../Effects.md#gone), [analytics](../Product-Analytics.md) and [code](../../src/main.ts).',
      '',
      '`[kept](../Effects.md)`',
    ].join('\n'));
    expect(text).toContain('title: "Trim"');
    expect(text).toContain('[Using effects](/docs/features/effects/#split-compare)');
    expect(text).toContain('[Gaussian Blur](/docs/effects/gaussian-blur/#node-setup)');
    expect(text).toContain(' analytics and code.');
    expect(text).toContain('`[kept](../Effects.md)`');
    expect(warnings).toEqual([expect.stringContaining('#gone, which Effects.md does not have')]);
  });

  it('turns a clip into a muted video with its webm source and reports the missing poster', () => {
    const { text, warnings } = convert('guides/x.md', '# X\n\n![Dragging a clip](../assets/clips/drag.mp4)\n');
    expect(text).toContain('<video class="docs-clip-video" muted loop playsinline controls preload="none" data-docs-autoplay aria-label="Dragging a clip"><source src="/docs/assets/clips/drag.webm" type="video/webm"><source src="/docs/assets/clips/drag.mp4" type="video/mp4"></video>');
    expect(warnings).toEqual([expect.stringContaining('has no poster')]);
  });

  it('gives a clip figure from doc-clip.mjs site URLs, its poster size and script-driven playback', () => {
    const { text, warnings } = convert('Effects-Analog.md', '# Analog\n\n<figure class="docs-shot docs-clip">\n<video src="assets/clips/drag.mp4" poster="assets/clips/still.webp" autoplay muted loop playsinline preload="none" aria-label="Drag"></video>\n</figure>\n');
    expect(text).toContain('<video class="docs-clip-video" src="/docs/assets/clips/drag.mp4" poster="/docs/assets/clips/still.webp" data-docs-autoplay muted loop playsinline preload="none" aria-label="Drag" controls width="640" height="360">');
    expect(warnings).toEqual([]);
  });

  it('expands a gallery whose cards keep the old heading slugs as ids', () => {
    const catalog = loadEffectCatalog({
      catalog: { effects: [{ id: 'box-blur', name: 'Box Blur', description: 'Square blocks.' }, { id: 'gaussian-blur', name: 'Gaussian Blur' }] },
      groupsSource: "export const EFFECT_GROUPS = [\n  { id: 'blur', label: 'Blur & Sharpen', effects: ['box-blur', 'gaussian-blur'] },\n] as const;",
    });
    const html = galleryHtml('blur', {
      catalog,
      hasPage: (page: string) => page === 'effects/box-blur.md',
      asset: () => undefined,
      warn: () => {},
      takenIds: new Set(['gaussian-blur']),
    });
    expect(html).toContain('<ul class="docs-gallery not-content" aria-label="Blur &amp; Sharpen">');
    expect(html).toContain('<li id="box-blur"><a class="docs-gallery-card" href="/docs/effects/box-blur/">');
    expect(html).toContain('<span class="docs-gallery-text">Square blocks.</span>');
    expect(html).toContain('<li><span class="docs-gallery-card docs-gallery-card--soon">');
  });

  it('gives the full catalog one section per sidebar subgroup with a link to its overview', () => {
    const catalog = loadEffectCatalog({ catalog: { groups: pickerGroups, effects: [] } });
    const effectIndex = effectGroupIndex(readIndexSections(`## Documentation Index

### Effects

<!-- docs-sidebar: effect-groups keying+time -->

| Document | Effect group | Description |
|---|---|---|
| [Overview](./Effects-Blur.md) | \`blur\` | Blurs |
| [Overview](./Effects-Keying-Time.md) | \`keying\` | Keys and time |
`).sections);
    const html = galleryHtml('all', {
      catalog, effectIndex, file: 'effects/index.md',
      hasPage: (page: string) => page.startsWith('Effects-'), asset: () => undefined, warn: () => {}, takenIds: new Set(),
    });
    expect(html).toContain('## Blur & Sharpen\n\n[Overview and which one to choose →](../Effects-Blur.md)');
    expect(html).toContain('## Keying & Time\n\n[Overview and which one to choose →](../Effects-Keying-Time.md)');
    expect(html).not.toContain('## Time\n');
    expect(html).toMatch(/## Color & Tone\n\n<ul/u);
  });
});

describe('docs site sidebar: a second way in', () => {
  it('lets rows under "also" repeat a page another group lists, without a warning', () => {
    const { sidebar, notes } = buildSidebar({
      sections: readIndexSections(`## Documentation Index

### Guides

| Document | Description |
|---|---|
| [Using effects](./Effects.md) | Effects |

### Effects

<!-- docs-sidebar: also -->

| Document | Description |
|---|---|
| [Using effects](./Effects.md) | Effects |
| [Nodes basics](./Node-Workspace.md) | Nodes |
| [Nodes basics](./Node-Workspace.md) | Twice |
`).sections,
      pages: ['README.md', 'Effects.md', 'Node-Workspace.md'], sitePages: new Set(), effectGroups: [], effectNames: new Map(),
    });
    expect(sidebar[1].items.map((item: { slug: string }) => item.slug)).toEqual(['features/effects', 'features/node-workspace', 'features/node-workspace']);
    expect(notes.filter((note: { text: string }) => note.text.includes('again'))).toEqual([]);
  });
});

describe('docs site redirects', () => {
  it('waits while the old page is published and drops redirects to missing pages', () => {
    const routes = new Set(['features/proxy-system', 'effects/time-stack', 'features/scene-cut-detection']);
    const result = buildRedirects({
      '/docs/features/time-stack/': '/docs/effects/time-stack/',
      '/docs/features/scene-cut-detection/': '/docs/features/proxy-system/#scene-cuts',
      '/docs/features/memory-leak/': '/docs/effects/memory-leak/',
    }, routes);
    expect(result.redirects).toEqual({ '/features/time-stack': '/docs/effects/time-stack/' });
    expect(result.waiting).toBe(1);
    expect(result.notes.map((note: { text: string }) => note.text).join('\n')).toContain('memory-leak/, which is no published page');
  });
});

describe('docs site anchor redirects', () => {
  it('sends old anchors of a page that stays to their new place, and reports the ones that cannot work', () => {
    const routes = new Set(['features/effects', 'effects/slit-scan', 'features/effect-system']);
    const anchors = new Map([['features/effects', new Set(['add-an-effect'])], ['features/effect-system', new Set(['split-compare'])]]);
    const result = buildAnchorRedirects({
      '/docs/features/effects/': {
        'slit-scan': '/docs/effects/slit-scan/',
        'split-compare': '/docs/features/effect-system/#split-compare',
        'add-an-effect': '/docs/effects/slit-scan/',
        'gone': '/docs/features/missing/',
        'bad-anchor': '/docs/features/effect-system/#nope',
      },
      '/docs/features/missing/': { x: '/docs/effects/slit-scan/' },
    }, routes, (slug: string) => anchors.get(slug));
    expect(result.anchors).toEqual({ '/docs/features/effects/': {
      'slit-scan': '/docs/effects/slit-scan/', 'split-compare': '/docs/features/effect-system/#split-compare', 'bad-anchor': '/docs/features/effect-system/#nope',
    } });
    const texts = result.notes.map((note: { text: string }) => note.text).join('\n');
    expect(texts).toContain('#add-an-effect still exists');
    expect(texts).toContain('/docs/features/missing/, which is no published page');
    expect(texts).toContain('#nope');
    expect(texts).toContain('/docs/features/missing/ is no published page');
  });
});

describe('docs site page budget', () => {
  it('adds up the pictures and posters and the clips of a page, counting a clip once', () => {
    const page = new Map([
      ['assets/effects/clips/drift-lines.mp4', 900_000], ['assets/effects/clips/drift-lines.webm', 700_000],
      ['assets/effects/clips/drift-lines.webp', 30_000], ['assets/effects/graphs/drift-lines.webp', 60_000],
      ...[1, 2, 3, 4].map((index): [string, number] => [`assets/effects/clips/control-${index}.mp4`, 500_000]),
    ]);
    expect(pageBudgetIssues(page)).toEqual([]);
    page.set('assets/effects/clips/presets.mp4', PAGE_BUDGETS.clipBytes - 2_900_000 + 1);
    expect(pageBudgetIssues(page)).toEqual(['its 6 clips add up to 5.0 MB (page budget 5.0 MB)']);
    const pictures = new Map(Array.from({ length: 6 }, (_, index): [string, number] => [`assets/guides/step-${index}.webp`, 190_000]));
    expect(pageBudgetIssues(pictures)).toEqual(['its pictures and posters add up to 1.1 MB (page budget 1.0 MB)']);
  });
});

describe('new assets on a running docs dev server', () => {
  const answering = (statuses: number[]) => {
    const asked: string[] = [];
    const fetchImpl = async (url: string) => { asked.push(url); return { status: statuses.shift() ?? 404 }; };
    return { asked, fetchImpl: fetchImpl as unknown as typeof fetch };
  };
  it('asks the dev server for the new file under /docs and waits for its watcher', async () => {
    const server = answering([404, 200]);
    await expect(devServerServesAsset('http://127.0.0.1:4360/', 'assets/effects/graphs/new pic.webp', { fetchImpl: server.fetchImpl, waitMs: 0 })).resolves.toBe(true);
    expect(server.asked).toEqual(['http://127.0.0.1:4360/docs/assets/effects/graphs/new%20pic.webp', 'http://127.0.0.1:4360/docs/assets/effects/graphs/new%20pic.webp']);
  });
  it('reports a file that stays 404, but not a server that does not answer', async () => {
    await expect(devServerServesAsset('http://127.0.0.1:4360', 'assets/x.webp', { fetchImpl: answering([]).fetchImpl, attempts: 3, waitMs: 0 })).resolves.toBe(false);
    const offline = (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
    await expect(devServerServesAsset('http://127.0.0.1:4360', 'assets/x.webp', { fetchImpl: offline, waitMs: 0 })).resolves.toBe(true);
  });
});
