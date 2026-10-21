// The "## Documentation Index" of docs/Features/README.md defines the /docs sidebar.
// Pure functions: the sync passes in which pages exist and gets the Starlight sidebar,
// the unpublished pages and its notes back.
//
// Index syntax (one heading level per sidebar level):
//   ### Group                              a top-level sidebar group, in README order
//   | [Label](./Page.md) | … |             one entry; the link text is the sidebar label
//   #### Subgroup                          a nested group (collapsed); the rows below it belong to it
//   <!-- docs-sidebar: collapsed -->       under ###: start the group collapsed
//   <!-- docs-sidebar: expanded -->        under ####: start the subgroup expanded
//   <!-- docs-sidebar: effect-groups keying+time -->
//                                          one collapsed subgroup per app picker group, in picker
//                                          order (ids joined by + share one subgroup). The table
//                                          rows below it name a group id in their second cell
//                                          (`| [Overview](./Effects-Blur.md) | `blur` | … |`) and
//                                          lead that subgroup; effects/<id>.md pages follow.
//   <!-- docs-sidebar: unpublished -->     the group's pages stay in the repo but are not rendered
// Rows inside other HTML comments are planned pages: they are counted, not listed.

import { pageSlug, resolveFrom, sitePageSlug } from './routes.mjs';

const DIRECTIVE = /^<!--\s*docs-sidebar:\s*(.+?)\s*-->$/iu;
const ROW = /^\|\s*\[([^\]]+)\]\(([^)\s]+)\)\s*\|(.*)$/u;

/** Sections of the index: [{ label, collapsed, unpublished, planned, blocks }] plus parser notes. */
export function readIndexSections(markdown) {
  const sections = [];
  const notes = [];
  let inIndex = false;
  let inComment = false;
  let section;
  let block;
  const rowsBlock = () => {
    if (!block) {
      block = { kind: 'rows', rows: [] };
      section.blocks.push(block);
    }
    return block;
  };
  for (const raw of markdown.split(/\r?\n/u)) {
    const line = raw.trim();
    if (inComment) {
      if (section && ROW.test(line)) section.planned += 1;
      if (line.includes('-->')) inComment = false;
      continue;
    }
    if (/^##\s/u.test(raw)) {
      inIndex = /^##\s+Documentation Index\s*$/iu.test(raw);
      section = block = undefined;
      continue;
    }
    if (!inIndex) continue;
    const directive = line.match(DIRECTIVE);
    if (directive) {
      if (!section) {
        notes.push({ level: 'warn', text: `Index: "${line}" stands before the first ### group; ignored.` });
        continue;
      }
      const [keyword, ...args] = directive[1].split(/\s+/u);
      const word = keyword.toLowerCase();
      if (word === 'collapsed' || word === 'expanded') {
        const target = block?.kind === 'group' ? block : section;
        target.collapsed = word === 'collapsed';
      } else if (word === 'unpublished') {
        section.unpublished = true;
      } else if (word === 'also') {
        // The rows below may repeat a page that an earlier section lists (a second way in, e.g. Using effects).
        block = { kind: 'rows', rows: [], also: true };
        section.blocks.push(block);
      } else if (word === 'effect-groups') {
        block = { kind: 'effects', merges: args.map((arg) => arg.split('+').filter(Boolean)), rows: [] };
        section.blocks.push(block);
      } else {
        notes.push({ level: 'warn', text: `Index: unknown sidebar directive "${line}" under "${section.label}"; ignored.` });
      }
      continue;
    }
    if (line.startsWith('<!--')) {
      if (section && ROW.test(line.replace(/^<!--\s*/u, ''))) section.planned += 1;
      if (!line.includes('-->')) inComment = true;
      continue;
    }
    const groupHeading = raw.match(/^###\s+(.+?)\s*$/u);
    if (groupHeading) {
      section = { label: groupHeading[1], collapsed: false, unpublished: false, planned: 0, blocks: [] };
      block = undefined;
      sections.push(section);
      continue;
    }
    const subgroupHeading = raw.match(/^####\s+(.+?)\s*$/u);
    if (subgroupHeading && section) {
      block = { kind: 'group', label: subgroupHeading[1], collapsed: true, rows: [] };
      section.blocks.push(block);
      continue;
    }
    const row = line.match(ROW);
    if (!row || !section) continue;
    const cells = row[3].split('|').map((cell) => cell.trim());
    const target = block ?? rowsBlock();
    target.rows.push({ label: row[1].trim(), target: row[2], cells });
  }
  return { sections, notes };
}

/**
 * The effect-groups block of the index: { merges ([["keying", "time"]]), overviews: Map<groupId, file> }
 * (the overview page of each picker group; joined groups share theirs).
 */
export function effectGroupIndex(sections) {
  const block = sections.flatMap((section) => section.blocks).find((entry) => entry.kind === 'effects');
  const overviews = new Map();
  if (!block) return { merges: [], overviews };
  for (const row of block.rows) {
    const id = row.cells[0]?.replace(/`/gu, '').trim();
    const file = rowTarget(row.target)?.file;
    if (!id || !file || overviews.has(id)) continue;
    for (const member of block.merges.find((ids) => ids.includes(id)) ?? [id]) if (!overviews.has(member)) overviews.set(member, file);
  }
  return { merges: block.merges, overviews };
}

/** What an index row links to: a docs/Features page (`file`) or a hand-written site page (`site`). */
export function rowTarget(target) {
  const clean = target.split('#')[0];
  if (!clean) return undefined;
  const resolved = resolveFrom('README.md', clean);
  const site = sitePageSlug(resolved);
  if (site !== undefined) return { site };
  if (pageSlug(resolved) !== undefined) return { file: resolved };
  return undefined;
}

const groupKey = (ids) => ids.join('-').toLowerCase();

/** Picker groups after `merges` ([["keying", "time"]]): [{ ids, key, label, effects }]. */
export function mergeEffectGroups(groups, merges = [], notes = []) {
  const merged = [];
  const used = new Map();
  for (const ids of merges) {
    const members = ids.map((id) => groups.find((group) => group.id === id));
    const missing = ids.filter((_, index) => !members[index]);
    if (missing.length) {
      notes.push({ level: 'warn', text: `Index: effect-groups merge "${ids.join('+')}" names unknown picker group(s) ${missing.join(', ')}; not merged.` });
      continue;
    }
    const entry = { ids, label: members.map((group) => group.label).join(' & '), effects: members.flatMap((group) => group.effects) };
    for (const id of ids) used.set(id, entry);
  }
  for (const group of groups) {
    const entry = used.get(group.id) ?? { ids: [group.id], label: group.label, effects: group.effects };
    if (!merged.includes(entry)) merged.push(entry);
  }
  return merged.map((entry) => ({ ...entry, key: groupKey(entry.ids) }));
}

/**
 * Build the Starlight sidebar.
 *   sections   readIndexSections(...).sections
 *   pages      every docs/Features source page that exists (README.md, X.md, guides/x.md, effects/x.md)
 *   sitePages  slugs of the hand-written site pages ('getting-started/welcome', …)
 *   effectGroups  picker groups [{ id, label, effects }] in picker order (hidden effects removed)
 *   effectNames   Map<effect id, display name> (optional)
 * Returns { sidebar, unpublished: Set<file>, notes: [{ level: 'warn' | 'info', text }] }.
 */
export function buildSidebar({ sections, pages, sitePages = new Set(), effectGroups = [], effectNames = new Map() }) {
  const notes = [];
  const pageSet = new Set(pages);
  const unpublished = new Set();
  for (const section of sections.filter((entry) => entry.unpublished)) {
    for (const row of section.blocks.flatMap((entry) => entry.rows)) {
      const target = rowTarget(row.target);
      if (target?.file && pageSet.has(target.file)) unpublished.add(target.file);
      else notes.push({ level: 'warn', text: `Sidebar: "${section.label}" (unpublished) lists ${row.target}, which is no docs/Features page; skipped.` });
    }
  }

  // Entries: { label?, file } or { label, site }. `placed` remembers where each page went.
  const placed = new Map();
  const accept = (row, where, also = false) => {
    const target = rowTarget(row.target);
    if (!target) {
      notes.push({ level: 'warn', text: `Sidebar: "${where}" links ${row.target}, which is neither a docs/Features page nor a docs-site page; skipped.` });
      return undefined;
    }
    if (target.site !== undefined) {
      if (!sitePages.has(target.site)) {
        notes.push({ level: 'warn', text: `Sidebar: "${where}" links the site page ${row.target}, which does not exist; skipped.` });
        return undefined;
      }
      return { label: row.label, site: target.site };
    }
    if (!pageSet.has(target.file)) {
      notes.push({ level: 'warn', text: `Sidebar: the index lists ${target.file} under "${where}", but the page does not exist; skipped.` });
      return undefined;
    }
    if (unpublished.has(target.file)) {
      notes.push({ level: 'warn', text: `Sidebar: ${target.file} is unpublished and also listed under "${where}"; it stays unpublished.` });
      return undefined;
    }
    if (placed.has(target.file)) {
      if (also) return { label: row.label, file: target.file };
      notes.push({ level: 'warn', text: `Sidebar: ${target.file} is listed under "${placed.get(target.file)}" and again under "${where}"; kept the first row.` });
      return undefined;
    }
    placed.set(target.file, where);
    return { label: row.label, file: target.file };
  };

  const publicSections = sections.filter((section) => !section.unpublished);
  const groups = publicSections.map((section) => ({
    label: section.label,
    collapsed: section.collapsed,
    planned: section.planned,
    blocks: section.blocks.map((block) => {
      if (block.kind === 'rows') return { kind: 'rows', entries: block.rows.map((row) => accept(row, section.label, block.also)).filter(Boolean) };
      if (block.kind === 'group') {
        const where = `${section.label} › ${block.label}`;
        return { kind: 'group', label: block.label, collapsed: block.collapsed, entries: block.rows.map((row) => accept(row, where)).filter(Boolean) };
      }
      const merged = mergeEffectGroups(effectGroups, block.merges, notes);
      if (!merged.length) notes.push({ level: 'warn', text: `Sidebar: "${section.label}" asks for effect groups, but no effect catalog was found; only its rows are listed.` });
      const subgroups = merged.map((group) => ({ ...group, entries: [] }));
      const loose = [];
      for (const row of block.rows) {
        const id = row.cells[0]?.replace(/`/gu, '').trim();
        const home = subgroups.find((group) => group.ids.includes(id));
        if (!home) notes.push({ level: 'warn', text: `Sidebar: ${row.target} under "${section.label}" names no known effect group ("${id ?? ''}"); listed above the effect groups.` });
        const entry = accept(row, home ? `${section.label} › ${home.label}` : section.label);
        if (entry) (home ? home.entries : loose).push(entry);
      }
      return { kind: 'effects', loose, subgroups };
    }),
  }));

  const effectsBlock = groups.flatMap((group) => group.blocks).find((block) => block.kind === 'effects');
  const effectsGroup = groups.find((group) => group.blocks.includes(effectsBlock));
  const groupWith = (test) => groups.find((group) => group.blocks.some((block) => block.entries?.some((entry) => entry.file && test(entry.file))));
  const firstRows = (group) => {
    let block = group.blocks.find((entry) => entry.kind === 'rows');
    if (!block) {
      block = { kind: 'rows', entries: [] };
      group.blocks.unshift(block);
    }
    return block.entries;
  };
  const insertAfterFamily = (entries, file, test) => {
    const last = entries.findLastIndex((entry) => entry.file && test(entry.file));
    entries.splice(last + 1, 0, { file });
  };

  // Effect pages join their picker group's subgroup after its rows, in picker order.
  if (effectsBlock) {
    for (const group of effectsBlock.subgroups) {
      for (const id of group.effects) {
        const file = `effects/${id}.md`;
        if (!pageSet.has(file) || unpublished.has(file) || placed.has(file)) continue;
        placed.set(file, `${effectsGroup.label} › ${group.label}`);
        group.entries.push({ label: effectNames.get(id), file, effect: true });
      }
    }
  }

  // Pages without a row: family rules, else "More". Each one is reported.
  const more = [];
  const unlisted = pages.filter((file) => file !== 'README.md' && !placed.has(file) && !unpublished.has(file)).toSorted();
  for (const file of unlisted) {
    let where;
    const categoryName = file.match(/^Effects-(.+)\.md$/u)?.[1]?.toLowerCase();
    const subgroup = categoryName && effectsBlock?.subgroups.find((group) => group.key === categoryName || group.ids.includes(categoryName));
    if (subgroup) {
      const rows = subgroup.entries.filter((entry) => !entry.effect).length;
      subgroup.entries.splice(rows, 0, { file });
      where = `${effectsGroup.label} › ${subgroup.label}`;
    } else if (file === 'effects/index.md' && effectsGroup) {
      firstRows(effectsGroup).unshift({ file });
      where = effectsGroup.label;
    } else if ((categoryName || file.startsWith('effects/')) && (effectsGroup ?? groupWith((name) => name === 'Effects.md'))) {
      const home = effectsGroup ?? groupWith((name) => name === 'Effects.md');
      insertAfterFamily(firstRows(home), file, (name) => name.startsWith('Effects') || name.startsWith('effects/'));
      where = home.label;
    } else if (file.startsWith('Transitions-') && groupWith((name) => name === 'Transitions-Dissolve.md')) {
      const home = groupWith((name) => name === 'Transitions-Dissolve.md');
      const block = home.blocks.find((entry) => entry.entries?.some((item) => item.file === 'Transitions-Dissolve.md'));
      insertAfterFamily(block.entries, file, (name) => name.startsWith('Transitions-'));
      where = home.label;
    } else if (file.startsWith('guides/') && (groupWith((name) => name.startsWith('guides/')) ?? groups.find((group) => /^guides$/iu.test(group.label)))) {
      const home = groupWith((name) => name.startsWith('guides/')) ?? groups.find((group) => /^guides$/iu.test(group.label));
      firstRows(home).push({ file });
      where = home.label;
    } else {
      more.push({ file });
      where = 'More';
    }
    placed.set(file, where);
    notes.push({ level: 'warn', text: `Sidebar: ${file} has no row in the feature index; placed in "${where}"${where === 'More' ? '' : ' by its name'}. Add a row to docs/Features/README.md.` });
  }

  const item = (entry) => {
    if (entry.site !== undefined) return entry.site ? { label: entry.label, slug: entry.site } : { label: entry.label, link: '/' };
    return { ...(entry.label ? { label: entry.label } : {}), slug: pageSlug(entry.file) };
  };
  const emptyEffectGroups = [];
  const sidebar = [];
  for (const group of groups) {
    const items = group.blocks.flatMap((block) => {
      if (block.kind === 'rows') return block.entries.map(item);
      if (block.kind === 'group') {
        if (!block.entries.length) {
          notes.push({ level: 'warn', text: `Sidebar: the subgroup "${group.label} › ${block.label}" lists no existing page; left out.` });
          return [];
        }
        return [{ label: block.label, collapsed: block.collapsed, items: block.entries.map(item) }];
      }
      return [
        ...block.loose.map(item),
        ...block.subgroups.flatMap((subgroup) => {
          if (!subgroup.entries.length) {
            emptyEffectGroups.push(subgroup.label);
            return [];
          }
          return [{ label: subgroup.label, collapsed: true, items: subgroup.entries.map(item) }];
        }),
      ];
    });
    if (!items.length) {
      notes.push(group.planned
        ? { level: 'info', text: `Sidebar: "${group.label}" has no published page yet (${group.planned} planned); left out.` }
        : { level: 'warn', text: `Sidebar: the index section "${group.label}" lists no existing page; group left out.` });
      continue;
    }
    sidebar.push({ label: group.label, ...(group.collapsed ? { collapsed: true } : {}), items });
  }
  if (emptyEffectGroups.length) notes.push({ level: 'info', text: `Sidebar: effect groups without pages yet: ${emptyEffectGroups.join(', ')}.` });
  if (more.length) sidebar.push({ label: 'More', items: more.map(item) });
  return { sidebar, unpublished, placed, notes };
}

/** Number of page links in a sidebar, nested groups included. */
export function countSidebarPages(items) {
  return items.reduce((sum, entry) => sum + (entry.items ? countSidebarPages(entry.items) : 1), 0);
}
