// Checks of a hand-written effect page against the registry, shared by scripts/effect-docs.mjs and
// tests/unit/effectDocsCatalog.test.ts, so a page can never go stale silently:
//
//   ## Presets   names every preset of the effect in bold (**Heat Haze**) and shows its preset strip
//                (assets/effects/presets/<id>.webp, made by scripts/effect-lab.mjs --presets).
//   ## Controls  a page without a generated controls table (it has moved to paragraphs) gives every
//                control of the card its own paragraph, in card order: it starts with the card label in
//                bold and states the limits and default as `node scripts/effect-docs.mjs --controls <id>`
//                prints them ("2 to 80 px, default 14 px."). A card with sections has one ### per section.
//
// Rules: docs/Features/Documentation-Site.md ("Style guide", "Effect pages").
import { CONTROLS_START, cardSections, effectAssets } from './effectDocsCatalog.mjs';
import { EFFECT_DOC_EXTRAS } from './effectDocsExtras.mjs';

/** The text of a `## <title>` section (up to the next `## `), or undefined when the page has none. */
export function pageSection(markdown, title) {
  const lines = markdown.replace(/\r\n/gu, '\n').split('\n');
  const start = lines.findIndex((line) => line.trim() === `## ${title}`);
  if (start < 0) return undefined;
  const end = lines.findIndex((line, index) => index > start && /^##\s/u.test(line));
  return lines.slice(start + 1, end < 0 ? lines.length : end).join('\n');
}

/** Paragraphs of a section that start with a bold name: [{ name, text, heading }] in page order. */
function boldParagraphs(section) {
  const result = [];
  let heading = '';
  for (const block of section.split(/\n\s*\n/u)) {
    let text = block.trim();
    if (text.startsWith('###')) {
      const [title, ...rest] = text.split('\n');
      heading = title.replace(/^###\s+/u, '').trim();
      text = rest.join('\n').trim();
    }
    const name = text.match(/^\*\*([^*]+)\*\*/u)?.[1];
    if (name) result.push({ name: name.trim(), text: text.replace(/\s+/gu, ' '), heading });
  }
  return result;
}

/** The sentence a control paragraph must contain: its limits and default as the card shows them. */
export function controlFacts(row) {
  return row.range ? `${row.range}, default ${row.default}` : `default ${row.default}`;
}

const sectionLabel = (effect, section) => EFFECT_DOC_EXTRAS[effect.id]?.sectionLabels?.[section] ?? (section || 'General');

/** Paragraph skeletons for `--controls`: one per control in card order, under a ### per section. */
export function controlParagraphSkeletons(effect) {
  const sections = cardSections(effect);
  const named = sections.length > 1 || sections[0]?.[0] !== '';
  return sections.map(([section, rows]) => [
    ...(named ? [`### ${sectionLabel(effect, section)}`] : []),
    ...rows.map((row) => `**${row.name}** – what it does to the picture; how its values feel. ${controlFacts(row)}.`),
  ].join('\n\n')).join('\n\n');
}

/**
 * Problems of a hand-written page (strings, each naming what to fix). `files.exists(asset)` tells
 * whether a docs asset exists (paths relative to docs/Features).
 */
export function handWrittenPageProblems(effect, markdown, files) {
  const problems = [];
  const presets = effect.presets ?? [];
  if (presets.length) {
    const section = pageSection(markdown, 'Presets');
    if (section === undefined) problems.push(`has no "## Presets" section for its presets (${presets.map((preset) => preset.name).join(', ')})`);
    else {
      const named = boldParagraphs(section).map((paragraph) => paragraph.name);
      for (const preset of presets) if (!named.includes(preset.name)) problems.push(`## Presets has no paragraph for the preset **${preset.name}**`);
      for (const name of named) if (!presets.some((preset) => preset.name === name)) problems.push(`## Presets describes **${name}**, which is no preset of ${effect.name}`);
      const strip = effectAssets(effect.id).presets;
      if (!files.exists(strip)) problems.push(`has no preset strip ${strip}: node scripts/effect-lab.mjs --presets scripts/effect-lab-shots/presets.json --only ${effect.id}`);
      else if (!section.includes(`../${strip}`)) problems.push(`## Presets does not show the preset strip ../${strip}`);
    }
  }
  // Pages that still carry the generated table are checked by the table itself.
  if (markdown.includes(CONTROLS_START)) return problems;
  const section = pageSection(markdown, 'Controls');
  if (section === undefined) return [...problems, 'has neither a generated controls table nor a "## Controls" section'];
  const sections = cardSections(effect);
  const rows = sections.flatMap(([cardSection, list]) => list.map((row) => ({ ...row, section: sectionLabel(effect, cardSection) })));
  const paragraphs = boldParagraphs(section);
  const named = sections.length > 1 || sections[0]?.[0] !== '';
  for (const row of rows) {
    const paragraph = paragraphs.find((candidate) => candidate.name === row.name);
    if (!paragraph) { problems.push(`## Controls has no paragraph for **${row.name}** (${controlFacts(row)})`); continue; }
    if (!paragraph.text.includes(controlFacts(row))) problems.push(`## Controls: the paragraph for **${row.name}** must state "${controlFacts(row)}"`);
    if (named && paragraph.heading !== row.section) problems.push(`## Controls: **${row.name}** belongs under "### ${row.section}"`);
  }
  // The card's Style menu (other looks of its engine) and Preset row are no parameters, but may have a paragraph.
  const cardRows = [...(effect.styles?.length ? ['Style'] : []), ...(presets.length ? ['Preset'] : [])];
  for (const paragraph of paragraphs) {
    if (!rows.some((row) => row.name === paragraph.name) && !cardRows.includes(paragraph.name)) {
      problems.push(`## Controls describes **${paragraph.name}**, which the card does not show`);
    }
  }
  const order = paragraphs.map((paragraph) => paragraph.name).filter((name) => rows.some((row) => row.name === name));
  const expected = rows.map((row) => row.name).filter((name) => order.includes(name));
  if (order.join('|') !== expected.join('|')) problems.push(`## Controls: put the paragraphs in card order (${expected.join(', ')})`);
  return problems;
}
