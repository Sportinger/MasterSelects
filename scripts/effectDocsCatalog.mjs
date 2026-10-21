// Effect documentation data, shared by scripts/effect-docs.mjs (writes the files) and
// tests/unit/effectDocsCatalog.test.ts (fails when they are out of date). Pure functions:
// callers pass in the effect registry and the docs/Features files they need.
//
//   docs/Features/effects/catalog.json    one entry per effect of the registry, in picker order;
//                                         the docs-site gallery cards and sidebar read it
//   <!-- generated:controls start/end --> the controls table inside an effect page
//   basic pages                           effects/<id>.md written from the catalog for effects
//                                         nobody has written a page for yet
// Page template and rules: docs/Features/Documentation-Site.md ("Effect pages").

import { mergeEffectGroups, readIndexSections, rowTarget } from '../docs-site/scripts/lib/featureIndex.mjs';
import { slug } from '../docs-site/scripts/lib/slug.mjs';

export const CATALOG_FILE = 'effects/catalog.json';
export const CONTROLS_START = '<!-- generated:controls start -->';
export const CONTROLS_END = '<!-- generated:controls end -->';
/** First line after the title of a generated basic page; a page without it is hand-written. */
export const BASIC_MARKER = '<!-- effect-docs: basic page';
const BASIC_MARKER_LINE = `${BASIC_MARKER}, written by scripts/effect-docs.mjs. Delete this line to write the page by hand (template B in Documentation-Site.md). -->`;
export const THUMB_MAX_BYTES = 30000;
/** Thumbnails are encoded below this, so they stay inside the budget the docs sync checks. */
export const THUMB_TARGET_BYTES = 24000;

/** Asset paths relative to docs/Features. */
export const effectAssets = (id) => ({
  still: `assets/effects/${id}.webp`,
  poster: `assets/effects/clips/${id}.webp`,
  clip: `assets/effects/clips/${id}.mp4`,
  thumb: `assets/effects/thumbs/${id}.webp`,
});
export const pageFile = (id) => `effects/${id}.md`;

// ---------------------------------------------------------------------------------------------
// Registry snapshot

const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * Plain data from the live registry. `api`: { effects (getAllEffects()), groups (EFFECT_GROUPS),
 * hidden (EFFECTS_HIDDEN_FROM_CATALOG), engineOf (effectEngine), engineMembers (effectEngineMembers),
 * text (catalogText), display (effectParamDisplay), experimental (effectExperimentalNote) }.
 */
export function snapshotRegistry(api) {
  const byId = new Map(api.effects.map((effect) => [effect.id, effect]));
  const groupOf = new Map(api.groups.flatMap((group) => group.effects.map((id) => [id, group.id])));
  const keys = (effect) => Object.keys(effect.params ?? {}).toSorted().join(',');
  const groups = api.groups.map((group) => ({ id: group.id, label: group.label, effects: group.effects.filter((id) => byId.has(id)) }));
  const ungrouped = api.effects.filter((effect) => !groupOf.has(effect.id)).map((effect) => effect.id);
  if (ungrouped.length) groups.push({ id: 'other', label: 'Other', effects: ungrouped });
  const order = groups.flatMap((group) => group.effects);
  const effects = order.map((id) => {
    const effect = byId.get(id);
    const engine = api.engineOf(id);
    const styles = engine ? api.engineMembers(engine).filter((member) => member !== id && byId.has(member) && keys(byId.get(member)) === keys(effect)) : [];
    const params = Object.entries(effect.params ?? {})
      .filter(([, param]) => !param.hidden && !param.deprecated)
      .map(([key, param]) => ({
        key,
        label: param.label,
        type: param.type,
        section: param.quality ? 'Quality' : param.group?.trim() ? capitalize(param.group.trim()) : '',
        min: param.min,
        max: param.max,
        default: param.default,
        options: param.options?.map((option) => ({ value: option.value, label: option.label })),
        display: param.type === 'number' ? api.display(param, typeof param.default === 'number' ? param.default : undefined) : undefined,
        onlyWhen: param.activeWhen?.note,
      }));
    // Moving: the picture depends on time or on earlier frames, so a still cannot show it (it gets a loop).
    const moving = Boolean(effect.requiresContinuousRender || effect.usesFeedback || effect.usesInputHistory || effect.sourceTimeOwner
      || Object.values(effect.params ?? {}).some((param) => param.integratedAs));
    return {
      id,
      name: effect.name,
      group: groupOf.get(id) ?? 'other',
      description: api.text(`effect:${id}`)?.description,
      engine,
      styles,
      experimental: api.experimental(effect),
      kind: effect.pipelineKind ?? 'fullscreen',
      ownControls: Boolean(effect.customControls || effect.extraControls),
      // Hidden parameters bound by the effect's node setup (shown in the card as exposed node values).
      nodeValues: Object.values(effect.params ?? {}).some((param) => param.hidden && !param.deprecated && param.type === 'number'),
      moving,
      live: Boolean(effect.requiresContinuousRender),
      hidden: api.hidden.has(id),
      params,
    };
  });
  return { groups: groups.map((group) => ({ ...group, effects: group.effects.filter((id) => !api.hidden.has(id)) })), effects };
}

// ---------------------------------------------------------------------------------------------
// Text helpers

/** Markdown inline syntax removed: links keep their text, emphasis and code marks go. */
export function plainText(markdown) {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/<[^>]+>/gu, '')
    .replace(/(\*\*|__|\*|_|`)(.+?)\1/gu, '$2')
    .replace(/\s+/gu, ' ')
    .trim();
}

/** The first sentence of a text (a full stop, question or exclamation mark before a space and a capital, or the end). */
export function firstSentence(text) {
  const match = text.match(/^(.+?[.!?])(?=\s+["“(]?[A-Z0-9]|\s*$)/u);
  return (match ? match[1] : text).trim();
}

/** A one-line card text from the catalog description: its first clause, ending in a full stop. */
export function cardText(description) {
  if (!description) return undefined;
  let depth = 0;
  let end = description.length;
  for (let index = 0; index < description.length; index += 1) {
    const char = description[index];
    if (char === '(') depth += 1;
    else if (char === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0 && (char === ';' || (char === ':' && description[index + 1] === ' ')
      || (char === '.' && /^\s+[A-Z]/u.test(description.slice(index + 1))))) { end = index; break; }
  }
  let clause = description.slice(0, end).replace(/\s*\([^()]*\)/gu, '').trim().replace(/[.,]$/u, '');
  // Cards stay short: a long clause ends at its last comma that leaves a complete phrase.
  if (clause.length > 130) {
    const cut = clause.lastIndexOf(', ', 120);
    if (cut > 40) clause = clause.slice(0, cut);
  }
  return `${clause}.`;
}

/** The lead of an effect page: the first prose paragraph after the title (comments, pictures and HTML skipped). */
export function pageLead(markdown) {
  const lines = markdown.replace(/\r\n/gu, '\n').split('\n');
  let index = lines.findIndex((line) => /^#\s/u.test(line));
  if (index < 0) return undefined;
  let inComment = false;
  let inHtml = false;
  const paragraph = [];
  for (index += 1; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (inComment) { if (line.includes('-->')) inComment = false; continue; }
    if (line.startsWith('<!--')) { if (!line.includes('-->')) inComment = true; continue; }
    if (!line) { if (paragraph.length) break; inHtml = false; continue; }
    if (paragraph.length === 0 && (line.startsWith('<') || inHtml)) { inHtml = true; continue; }
    if (/^(#|!\[|\||[-*] |\d+\. |```|>)/u.test(line)) { if (paragraph.length) break; continue; }
    paragraph.push(line);
  }
  return paragraph.length ? plainText(paragraph.join(' ')) : undefined;
}

export const isBasicPage = (markdown) => markdown.includes(BASIC_MARKER);

// ---------------------------------------------------------------------------------------------
// Controls table

const trimNumber = (value, decimals) => String(Number(value.toFixed(Math.min(4, Math.max(0, decimals)))));

function unitSuffix(display) {
  const suffix = display?.suffix ?? '';
  return /^[A-Za-z]/u.test(suffix) ? ` ${suffix}` : suffix;
}

function numberText(value, display) {
  if (typeof value !== 'number') return String(value);
  return `${trimNumber(value * (display?.scale ?? 1), display?.decimals ?? 2).replace('-', '−')}${unitSuffix(display)}`;
}

const tableCell = (text) => String(text).replace(/\|/gu, '\\|').replace(/\s+/gu, ' ').trim();

function choiceList(options) {
  const labels = options.map((option) => option.label);
  return labels.length > 6 ? `${labels.slice(0, 5).join(', ')} and ${labels.length - 5} more` : labels.join(', ');
}

/** Range or choices of one control, in the units the effect card shows. */
export function controlRange(param) {
  switch (param.type) {
    case 'number': {
      const { min, max, display } = param;
      if (min === undefined && max === undefined) return 'any number';
      if (min === undefined) return `up to ${numberText(max, display)}`;
      if (max === undefined) return `${numberText(min, display)} or more`;
      const decimals = display?.decimals ?? 2;
      const scale = display?.scale ?? 1;
      return `${trimNumber(min * scale, decimals).replace('-', '−')} to ${numberText(max, display)}`;
    }
    case 'boolean': return 'on or off';
    case 'select': return choiceList(param.options ?? []);
    case 'color': return 'a colour';
    case 'point': return 'a point (x, y)';
    case 'text': return 'text';
    default: return param.type;
  }
}

/** Default value of one control, as the effect card shows it. */
export function controlDefault(param) {
  const value = param.default;
  switch (param.type) {
    case 'number': return numberText(value, param.display);
    case 'boolean': return value ? 'on' : 'off';
    case 'select': return param.options?.find((option) => option.value === value)?.label ?? String(value);
    case 'color': return `\`${value}\``;
    case 'text': return value === '' ? 'empty' : `“${value}”`;
    case 'point': return typeof value === 'string' ? value : JSON.stringify(value);
    default: return String(value);
  }
}

/**
 * The generated controls block (without its markers): one table, Control · Range · Default, in the
 * order of the effect card. When the card has sections, each starts with a row naming it (Quality last).
 */
export function controlsTable(effect) {
  if (!effect.params.length) {
    if (effect.ownControls) return 'This effect has no standard controls; its card shows controls of its own.';
    return effect.nodeValues
      ? 'Its controls are values of its node setup: the effect card shows the ones the setup exposes.'
      : 'This effect has no controls.';
  }
  const sections = new Map();
  for (const param of effect.params) {
    if (!sections.has(param.section)) sections.set(param.section, []);
    sections.get(param.section).push(param);
  }
  const ordered = [...sections].toSorted(([a], [b]) => (a === 'Quality') - (b === 'Quality'));
  const named = ordered.length > 1 || ordered[0][0] !== '';
  const rows = ordered.flatMap(([section, params]) => [
    ...(named ? [`| **${tableCell(section || 'General')}** | | |`] : []),
    ...params.map((param) => {
      const label = param.onlyWhen ? `${param.label} (${param.onlyWhen.replace(/\.$/u, '')})` : param.label;
      return `| ${tableCell(label)} | ${tableCell(controlRange(param))} | ${tableCell(controlDefault(param))} |`;
    }),
  ]);
  const table = `| Control | Range | Default |\n|---|---|---|\n${rows.join('\n')}`;
  return effect.ownControls ? `${table}\n\nThe effect card also has controls of its own that this table does not list.` : table;
}

/** `markdown` with every generated controls block refreshed, or unchanged when it has none. */
export function refreshGeneratedBlocks(markdown, effect) {
  const start = CONTROLS_START.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const end = CONTROLS_END.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return markdown.replace(new RegExp(`${start}[\\s\\S]*?${end}`, 'gu'), `${CONTROLS_START}\n${controlsTable(effect)}\n${CONTROLS_END}`);
}

// ---------------------------------------------------------------------------------------------
// Group overview pages (from the README index) and which effects they describe

/**
 * Overview pages per picker group from the effect-groups rows of the README index:
 * Map<groupId, { overview: 'Effects-Blur.md' | undefined, pages: [files], joined: [groupIds] }>.
 */
export function groupOverviews(readme, groupIds) {
  const result = new Map(groupIds.map((id) => [id, { overview: undefined, pages: [], joined: [id] }]));
  const { sections } = readIndexSections(readme);
  for (const block of sections.flatMap((section) => section.blocks)) {
    if (block.kind !== 'effects') continue;
    const merged = mergeEffectGroups(groupIds.map((id) => ({ id, label: id, effects: [] })), block.merges);
    for (const entry of merged) for (const id of entry.ids) result.get(id).joined = entry.ids;
    for (const row of block.rows) {
      const groupId = row.cells[0]?.replace(/`/gu, '').trim();
      const file = rowTarget(row.target)?.file;
      if (!file || !result.has(groupId)) continue;
      for (const id of result.get(groupId).joined) {
        const entry = result.get(id);
        entry.pages.push(file);
        if (!entry.overview && /^Effects-[^/]+\.md$/u.test(file)) entry.overview = file;
      }
    }
  }
  return result;
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

/** Whether a group page describes an effect: its name as a heading word group or in bold. */
export function describesEffect(markdown, name) {
  const word = `(?<![\\p{L}\\p{N}])${escapeRegExp(name)}(?![\\p{L}\\p{N}])`;
  return new RegExp(`^#{1,4}\\s.*${word}`, 'imu').test(markdown) || new RegExp(`\\*\\*${escapeRegExp(name)}\\*\\*`, 'u').test(markdown.replace(/\s+/gu, ' '));
}

// ---------------------------------------------------------------------------------------------
// Catalog

/**
 * catalog.json data. `files`: { page(id) → markdown | undefined, exists(asset path) → boolean }.
 * Card text: the lead sentence of a hand-written page, else the first clause of the catalog text.
 */
export function buildCatalog(snapshot, files) {
  const effects = snapshot.effects.map((effect) => {
    const page = files.page(effect.id);
    const assets = effectAssets(effect.id);
    const basic = page !== undefined && isBasicPage(page);
    const lead = page !== undefined && !basic ? pageLead(page) : undefined;
    const still = files.exists(assets.still) ? assets.still : files.exists(assets.poster) ? assets.poster : undefined;
    const entry = {
      id: effect.id,
      name: effect.name,
      group: effect.group,
      description: lead ? firstSentence(lead) : cardText(effect.description),
      anchor: slug(effect.name),
    };
    if (page !== undefined) entry.page = pageFile(effect.id);
    if (basic) entry.basic = true;
    if (still) entry.still = still;
    if (files.exists(assets.clip)) entry.clip = assets.clip;
    if (files.exists(assets.thumb)) entry.thumb = assets.thumb;
    if (effect.engine) entry.engine = effect.engine;
    if (effect.moving) entry.moving = true;
    if (effect.experimental) entry.experimental = true;
    if (effect.hidden) entry.hidden = true;
    if (!entry.description) delete entry.description;
    return entry;
  });
  return { groups: snapshot.groups, effects };
}

/** catalog.json text: one line per group and per effect, so parallel edits merge cleanly. */
export function catalogJson(catalog) {
  const about = 'Generated by scripts/effect-docs.mjs from the effect registry (src/effects), the picker groups (src/effects/effectCatalogGroups.ts), the catalog text (src/services/nodeGraph/catalogText.ts) and the effect pages. Do not edit by hand: run node scripts/effect-docs.mjs. On a merge conflict, take either side and run it again.';
  const lines = (items) => items.map((item) => `    ${JSON.stringify(item)}`).join(',\n');
  return `{\n  "about": ${JSON.stringify(about)},\n  "groups": [\n${lines(catalog.groups)}\n  ],\n  "effects": [\n${lines(catalog.effects)}\n  ]\n}\n`;
}

// ---------------------------------------------------------------------------------------------
// Basic pages

/** Effect Lab test image (tests/browser/effect-lab/images) for an effect's basic still, and how alt texts name it. */
const LAB_IMAGE_BY_GROUP = { print: 'harbor_town', textile: 'harbor_town', text: 'harbor_town', scene: 'harbor_town', pixel: 'neon_rain_street', analog: 'neon_rain_street' };
/** Effects a still test image cannot show; they wait for a clip on suitable footage. */
export const LAB_STILL_SKIP = {
  'face-cables': 'needs a face-tracking bake of moving footage',
  'hand-particles': 'needs tracked hands in moving footage',
  'kinetic-trace': 'needs movement to leave trails',
  'splat-exploration': 'needs a Gaussian splat clip',
  subject: 'needs tracked landmarks in moving footage',
  'tracked-scene': 'needs tracked landmarks in moving footage',
};
const LAB_IMAGE_TEXT = {
  dancer_stage: 'the dancer on a dark stage',
  harbor_town: 'the harbour town',
  neon_rain_street: 'the night street with neon signs',
};
export const labImage = (effect) => LAB_IMAGE_BY_GROUP[effect.group] ?? 'dancer_stage';
export const stillAlt = (effect) => `${effect.name} on ${LAB_IMAGE_TEXT[labImage(effect)]}: the original on the left, ${effect.name} at its default settings on the right`;

/** An Effect Lab --pairs entry for an effect's basic still: a split of the original and the effect at its defaults. */
export function labPair(effect) {
  return {
    name: effect.id,
    out: `docs/Features/${effectAssets(effect.id).still}`,
    image: labImage(effect),
    width: 1920,
    layout: 'split',
    outWidth: 1200,
    maxBytes: 120000,
    left: { effect: 'original' },
    // Moving effects render one frame after a second of playback (a loop shows them better later).
    right: { effect: effect.id, params: {}, ...(effect.moving ? { times: [0, 0.5, 1] } : {}) },
  };
}

const ENGINE_LABELS = {
  'two-tone-pattern': 'the pattern engine',
  'glyph-mosaic': 'the glyph engine',
  'tracking-overlay': 'the tracking overlay engine',
};

/**
 * A basic page for an effect without a hand-written page. ctx: { groupLabel, overview (file
 * relative to docs/Features or undefined), still (its Effect Lab still, asset path, or undefined), names (id → name),
 * hasPage(id) (whether effects/<id>.md exists, for links to the other styles) }.
 */
export function basicPage(effect, ctx) {
  const groupLink = ctx.overview ? `../${ctx.overview}` : `./index.md#${slug(ctx.groupLabel)}`;
  const lead = effect.description ? effect.description.trim().replace(/([^.!?])$/u, '$1.') : `${effect.name} is an effect of the ${ctx.groupLabel} group.`;
  const parts = [
    `# ${effect.name}`,
    BASIC_MARKER_LINE,
    lead,
    `Group: [${ctx.groupLabel}](${groupLink}) · [How to add an effect](../Effects.md#add-an-effect)`,
  ];
  if (ctx.still) {
    parts.push(`<figure class="docs-shot">\n\n![${stillAlt(effect)}](../${ctx.still})\n\n<figcaption>Left: the original. Right: ${effect.name} at its default settings${effect.moving ? ', one frame of its movement' : ''}.</figcaption>\n</figure>`);
  }
  if (effect.experimental) parts.push(`**Experimental:** ${effect.experimental.trim()}`);
  parts.push('*A short page made from the editor’s effect catalog: what the effect does and its controls. Tips and its node setup will follow.*');
  parts.push(`## Controls\n\n${CONTROLS_START}\n${controlsTable(effect)}\n${CONTROLS_END}`);
  if (effect.styles.length) {
    const names = effect.styles.map((id) => (ctx.hasPage?.(id) ? `[${ctx.names.get(id) ?? id}](./${id}.md)` : ctx.names.get(id) ?? id));
    parts.push(`**Styles:** the **Style** menu in the effect card switches to another look with the same controls and keyframes: ${names.join(', ')}.`);
  }
  const details = [];
  if (effect.engine) details.push(`${effect.name} is one look of ${ENGINE_LABELS[effect.engine] ?? `the ${effect.engine} engine`}; its looks share one node setup.`);
  if (effect.kind === 'compute') details.push('It runs as a GPU compute effect.');
  if (effect.kind === 'particle-render') details.push('It draws GPU particles and comes last in the effect stack: effects after it are ignored.');
  if (effect.live) details.push('It keeps moving while the playhead stands still.');
  else if (effect.moving) details.push('It changes over time: its picture depends on the playback time or on earlier frames.');
  details.push('How effects are stored, rendered and exported: [Effect system](../Effect-System.md). Its building blocks: [Node Catalog](../Node-Catalog.md).');
  parts.push(`## Technical details\n\n${details.join(' ')}`);
  return `${parts.join('\n\n')}\n`;
}

// ---------------------------------------------------------------------------------------------
// The whole plan, shared by the script and the drift test

/**
 * What the effect docs should look like. files: { read(file) → text | undefined, exists(file),
 * pages: ids of the existing effects/<id>.md pages }. `basic`: ids to write new basic pages for.
 * Returns { texts: Map<file, text> (every file the script owns, with its current text),
 * catalog, uncovered: effects documented nowhere, unknownPages: page ids the registry lacks }.
 */
export function planEffectDocs(snapshot, files, { basic = [] } = {}) {
  const byId = new Map(snapshot.effects.map((effect) => [effect.id, effect]));
  const names = new Map(snapshot.effects.map((effect) => [effect.id, effect.name]));
  const labels = new Map(snapshot.groups.map((group) => [group.id, group.label]));
  const overviews = groupOverviews(files.read('README.md') ?? '', snapshot.groups.map((group) => group.id));
  const groupPages = [...new Set([...overviews.values()].flatMap((entry) => entry.pages))];
  const texts = new Map();
  const pageText = (id) => texts.get(pageFile(id)) ?? files.read(pageFile(id));
  // Pages after this run: the existing ones plus the new basic pages (so links between them settle in one run).
  const pageIds = new Set([...files.pages, ...basic.filter((id) => byId.has(id) && !byId.get(id).hidden)]);
  const context = (effect) => ({
    groupLabel: labels.get(effect.group) ?? effect.group,
    overview: overviews.get(effect.group)?.overview,
    still: files.exists(effectAssets(effect.id).still) ? effectAssets(effect.id).still : undefined,
    names,
    hasPage: (id) => pageIds.has(id),
  });
  for (const id of files.pages) {
    const effect = byId.get(id);
    const text = files.read(pageFile(id));
    if (!effect || text === undefined) continue;
    texts.set(pageFile(id), isBasicPage(text) ? basicPage(effect, context(effect)) : refreshGeneratedBlocks(text, effect));
  }
  for (const id of basic) {
    const effect = byId.get(id);
    if (effect && !effect.hidden && pageText(id) === undefined) texts.set(pageFile(id), basicPage(effect, context(effect)));
  }
  const catalog = buildCatalog(snapshot, { page: pageText, exists: files.exists });
  texts.set(CATALOG_FILE, catalogJson(catalog));
  const describedOn = (effect) => groupPages.filter((file) => describesEffect(files.read(file) ?? '', effect.name));
  const uncovered = snapshot.effects.filter((effect) => !effect.hidden && pageText(effect.id) === undefined && !describedOn(effect).length);
  return { texts, catalog, uncovered, unknownPages: files.pages.filter((id) => !byId.has(id)) };
}
