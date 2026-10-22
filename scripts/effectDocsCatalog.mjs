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

import { createHash } from 'node:crypto';
import { mergeEffectGroups, readIndexSections, rowTarget } from '../docs-site/scripts/lib/featureIndex.mjs';
import { BUDGETS } from '../docs-site/scripts/lib/media.mjs';
import { slug } from '../docs-site/scripts/lib/slug.mjs';
import { EFFECT_DOC_EXTRAS } from './effectDocsExtras.mjs';

export const CATALOG_FILE = 'effects/catalog.json';
export const CONTROLS_START = '<!-- generated:controls start -->';
export const CONTROLS_END = '<!-- generated:controls end -->';
/**
 * First line after the title of a generated basic page; a page without it is hand-written. It carries
 * a hash of the page as written, so a hand edit under a kept marker is reported instead of overwritten.
 */
export const BASIC_MARKER = '<!-- effect-docs: basic page';
const basicMarkerLine = (sha) => `${BASIC_MARKER} sha=${sha}, written by scripts/effect-docs.mjs. Delete this line to write the page by hand (template B in Documentation-Site.md). -->`;
export const THUMB_MAX_BYTES = BUDGETS.thumbBytes;
/** Thumbnails are encoded below this, so they stay inside the budget the docs sync checks. */
export const THUMB_TARGET_BYTES = 24000;

/** Asset paths relative to docs/Features. */
export const effectAssets = (id) => ({
  still: `assets/effects/${id}.webp`,
  poster: `assets/effects/clips/${id}.webp`,
  clip: `assets/effects/clips/${id}.mp4`,
  thumb: `assets/effects/thumbs/${id}.webp`,
  presets: `assets/effects/presets/${id}.webp`,
  presetsClip: `assets/effects/clips/${id}-presets.mp4`,
});
export const pageFile = (id) => `effects/${id}.md`;

/**
 * The picture a gallery thumbnail is cut from (relative to docs/Features): `override` (thumb.source of
 * effectDocsExtras.mjs), else the clip poster when the page plays the effect's loop, has no still or does not
 * show it (the still of a rewritten page is out of date), else the still. `page` is the page's markdown.
 */
export function thumbSource(id, { exists, page, override }) {
  if (override) return exists(override) ? override : undefined;
  const { still, poster, clip } = effectAssets(id);
  const shows = (asset) => page !== undefined && page.includes(`/${asset}`);
  if (exists(poster) && (!exists(still) || shows(clip) || (page !== undefined && !shows(still)))) return poster;
  return exists(still) ? still : undefined;
}

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
  // The Style menu rule (src/services/effects/effectStyles.ts): a parameter two looks share is of the same kind.
  const sameKinds = (effect, other) => Object.entries(effect.params ?? {}).every(([key, param]) => !other.params?.[key] || other.params[key].type === param.type);
  const groups = api.groups.map((group) => ({ id: group.id, label: group.label, effects: group.effects.filter((id) => byId.has(id)) }));
  const ungrouped = api.effects.filter((effect) => !groupOf.has(effect.id)).map((effect) => effect.id);
  if (ungrouped.length) groups.push({ id: 'other', label: 'Other', effects: ungrouped });
  const order = groups.flatMap((group) => group.effects);
  const effects = order.map((id) => {
    const effect = byId.get(id);
    const engine = api.engineOf(id);
    const styles = engine ? api.engineMembers(engine).filter((member) => member !== id && byId.has(member) && sameKinds(effect, byId.get(member))) : [];
    const describe = ([key, param]) => ({
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
      });
    const current = Object.entries(effect.params ?? {}).filter(([, param]) => !param.deprecated);
    const params = current.filter(([, param]) => !param.hidden).map(describe);
    // Hidden parameters an effect's own card renders (named in effectDocsExtras.mjs rows); long text defaults dropped.
    const cardKeys = new Set((EFFECT_DOC_EXTRAS[id]?.rows ?? []).map((row) => (typeof row === 'string' ? row : row.key)).filter(Boolean));
    const hiddenParams = current.filter(([key, param]) => param.hidden && cardKeys.has(key)).map(describe);
    // Moving: the picture depends on time or on earlier frames, so a still cannot show it (it gets a loop).
    const moving = Boolean(effect.requiresContinuousRender || effect.timelineAnimated || effect.usesFeedback || effect.usesInputHistory
      || effect.sourceTimeOwner || Object.values(effect.params ?? {}).some((param) => param.integratedAs));
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
      feedback: Boolean(effect.usesFeedback),
      hidden: api.hidden.has(id),
      params,
      hiddenParams,
      // Named starting points of the card's Preset row (EffectPreset), in card order.
      presets: (effect.presets ?? []).map((preset) => ({ id: preset.id, name: preset.name, params: { ...preset.params } })),
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

/** sha-256 prefix of a text, as the basic-page marker stores it. */
export const contentHash = (text) => createHash('sha256').update(text.replace(/\r\n/gu, '\n')).digest('hex').slice(0, 12);

/** The basic-page marker of a page: only valid as the first line after the `#` title. */
export function basicMarker(markdown) {
  const lines = markdown.replace(/\r\n/gu, '\n').split('\n');
  const title = lines.findIndex((line) => /^#\s/u.test(line));
  if (title < 0) return undefined;
  const next = lines.findIndex((line, index) => index > title && line.trim() !== '');
  const line = next < 0 ? '' : lines[next].trim();
  if (!line.startsWith(BASIC_MARKER)) return undefined;
  return { line: lines[next], sha: line.match(/\bsha=([0-9a-f]+)/u)?.[1] };
}

export const isBasicPage = (markdown) => basicMarker(markdown) !== undefined;

/** Whether a basic page was changed by hand since the script wrote it (its text no longer matches the marker's hash). */
export function basicPageEdited(markdown) {
  const marker = basicMarker(markdown);
  if (!marker?.sha) return false;
  const text = markdown.replace(/\r\n/gu, '\n');
  return contentHash(text.replace(`${marker.line}\n\n`, '')) !== marker.sha;
}

// ---------------------------------------------------------------------------------------------
// Controls table

/**
 * A shown number with the card's decimals, or more where the value needs them (a range end such as 0.001
 * never reads 0); a difference below half a percent of the card's step does not count (359.9998° is 360°).
 */
function trimNumber(value, display) {
  const tolerance = Math.max(1e-9, (display?.step ?? 0.01) * 0.005);
  let decimals = Math.min(4, Math.max(0, display?.decimals ?? 2));
  while (decimals < 4 && Math.abs(Number(value.toFixed(decimals)) - value) > tolerance) decimals += 1;
  return String(Number(value.toFixed(decimals)));
}

function unitSuffix(display) {
  const suffix = display?.suffix ?? '';
  return /^[A-Za-z]/u.test(suffix) ? ` ${suffix}` : suffix;
}

function numberText(value, display) {
  if (typeof value !== 'number') return String(value);
  return `${trimNumber(value * (display?.scale ?? 1), display).replace('-', '−')}${unitSuffix(display)}`;
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
      return `${trimNumber(min * (display?.scale ?? 1), display).replace('-', '−')} to ${numberText(max, display)}`;
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

/** A resource reference (a media, mask or tracking id) stored as text: the card shows a picker or nothing, not a field. */
const isResourceId = (param) => param.type === 'text' && /Id$/u.test(param.key);

/**
 * The rows of an effect's card per section, in card order, with the rows of effectDocsExtras.mjs:
 * [[section, [{ key, name (the card label), label (with its "only when" note), range, default }]]].
 */
export function cardSections(effect, extras = EFFECT_DOC_EXTRAS[effect.id] ?? {}) {
  const omitted = new Set(extras.omit ?? []);
  const omittedSections = new Set(extras.omitSections ?? []);
  const known = new Map([...effect.params, ...(effect.hiddenParams ?? [])].map((param) => [param.key, param]));
  const row = (param, overrides = {}) => ({
    key: param?.key,
    name: overrides.label ?? param.label,
    label: overrides.label ?? (param.onlyWhen ? `${param.label} (${param.onlyWhen.replace(/\.$/u, '')})` : param.label),
    range: overrides.range ?? controlRange(param),
    default: overrides.default ?? controlDefault(param),
  });
  const sections = new Map();
  const add = (section, entry, before) => {
    if (!sections.has(section)) sections.set(section, []);
    const list = sections.get(section);
    const at = before ? list.findIndex((item) => item.key === before) : -1;
    list.splice(at < 0 ? list.length : at, 0, entry);
  };
  const extraRows = (extras.rows ?? []).map((entry) => (typeof entry === 'string' ? { key: entry } : entry));
  const listed = new Set(extraRows.map((entry) => entry.key).filter(Boolean));
  for (const param of effect.params) {
    if (omitted.has(param.key) || omittedSections.has(param.section) || isResourceId(param) || listed.has(param.key)) continue;
    add(param.section, row(param));
  }
  for (const entry of extraRows) {
    const param = entry.key ? known.get(entry.key) : undefined;
    if (entry.key && !param) throw new Error(`effectDocsExtras.mjs: ${effect.id} names "${entry.key}", which is no current parameter.`);
    const section = entry.section ?? param?.section ?? '';
    add(section, param ? row(param, entry) : { name: entry.label, label: entry.label, range: entry.range ?? '', default: entry.default ?? '' }, entry.before);
  }
  const order = extras.sections ?? [];
  const rank = (section) => (section === 'Quality' ? 1e6 : order.includes(section) ? order.indexOf(section) : order.length);
  return [...sections].toSorted(([a], [b]) => rank(a) - rank(b));
}

/**
 * The generated controls block (without its markers): one table, Control · Range · Default, in the
 * order of the effect card. When the card has sections, each starts with a row naming it (Quality last).
 * A card with an `open` list in effectDocsExtras.mjs keeps those sections in the table and folds the
 * others into one <details> each, so a long card stays short on a phone.
 */
export function controlsTable(effect) {
  const extras = EFFECT_DOC_EXTRAS[effect.id] ?? {};
  const sections = cardSections(effect, extras);
  if (!sections.length) {
    if (extras.note) return extras.note;
    if (effect.ownControls) return 'This effect has no standard controls; its card shows controls of its own.';
    return effect.nodeValues
      ? 'Its controls are values of its node setup: the effect card shows the ones the setup exposes.'
      : 'This effect has no controls.';
  }
  const label = (section) => tableCell(extras.sectionLabels?.[section] ?? (section || 'General'));
  const lines = (rows) => rows.map((entry) => `| ${tableCell(entry.label)} | ${tableCell(entry.range)} | ${tableCell(entry.default)} |`);
  const head = '| Control | Range | Default |\n|---|---|---|';
  const open = extras.open ? sections.filter(([section]) => extras.open.includes(section)) : sections;
  const folded = extras.open ? sections.filter(([section]) => !extras.open.includes(section)) : [];
  const named = sections.length > 1 || sections[0][0] !== '';
  const table = `${head}\n${open.flatMap(([section, rows]) => [...(named ? [`| **${label(section)}** | | |`] : []), ...lines(rows)]).join('\n')}`;
  const details = folded.map(([section, rows]) => `<details>\n<summary>${label(section)}</summary>\n\n${head}\n${lines(rows).join('\n')}\n\n</details>`);
  const ownNote = effect.ownControls && !extras.rows ? ['The effect card also has controls of its own that this table does not list.'] : [];
  return [table, ...details, ...ownNote].join('\n\n');
}

/** Why a page's generated controls blocks cannot be refreshed (a start without its end, or more than one block), or undefined. */
export function generatedBlockProblem(markdown) {
  const starts = markdown.split(CONTROLS_START).length - 1;
  const ends = markdown.split(CONTROLS_END).length - 1;
  if (starts !== ends) return `has ${starts} "${CONTROLS_START}" and ${ends} "${CONTROLS_END}" markers`;
  if (starts > 1) return `has ${starts} generated controls blocks; keep one`;
  if (starts === 1 && markdown.indexOf(CONTROLS_END) < markdown.indexOf(CONTROLS_START)) return 'has its controls end marker before the start marker';
  return undefined;
}

/** `markdown` with its generated controls block refreshed, or unchanged when it has none. */
export function refreshGeneratedBlocks(markdown, effect) {
  const start = CONTROLS_START.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const end = CONTROLS_END.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const block = `${CONTROLS_START}\n${controlsTable(effect)}\n${CONTROLS_END}`;
  // A replacer function: "$&" or "$'" in a label must stay literal text.
  return markdown.replace(new RegExp(`${start}[\\s\\S]*?${end}`, 'gu'), () => block);
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
    if (effect.presets?.length) entry.presets = effect.presets.map((preset) => preset.name);
    if (effect.presets?.length && files.exists(assets.presets)) entry.presetStrip = assets.presets;
    if (effect.presets?.length && files.exists(assets.presetsClip)) entry.presetsClip = assets.presetsClip;
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
const LAB_IMAGE_BY_GROUP = { generate: 'black', print: 'harbor_town', textile: 'harbor_town', text: 'dancer_stage', scene: 'harbor_town', pixel: 'neon_rain_street', analog: 'neon_rain_street' };
/**
 * Stills that are not a compare pair. Generators: the effect alone on black. Glyph looks: an enlarged detail of the dancer's lit dress, side by
 * side, so the characters can be read at page width. Tracking overlays: both whole frames side by side, so the
 * seam never cuts the target box in half.
 */
const LAB_SHOT_BY_GROUP = {
  // A generator draws its own picture: shown alone on black (an original beside it would show nothing).
  generate: { layout: 'single', outWidth: 1600 },
  text: { layout: 'pair', crop: [740, 140, 460, 360], zoom: 1.3, gap: 6, detail: true },
};
const LAB_SHOT_BY_ENGINE = {
  'tracking-overlay': { layout: 'pair', outWidth: 1200, gap: 6 },
};
/** Every other basic still is the pair of a compare slider: the whole frame, original | effect, without a gap. */
const COMPARE_SHOT = { layout: 'compare', outWidth: 1600 };
/** Basic stills made before the compare slider: one frame split down the middle. They stay until their page is rewritten. */
const SPLIT_SHOT = { layout: 'split', outWidth: 1200 };
/**
 * How an effect's basic still is shot. `size` is the existing still's pixel size: a still one frame wide is an
 * older split, two frames side by side a compare pair; without a still, a new one is a compare pair.
 */
export function labShot(effect, size) {
  const shot = LAB_SHOT_BY_GROUP[effect.group] ?? LAB_SHOT_BY_ENGINE[effect.engine];
  if (shot) return shot;
  return size && size.width / size.height < 2.5 ? SPLIT_SHOT : COMPARE_SHOT;
}
/** Effects a still test image cannot show; they wait for a clip on suitable footage. */
export const LAB_STILL_SKIP = {
  'face-cables': 'needs a face-tracking bake of moving footage',
  'hand-particles': 'needs tracked hands in moving footage',
  'kinetic-trace': 'needs movement to leave trails',
  'splat-exploration': 'needs a Gaussian splat clip',
  subject: 'needs tracked landmarks in moving footage',
  'tracked-scene': 'needs tracked landmarks in moving footage',
};
/** Effects without a still or thumbnail yet, and why; every other effect with a page needs both. */
export const PICTURE_PENDING = { ...LAB_STILL_SKIP, 'ai-edge-fill': 'needs a generated fill of a corrected photo (cloud credits)' };
const LAB_IMAGE_TEXT = {
  black: 'black',
  dancer_stage: 'the dancer on a dark stage',
  harbor_town: 'the harbour town',
  neon_rain_street: 'the night street with neon signs',
};
export const labImage = (effect) => LAB_IMAGE_BY_GROUP[effect.group] ?? 'dancer_stage';
export function stillAlt(effect) {
  const shot = labShot(effect);
  if (shot.layout === 'single') return `${effect.name} at its default settings, drawn on black`;
  const where = shot.detail ? `an enlarged detail of ${LAB_IMAGE_TEXT[labImage(effect)]}` : LAB_IMAGE_TEXT[labImage(effect)];
  const frames = shot.layout === 'pair' && !shot.detail ? ': the whole frame twice, ' : ': ';
  return `${effect.name} on ${where}${frames}the original on the left, ${effect.name} at its default settings on the right`;
}
/** The caption of a basic page's still. */
export function stillCaption(effect) {
  if (labShot(effect).layout === 'single') return `${effect.name} at its default settings, on black${effect.moving ? ': one frame of its movement' : ''}.`;
  const detail = labShot(effect).detail ? ' An enlarged detail, so the characters can be read.' : '';
  return `Left: the original. Right: ${effect.name} at its default settings${effect.moving ? ', one frame of its movement' : ''}.${detail}`;
}

/**
 * An Effect Lab --pairs entry for an effect's basic still: the original and the effect at its defaults.
 * `size`: the existing still's pixel size, so a reshoot keeps its layout (see labShot).
 */
export function labPair(effect, size) {
  const { detail, ...shot } = labShot(effect, size);
  void detail;
  return {
    name: effect.id,
    out: `docs/Features/${effectAssets(effect.id).still}`,
    image: labImage(effect),
    width: 1920,
    ...shot,
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
 * A basic page for an effect without a hand-written page. ctx: { groupLabel (the sidebar label, joined
 * groups as "Keying & Time"), overview (file relative to docs/Features or undefined), still (its Effect Lab
 * still, asset path, or undefined), stillSize (its pixel size: a compare pair gets a compare slider), names (id → name), groupOf(id) (its picker group), groupOrder (picker group ids in order), groupName(id) and
 * groupHref(id) (a picker group's label and overview link), hasPage(id) (whether effects/<id>.md exists, for
 * links to the other styles) }. The marker under the title carries the hash of the rest of the page.
 */
export function basicPage(effect, ctx) {
  const groupLink = ctx.overview ? `../${ctx.overview}` : `./index.md#${slug(ctx.groupLabel)}`;
  const lead = effect.description ? effect.description.trim().replace(/([^.!?])$/u, '$1.') : `${effect.name} is an effect of the ${ctx.groupLabel} group.`;
  const parts = [
    lead,
    `Group: [${ctx.groupLabel}](${groupLink}) · [How to add an effect](../Effects.md#add-an-effect)`,
  ];
  if (ctx.still) {
    const compare = labShot(effect, ctx.stillSize).layout === 'compare' ? ' docs-compare' : '';
    parts.push(`<figure class="docs-shot${compare}">\n\n![${stillAlt(effect)}](../${ctx.still})\n\n<figcaption>${stillCaption(effect)}</figcaption>\n</figure>`);
  }
  if (effect.experimental) parts.push(`**Experimental:** ${effect.experimental.trim()}`);
  parts.push('*A short page made from the editor’s effect catalog: what the effect does and its controls. Tips and its node setup will follow.*');
  if (effect.presets?.length) {
    parts.push(`**Presets:** ${effect.presets.map((preset) => preset.name).join(' · ')}. Pick one in the **Preset** row of the effect card.`);
  }
  parts.push(`## Controls\n\n${CONTROLS_START}\n${controlsTable(effect)}\n${CONTROLS_END}`);
  if (effect.styles.length) {
    // As the Style menu: the looks of the effect's own picker group by name, the other groups by name and count.
    const byName = (a, b) => (ctx.names.get(a) ?? a).localeCompare(ctx.names.get(b) ?? b);
    const look = (id) => (ctx.hasPage?.(id) ? `[${ctx.names.get(id) ?? id}](./${id}.md)` : ctx.names.get(id) ?? id);
    const near = effect.styles.filter((id) => ctx.groupOf?.(id) === effect.group).toSorted(byName);
    const others = effect.styles.filter((id) => ctx.groupOf?.(id) !== effect.group);
    const groups = (ctx.groupOrder ?? []).map((group) => [group, others.filter((id) => ctx.groupOf?.(id) === group)]).filter(([, ids]) => ids.length);
    const group = (id) => `[${ctx.groupName?.(id) ?? id}](${ctx.groupHref?.(id) ?? './index.md'})`;
    const own = near.length ? ` Looks of ${ctx.groupLabel}: ${near.map(look).join(', ')}.` : '';
    const rest = !groups.length ? ''
      : others.length <= 3 ? ` ${near.length ? 'Also' : 'Looks'}: ${groups.map(([id, ids]) => `${ids.toSorted(byName).map(look).join(', ')} (${group(id)})`).join('; ')}.`
        : ` ${near.length ? 'Further looks' : 'Looks'} under ${groups.map(([id, ids]) => `${group(id)} (${ids.length})`).join(', ')}.`;
    parts.push(`**Styles:** the **Style** menu in the effect card switches to another look of the same engine. Controls you changed keep their values and keyframes when the new look has the same control, also under another name; the others start at the new look's defaults.${own}${rest}`);
  }
  const details = [];
  if (effect.engine) details.push(`${effect.name} is one look of ${ENGINE_LABELS[effect.engine] ?? `the ${effect.engine} engine`}; its looks share one node setup.`);
  if (effect.kind === 'compute') details.push('It runs as a GPU compute effect.');
  if (effect.kind === 'particle-render') details.push('It draws GPU particles and comes last in the effect stack: effects after it are ignored.');
  if (effect.feedback) details.push('It builds on its own earlier frames, so its trails grow during playback; **History Loop** sets whether they start again when playback jumps back to the loop start.');
  else if (effect.live) details.push('It keeps moving while the playhead stands still.');
  else if (effect.moving) details.push('It changes over time: its picture depends on the playback time or on earlier frames.');
  details.push('How effects are stored, rendered and exported: [Effect system](../Effect-System.md). Its building blocks: [Node Catalog](../Node-Catalog.md).');
  parts.push(`## Technical details\n\n${details.join(' ')}`);
  const deeper = EFFECT_DOC_EXTRAS[effect.id]?.deeper ?? [];
  if (deeper.length) parts.push(`Go deeper: ${deeper.map(([text, link]) => `[${text}](${link})`).join(' · ')}`);
  const body = `${parts.join('\n\n')}\n`;
  return `# ${effect.name}\n\n${basicMarkerLine(contentHash(`# ${effect.name}\n\n${body}`))}\n\n${body}`;
}

// ---------------------------------------------------------------------------------------------
// The whole plan, shared by the script and the drift test

/**
 * What the effect docs should look like. files: { read(file) → text | undefined, exists(file), size(file) →
 * { width, height } of a picture (basic stills keep their layout), pages: ids of the existing effects/<id>.md pages }. `basic`: ids to write new basic pages for.
 * Returns { texts: Map<file, text> (every file the script owns, with its current text), catalog,
 * uncovered: visible effects without a page, unknownPages: page ids the registry lacks,
 * problems: [{ file, text }] pages left alone (a basic page edited under its marker, broken markers) }.
 */
export function planEffectDocs(snapshot, files, { basic = [] } = {}) {
  const byId = new Map(snapshot.effects.map((effect) => [effect.id, effect]));
  const names = new Map(snapshot.effects.map((effect) => [effect.id, effect.name]));
  const labels = new Map(snapshot.groups.map((group) => [group.id, group.label]));
  const overviews = groupOverviews(files.read('README.md') ?? '', snapshot.groups.map((group) => group.id));
  const texts = new Map();
  const problems = [];
  const pageText = (id) => texts.get(pageFile(id)) ?? files.read(pageFile(id));
  // Pages after this run: the existing ones plus the new basic pages (so links between them settle in one run).
  const pageIds = new Set([...files.pages, ...basic.filter((id) => byId.has(id) && !byId.get(id).hidden)]);
  const context = (effect) => ({
    groupLabel: (overviews.get(effect.group)?.joined ?? [effect.group]).map((id) => labels.get(id) ?? id).join(' & '),
    overview: overviews.get(effect.group)?.overview,
    still: files.exists(effectAssets(effect.id).still) ? effectAssets(effect.id).still : undefined,
    stillSize: files.exists(effectAssets(effect.id).still) ? files.size(effectAssets(effect.id).still) : undefined,
    names,
    groupOf: (id) => byId.get(id)?.group,
    groupOrder: snapshot.groups.map((group) => group.id),
    groupName: (id) => labels.get(id) ?? id,
    groupHref: (id) => {
      const overview = overviews.get(id)?.overview;
      return overview ? `../${overview}` : `./index.md#${slug((overviews.get(id)?.joined ?? [id]).map((group) => labels.get(group) ?? group).join(' & '))}`;
    },
    hasPage: (id) => pageIds.has(id),
  });
  for (const id of files.pages) {
    const effect = byId.get(id);
    const text = files.read(pageFile(id));
    if (!effect || text === undefined) continue;
    const file = pageFile(id);
    if (isBasicPage(text)) {
      if (basicPageEdited(text)) {
        problems.push({ file, text: `${file} was edited by hand: delete its marker line to keep the edits (it becomes a hand-written page), or restore the file.` });
      } else {
        texts.set(file, basicPage(effect, context(effect)));
      }
      continue;
    }
    const problem = generatedBlockProblem(text);
    if (problem) problems.push({ file, text: `${file} ${problem}; its controls table is not refreshed.` });
    else texts.set(file, refreshGeneratedBlocks(text, effect));
  }
  for (const id of basic) {
    const effect = byId.get(id);
    if (effect && !effect.hidden && pageText(id) === undefined) texts.set(pageFile(id), basicPage(effect, context(effect)));
  }
  const catalog = buildCatalog(snapshot, { page: pageText, exists: files.exists });
  texts.set(CATALOG_FILE, catalogJson(catalog));
  const uncovered = snapshot.effects.filter((effect) => !effect.hidden && pageText(effect.id) === undefined);
  return { texts, catalog, uncovered, problems, unknownPages: files.pages.filter((id) => !byId.has(id)) };
}
