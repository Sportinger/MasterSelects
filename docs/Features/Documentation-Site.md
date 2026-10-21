# Documentation Website

For developers and agents who write or build the documentation. MasterSelects publishes its product documentation at `https://www.masterselects.com/docs/`, as part of the main website. The editor's **Info > Documentation** action opens that page in a new browser tab.

## Style guide

The short version for everyone who writes a page or makes its pictures. The sections below hold the details.

**Voice.** Less is more. Write for a video artist, not for a developer: everyday words, short sentences, present tense, "you". Say what something does and what it is for before saying how it works. Facts come from the code and the running editor, not from older docs.

**Three layers on every page.**

1. **Top:** what it is and what it is for, one picture beside the text, the key controls or steps and one tip. A reader who stops here can use it.
2. **Middle:** how it is built: node graph pictures, editor excerpts with numbered callouts, one change to try (**Remix:**).
3. **Bottom:** `## Technical details`: units, limits, saved projects and links to the developer pages. Code paths appear only here.

Each page type has a fixed template: [Page templates](#page-templates).

**Which visual.**

| The page shows | Medium | Made with |
|---|---|---|
| A filter (it changes the clip's picture) whose look is static | a [compare slider](#compare-sliders) on a still: drag the line between original and effect | `scripts/effect-lab.mjs --pairs`, `"layout": "compare"` |
| A filter that moves or depends on time | a compare slider on a short loop of moving footage | `scripts/doc-clip.mjs`, `"layout": "compare"` |
| A generator (it draws its own picture or 3D structure: Weave, Flocking, Stick Figure) | the effect alone on black, no compare: a still, or a loop when it moves | `scripts/effect-lab.mjs`, `scripts/doc-clip.mjs` |
| The presets of an effect | a strip of small stills, one per preset, labelled with its name (no compare) | `scripts/effect-lab.mjs --presets` |
| How to do something in the editor (add, drag, trim) | a clip with a visible pointer | `scripts/doc-clip.mjs`, `"kind": "operation"` |
| A part of the editor (inspector, panel) | a still with yellow numbered callouts | `scripts/effect-editor-shot.mjs` |
| A node graph | a graph picture | `scripts/effect-graph-shot.mjs` |
| Tracks, time, before and after | an inline SVG diagram | by hand ([Diagrams](#pictures-clips-diagrams-and-galleries)) |

- **No GIFs.** Motion is an MP4 (H.264, muted, no audio) with a WebP poster. The site plays it only while it is on screen and shows the poster under reduced motion.
- **Motion only where motion is the point.** One still or loop at the top of an effect page; an operation clip only where the page explains how to do something.
- **Loops** last 3–6 s and run seamlessly (the end fades into the start). They use the shared moving footage `dancer_stage_motion.mp4`, which is not in the repository (`--media <folder>`).
- **Stills** use the shared Effect Lab images in `tests/browser/effect-lab/images/` (`dancer_stage`, `harbor_town`, `neon_rain_street`, `greenscreen_dancer`). Pick the one on which the effect reads best.
- **Operation clips** are recorded in the real editor: the drawn pointer moves in eased arcs and ripples on every click. They are cropped to the panels that matter. Keep the real mouse off the recording window.
- **Default settings**, unless the caption names the changed values ("Left: original. Right: Radius 12.").
- **Yellow callouts.** Every picture of the editor points at what the text talks about with yellow numbered circles and arrows (`scripts/docShotFigure.mjs`, through `effect-editor-shot.mjs` and `effect-graph-shot.mjs`): one number per control or step, at most about five per picture. The caption explains every number. On the site the callouts rest at 10 % and light up from their word (`docs-site/src/scripts/docsCallouts.js`): hovering the bold name in the text, or `N — Label` in the caption, brings the callout to full strength and draws a line with right-angle corners from the word to its number. So write the caption as `1 — Preset: what it does. 2 — Band Size.` and use exactly that name in bold in the same section (`**Band Size** – …`).
- **Alt text** says what the picture shows; the caption names every callout number.
- **Look at every new picture and clip yourself** (a contact sheet for a batch) before you commit it. A broken or too dark render is not published: name it in `PICTURE_PENDING` (`scripts/effectDocsCatalog.mjs`) instead.

**Controls: one short paragraph each, never a bare list of values.** A table of names and numbers tells a reader little. Give every control of an effect or feature its own small paragraph, in the order of the card, under a `###` heading for each section of the card:

1. its name in bold, exactly as the card shows it;
2. what it does to the picture and what it is good for, in everyday words;
3. how its values feel: where it starts to show, a typical value, what the extreme does, and which neighbour it works with;
4. its limits: the lowest and highest value it accepts, the unit and the default. They differ for every effect, so take them from the code (`node scripts/effect-docs.mjs --controls <id>` prints them), never from memory. A switch says "On or off, default off"; a choice list names each choice with what it does.

```markdown
**Radius** – how soft the picture gets. 2–5 takes the edge off, 10 is clearly out of focus,
30 and more turns shapes into light. Animate it from 0 for a focus pull.
0 to 50 pixels, default 10.
```

**Presets.** Every effect comes with presets: three to five named starting points that show the range of what it can do. They belong to the effect itself (`presets` in its definition, [Effect system](./Effect-System.md#contracts-and-invariants)) and are picked in the **Preset** row of its card; an effect without presets gets some built, and checked in renders, before its page is written. Name a preset after the picture it makes ("Heat Haze", "Rain Curtain"), not after its values. The page lists every preset under `## Presets`: the preset strip in a `docs-shot docs-shot--detail` figure (`node scripts/effect-lab.mjs --presets scripts/effect-lab-shots/presets.json --only <id>`, which reads names and values from the registry), one sentence on the Preset row, then one short paragraph per preset that starts with its name in bold: what it looks like and when to use it.

**Formatting.**

- A picture is `<figure class="docs-shot">` with a `<figcaption>`; `docs-shot--float-right` or `--float-left` puts the top picture beside the text.
- A filter's picture is a compare: `docs-compare` on the figure around its pair ([Compare sliders](#compare-sliders)).
- Tables have at most four short columns.
- No manual table of contents and no change-log wording.
- Details: [Pictures, clips, diagrams and galleries](#pictures-clips-diagrams-and-galleries).

**Budgets.**

| Asset | Limit |
|---|---|
| Pictures | WebP ≤ 200 KB and ≤ 1600 px wide |
| Gallery thumbnails | ≤ 30 KB |
| Clips | ≤ 1.5 MB and ≤ 12 s |
| A whole page | about 600 KB per effect page, 1.5 MB per guide |

The tools encode to fit, and the sync warns about anything over. Reshoot only when the UI visibly changed: every reshoot stays in the Git history.

**Before you commit.**

1. For effect pages: `node scripts/effect-docs.mjs` (it also reports a hand-written page whose control or preset paragraphs no longer match the card), then `npx vitest run tests/unit/effectDocsCatalog.test.ts tests/unit/docsSiteSync.test.ts`.
2. `npm run sync` in `docs-site/` must report no new warnings (links, alt text, posters, budgets).
3. Open the changed pages in a docs dev server on a free port (`npx astro dev --port <port>` in `docs-site/`), 1440 px and 420 px wide. Check that there is no sideways scrolling, the pictures load, floats drop below the text on a phone and the clips play.
4. Commit only the sources and assets. The site files are generated and untracked ([Generated output](#generated-output)).

## Sources and URLs

`docs/Features/` is the single source of truth. `docs-site/` renders it with Astro Starlight; `docs-site/scripts/sync-features.mjs` converts the pages before every dev start and build.

| Source in `docs/Features/` | Published at | Template |
|---|---|---|
| `README.md`, the part above `## Documentation Index` | `/docs/getting-started/overview/` | – |
| `<Page>.md` | `/docs/features/<page>/` (lower case) | D or E |
| `guides/<slug>.md` | `/docs/guides/<slug>/` | A |
| `effects/<effect-id>.md` | `/docs/effects/<effect-id>/` | B |
| `effects/index.md` | `/docs/effects/` | the effect catalog |
| `Effects-<Group>.md` | `/docs/features/effects-<group>/` | C |
| `assets/**` | `/docs/assets/**` | pictures, clips, posters, captions |

- Published URLs stay. Do not rename a published file for looks; a move needs an entry in `redirects.json` (see Redirects).
- Effect pages use the registry id, so their URL survives a new display name.
- Write links relative to the file that contains them, with their anchor: `../Effects.md#order-matters`, `./box-blur.md`, `../assets/effects/glow.webp`. The sync turns them into site routes. Links to files outside `docs/Features` (source code, the project README) and to unpublished pages keep only their text.
- The repo-internal `[Back to …](./README.md)` lines are removed wherever they stand. New pages do not need them.

## Sidebar

The `## Documentation Index` of `docs/Features/README.md` is the sidebar. The sync writes it to `docs-site/src/generated/sidebar.json`, which `docs-site/astro.config.mjs` reads; a running `astro dev` restarts when it changes.

- Each `###` section is one sidebar group, in README order. Each table row is one entry, labelled with its link text. A row can also link a hand-written site page: `[Welcome](../../docs-site/src/content/docs/getting-started/welcome.md)`.
- `####` under a section starts a nested group. It is collapsed; the rows below it belong to it.
- Directives on their own line under a heading:

| Directive | Effect |
|---|---|
| `<!-- docs-sidebar: collapsed -->` | Under `###`: the group starts collapsed. Starlight still opens the group of the current page. |
| `<!-- docs-sidebar: expanded -->` | Under `####`: the subgroup starts open. |
| `<!-- docs-sidebar: effect-groups keying+time -->` | One collapsed subgroup per picker group of the app, labelled and ordered like the picker (`EFFECT_GROUPS` in `src/effects/effectCatalogGroups.ts`). Ids joined by `+` share one subgroup ("Keying & Time"). The rows below the directive give their group id as the second cell (for example `` `blur` ``) and lead that subgroup; the existing `effects/<id>.md` pages follow in picker order, labelled with their catalog name. Subgroups without pages are left out. |
| `<!-- docs-sidebar: also -->` | The rows below may repeat a page another group already lists, as a second way in (Using effects leads the Effects group and stays under Guides). Anywhere else a repeated row is reported and skipped. |
| `<!-- docs-sidebar: unpublished -->` | The section's pages stay in the repo but are not rendered, not searchable and not in the sidebar. Links to them become plain text. |

- Rows inside other HTML comments are planned pages: the sync counts them and does not list them. Move a row out of its comment when its page exists; the sync never lists a missing page.
- Pages without a row are placed by name and reported: `Effects-<group>.md` joins the matching effect subgroup (else the Effects group), `effects/<id>.md` its picker group, `Transitions-*.md` the group of `Transitions-Dissolve.md`, `guides/*.md` the Guides group. Every other page lands in a final **More** group.
- Expanded by default: Getting Started, Guides, Live and Stage and Effects (its subgroups stay collapsed). The reference groups and Developers are collapsed.

## Page templates

Simple at the top, deeper below. Every page ends in a fixed order, the deep parts always last.

- **A. Guide** (`guides/<slug>.md`, ≤ 600 words, 3–6 annotated pictures). One sentence on what the reader will do, then "Try it interactively: **Info → Tutorials → …**" when an in-app tutorial exists. Numbered steps, each with its picture or clip. An "I want to… / Do this" table. It ends with "Go deeper:" links to the reference pages.
- **B. Effect page** (`effects/<effect-id>.md`). What the effect does, one picture, its key controls in everyday words and a tip; then `## Presets`, `## Controls` (one paragraph per control), `## Node setup` and `## Technical details`. The full contract with an example: [Effect pages](#effect-pages).
- **C. Effect group overview** (`Effects-<Group>.md`). The title is the picker label. One sentence and where to add an effect, then `<!-- docs-gallery: <group-id> -->`, then `## Which one?` (Look → Use), `## The shared idea` (one group graph) and `## Technical details`. The effects themselves are described on their effect pages, not here.
- **D. Feature reference** (`<Page>.md`). One sentence and a link to its guide, an annotated picture, then `## Options` (one paragraph per control in UI order, with its limits and default, as in the [Style guide](#style-guide)), the formats or other lists the feature needs, `## Limits` in plain words and `## Technical details` (short, or a link to the developer page).
- **E. Developer page** (Developers group). "For developers and agents. User docs: …", then `## Architecture` (with a diagram), `## Key files` (table), `## Contracts and invariants`, `## Tests` and `## Debugging`.

Rules for every page:

- No change-log wording ("in this update", "rebuilt", "fixed"). Put a new fact in the section it belongs to, never after Sources or Limitations.
- No manual table of contents: Starlight shows "On this page".
- User pages hold no internals. Code paths, store and test names, issue numbers, model IDs and kernel terms go under "Technical details" or into the Developers group. Credit prices and model lists live on one page.
- Facts follow the code: counts come from the effect catalog or are left out; menu paths are copied from the component labels; check pages against the running editor, not against older docs.
- Tables have at most four short columns, so they fit a phone.

## Effect pages

Every effect has one page: `docs/Features/effects/<effect-id>.md`, published at `/docs/effects/<effect-id>/`. The id is the registry id (`catalog.json` lists them all); the URL stays when the display name changes. The sync puts the page into the sidebar subgroup of its picker group, in picker order and labelled with the catalog name, so it needs no README row. The group overview (template C) leads that subgroup; the [Effect catalog](./effects/index.md) shows all effects as cards.

**Who writes what.**

| Part | Made by |
|---|---|
| `effects/catalog.json`: names, groups, card text, page, still, clip, thumbnail and preset strip paths, preset names | `node scripts/effect-docs.mjs` (never by hand) |
| The controls table between `<!-- generated:controls start -->` and `<!-- generated:controls end -->` (basic pages, and hand-written pages not yet moved to paragraphs) | the same script, refreshed on every run |
| Basic pages (marked `<!-- effect-docs: basic page sha=… -->` as the first line under the title) | the same script, rewritten on every run while the page still matches the marker's hash |
| Rows of an effect's own card, the section order and folding of long cards, "Go deeper" links of basic pages, special thumbnails | `scripts/effectDocsExtras.mjs` (by hand, per effect id) |
| Everything else on a page | by hand; the script never changes it |

- After you add or rewrite an effect page, add a picture or change an effect's parameters, run `node scripts/effect-docs.mjs` and commit what it changes. `npx vitest run tests/unit/effectDocsCatalog.test.ts` fails when the catalog, a controls block or a basic page is out of date, when a page is not named after an effect id, when a visible effect has no page of its own, when a basic page was edited under its marker or a page's controls markers are broken, or when an effect lacks a still or a thumbnail (unless `PICTURE_PENDING` in `scripts/effectDocsCatalog.mjs` names why) or a thumbnail is over 30 KB.
- **A basic page edited by hand.** The marker line carries a hash of the page as the script wrote it. When the page no longer matches it, the script leaves the page alone and reports `effects/<id>.md was edited by hand: delete its marker line to keep the edits (it becomes a hand-written page), or restore the file`; the drift test fails with the same text. The marker counts only as the first line under the `#` title.
- To write a page by hand, start from its basic page and delete the marker line, or write the file before running the script. `node scripts/effect-docs.mjs --controls <id>` prints the controls table, one paragraph skeleton per control under its `###` section with the limits sentence filled in ("2 to 80 px, default 14 px."), and the presets with their values: the source for the paragraphs.
- **The paragraph check.** When a hand-written page replaces its generated table with paragraphs (it deletes the block with both markers), `node scripts/effect-docs.mjs` and the drift test check its `## Controls`: one paragraph per card control, starting with the card label in bold, in card order, under the `###` of its card section, and stating its limits sentence exactly as `--controls` prints it. A paragraph for a control the card no longer shows fails too; **Style** and **Preset** paragraphs are allowed. For an effect with presets, every hand-written page needs `## Presets` with a bold paragraph per preset (and none for a preset that is gone) and the preset strip `../assets/effects/presets/<id>.webp`. A changed limit, label or preset therefore fails the test until the page says so (`scripts/effectDocsPageCheck.mjs`).
- `--basic` writes basic pages for every visible effect without a page (`--basic halftone,print` for chosen effect or group ids); it never touches an existing page. `--thumbs` makes the missing gallery thumbnails (`assets/effects/thumbs/<id>.webp`, 400 × 250 or smaller, ≤ 30 KB) from the effect half of each still; `--thumbs --force` remakes them all, `--thumbs --force text,riso` only those effect or group ids. An effect's `thumb` in `effectDocsExtras.mjs` picks another region of the still (`region`, fractions of it) or names the Effect Lab file that renders the thumbnail (`shot`, such as `scripts/effect-lab-shots/color-thumbs.json`: the dancer split down the middle for the subtle tonal effects). `--lab-manifest <file>` writes an Effect Lab `--pairs` manifest for basic pages without a still, `--reshoot <ids or groups>` adds basic pages that have one. Basic stills are a whole-frame split, except the Text & Glyph looks (an enlarged detail of the dancer, original and effect side by side, so the characters can be read) and the tracking overlays (both whole frames side by side, so the seam never cuts the target box).
- **The generated controls table** lists the card's rows in card order with their range and default. Ranges and defaults show as many decimals as they need. Resource references stored as text (`…Id` parameters) are left out. `effectDocsExtras.mjs` adds what the registry cannot say: `rows` of an effect's own card (hidden parameters it renders, buttons, pickers), the card's `sections` order and `sectionLabels`, `omit`/`omitSections`, a `note` for cards without fixed rows, and `open`: only those sections stay in the table, every other one folds into its own `<details>` (Slit Scan). It also gives basic pages `deeper` links ("Go deeper:" under Technical details).
- The card text is the first sentence of a hand-written page (a basic page uses the first clause of the in-app description), so write that sentence to stand alone, in under about 110 characters.
- `catalog.json` has one line per effect. On a merge conflict, take either side and run the script again.
- **Controls that act.** A control the docs list must change the picture: `tests/unit/effectControlsRead.test.ts` fails when a shown parameter is not read by the effect (see [Effect system: contracts](./Effect-System.md#contracts-and-invariants)). Retire such a parameter in the effect instead of documenting it.

**The page, top to bottom.** No YAML front matter: the title is the `#` heading, the sync writes the front matter.

1. `# <Name>`, exactly the catalog name.
2. One or two sentences: what it does and what for, in everyday words. The first one becomes the card text.
3. `Group: [<picker label>](../Effects-<Group>.md) · [How to add an effect](../Effects.md#add-an-effect)`. Without an overview page, link the catalog section: `./index.md#print--halftone`.
4. One picture with a caption. A filter gets a [compare slider](#compare-sliders): a still pair (`scripts/effect-lab.mjs --pairs`, `"layout": "compare"`, saved as `../assets/effects/<id>.webp`) or, when it moves or depends on time (catalog `moving`), a loop pair on moving footage (`scripts/doc-clip.mjs`, `"layout": "compare"`, `../assets/effects/clips/<id>.mp4` with its `.webp` poster). A generator shows its effect alone on black. Pages that still show a split still or a pair with a gap keep it until they are converted; reuse an existing compare pair, make a new one when the page is written or rewritten.
5. `**Use it for:**` two or three uses, then two to four key controls, one line each in everyday words (`- **Radius** – how soft it gets.`; their full paragraphs follow under `## Controls`), then one `**Tip:**`.
6. `## Presets`: the preset strip with a caption, one sentence on the **Preset** row, then one short paragraph per preset, its name in bold ([Style guide](#style-guide)). Basic pages list the preset names in one line until the page is written by hand.
7. `## Controls`: one short paragraph per control, under a `###` for each card section, with its limits and default ([Style guide](#style-guide)). A basic page keeps the generated table until it is written by hand; when you write a page by hand, replace its table (the block with both markers) with paragraphs.
8. `## Node setup`: a focused graph picture (`scripts/effect-graph-shot.mjs`) only when it teaches something, two or three sentences on its stages and one `**Remix:**` change a reader can follow. Style effects of one engine get two sentences and a link to the engine instead of a graph.
9. `## Technical details`: compact facts (units, transparency, saved projects, limits) and links: [Effect system](./Effect-System.md) (its *Per-effect notes* hold the implementation notes of single effects), [Node Catalog](./Node-Catalog.md).

- The headings stay exactly `## Presets`, `## Controls`, `## Node setup` and `## Technical details`, so links like `../effects/gaussian-blur.md#node-setup` work on every page. Add `###` inside them freely; add no other `##` above `## Presets`.
- Links are relative to `docs/Features/effects/`: `../Effects-Blur.md`, `./box-blur.md`, `../Effect-System.md#editable-blur-kernels`, `../assets/effects/gaussian-blur.webp`.
- When a group page's effect sections move into effect pages, the overview keeps a gallery: its cards carry the old heading slugs as ids, so `Effects-Blur.md#gaussian-blur` still lands on the Gaussian Blur card. Replace links to the old sections with links to the effect pages.

**Example**, modelled on `docs/Features/effects/gaussian-blur.md`:

````markdown
# Gaussian Blur

A smooth, even softening, like a lens out of focus. The standard choice for backgrounds,
transitions and anything that should simply look soft.

Group: [Blur & Sharpen](../Effects-Blur.md) · [How to add an effect](../Effects.md#add-an-effect)

<figure class="docs-shot docs-compare">

![The harbour town, original left and with Gaussian Blur at Radius 12 right](../assets/effects/gaussian-blur.webp)

<figcaption>Left: original. Right: Radius 12.</figcaption>
</figure>

**Use it for:** soft backgrounds behind titles · a focus pull · calming a busy projection.

- **Radius** – how soft it gets.

**Tip:** animate Radius from 0 for a smooth focus pull. For a graphic, square look use [Box Blur](./box-blur.md).

## Controls

**Radius** – how soft the picture gets. 2–5 takes the edge off, 10 is clearly out of focus,
30 and more turns shapes into light. 0 to 50 pixels, default 10.

## Node setup

<figure class="docs-shot docs-shot--graph">

![The Gaussian Blur graph: Radius feeds Radius & Tap Count, Input Frame feeds Premultiplied Source; both feed Horizontal Pass, which feeds Vertical Pass and then Straight Alpha Output](../assets/effects/graphs/gaussian-blur.webp)

<figcaption>Gaussian Blur opened in the Nodes tab.</figcaption>
</figure>

**Radius & Tap Count** turns Radius into the width of the bell curve and the number of reads.
**Horizontal Pass** blurs the rows, **Vertical Pass** the columns of that result.

**Remix:** for a blur that stretches sideways, open **Vertical Pass**, multiply Sigma by a
**Value** of 0.5 and plug the result into both **Gaussian Falloff** nodes.

## Technical details

Radius is in pixels of the frame. Transparent edges fade out without a dark rim, and the
preview and the export match. Kernel and caching: [Effect system](../Effect-System.md#editable-blur-kernels).
````

## Pictures, clips, diagrams and galleries

**Pictures.** Wrap a screenshot in `<figure class="docs-shot">` with a `<figcaption>`. Variants: `docs-shot--float-right` / `--float-left` (text beside it on wide screens, below it on phones; end the float with `docs-float-end` or the next heading), `docs-shot--graph` (node graphs keep their size and scroll sideways on phones), `docs-shot--detail` (at most 27rem wide). Numbered callouts are an SVG `docs-shot-overlay` inside a `docs-shot-stage` (`scripts/docShotFigure.mjs`); the SVG is `aria-hidden`, so the caption names every number. Every picture becomes a link to its full-size file, with `width`, `height` and lazy loading after the first one. Alt text says what the picture shows.

**Clips** show motion only where motion is the point (a drag, a trim, an animated effect). `scripts/doc-clip.mjs` prints the figure:

```html
<figure class="docs-shot docs-clip">
<video src="assets/effects/clips/glitch.mp4" poster="assets/effects/clips/glitch.webp" width="960" height="540" autoplay muted loop playsinline preload="none" aria-label="Glitch on a dancer"></video>
<figcaption>What the clip shows.</figcaption>
</figure>
```

The Markdown shortcut `![Glitch on a dancer](../assets/effects/clips/glitch.mp4)` does the same: the sync adds a `.webm` sibling as the first `<source>`, the `.webp`/`.jpg`/`.png` sibling as the poster and a `.vtt` sibling as a captions track. Every `<video>` gets the class `docs-clip-video`, site URLs, `muted`, `playsinline` and `controls`, and its poster's size when it has no `width`/`height` (no layout shift). `autoplay` becomes `data-docs-autoplay`: `docs-site/src/scripts/docsClips.js` then removes the controls and plays a clip only while it is on screen; under `prefers-reduced-motion` the poster and the controls stay. A clip without a poster or an `aria-label` is reported. How the clips are made: [Docs clips](#docs-clips-motion-and-editor-operations).

**Diagrams** are inline SVG in `<figure class="docs-shot docs-diagram">` with real `<text>`; colours come from the theme through `currentColor` and the classes `docs-diagram-lane`, `-clip`, `-clip--alt`, `-highlight`, `-playhead` and `-muted`. Meaning never rests on colour alone (clips carry their letters). `docs-diagram--wide` scrolls sideways on phones.

**Galleries.** `<!-- docs-gallery: blur -->` on its own line expands to a card grid of the group's effects in picker order (`keying+time` joins groups; `all` gives one `##` section per sidebar subgroup, joined like the sidebar, each with an "Overview and which one to choose →" link to its group overview, for `effects/index.md`). A card shows the thumbnail, the name and one line, and links to `effects/<id>.md` once that page exists. Each card keeps the old heading slug as its `id` (for example `#gaussian-blur`), so old in-page links still land on it. The cards read `docs/Features/effects/catalog.json`, which `scripts/effect-docs.mjs` writes (one line per group and per effect):

```json
{ "groups": [{ "id": "blur", "label": "Blur & Sharpen", "effects": ["box-blur", "gaussian-blur"] }],
  "effects": [{ "id": "gaussian-blur", "name": "Gaussian Blur", "group": "blur",
                "description": "A smooth, even softening, like a lens out of focus.", "anchor": "gaussian-blur",
                "page": "effects/gaussian-blur.md", "still": "assets/effects/gaussian-blur.webp",
                "thumb": "assets/effects/thumbs/gaussian-blur.webp" }] }
```

Paths are relative to `docs/Features`. Further fields: `basic` (a generated basic page), `clip` (`assets/effects/clips/<id>.mp4`), `engine` (the shared engine of style effects), `moving` (time-based, so it gets a loop; also looks that move with the playhead, `timelineAnimated`), `presets` (preset names in card order), `presetStrip` (`assets/effects/presets/<id>.webp`), `experimental` and `hidden`. Without the catalog, cards show the page title (or the id) and no picture.

**Budgets** for pictures, thumbnails and clips: [Style guide](#style-guide). `scripts/docShotWebp.mjs` encodes pictures to fit, `scripts/doc-clip.mjs` clips.

### Compare sliders

A filter is shown as a compare: original and effect in one picture, split by a white line with a small round handle that the reader drags from side to side. It starts in the middle. A click or tap moves the line there, a sideways drag moves it along (a vertical swipe still scrolls the page), and the arrow keys, Home and End move it once it has keyboard focus. Small tags in the top corners name both sides.

**The source is a pair:** original | effect, the same view at the same size side by side, without a gap. GitHub and the raw Markdown simply show both. Put `docs-compare` on the figure:

```markdown
<figure class="docs-shot docs-compare">

![The harbour town, original left and with Gaussian Blur at Radius 12 right](../assets/effects/gaussian-blur.webp)

<figcaption>Left: original. Right: Radius 12.</figcaption>
</figure>
```

A loop is the clip figure with `docs-compare` added (`doc-clip.mjs` prints it):

```html
<figure class="docs-shot docs-clip docs-compare">
<video src="../assets/effects/clips/glitch.mp4" poster="../assets/effects/clips/glitch.webp" width="960" height="492" autoplay muted loop playsinline preload="none" aria-label="…"></video>
<figcaption>Left: original. Right: Intensity 0.75, Density 0.45.</figcaption>
</figure>
```

- The tags read "Original" and the page title. `data-before="…"` and `data-after="…"` on the figure name them otherwise, for two effects side by side (`data-before="Box Blur" data-after="Gaussian Blur"`).
- The alt text (or the video's `aria-label`) describes both sides; the slider itself is announced as "Compare original and Gaussian Blur" (the tags' names).
- The caption names what changed ("Left: original. Right: Radius 12."); it stays true on GitHub too.
- Not a compare: generators (alone on black), preset strips and a whole frame beside an enlarged detail (`"layout": "detail"`).

**Making the pair.** Both tools take `"layout": "compare"` and print the figure:

- Stills: an Effect Lab entry in `scripts/effect-lab-shots/<group>.json` with `"left": { "effect": "original" }` and the effect on the right. Both sides get the same crop (default: the whole frame) at the same size; `outWidth` (default and at most 1600) is the width of the whole pair, always even, within 200 KB. `alt` and `caption` go into the printed figure. `node scripts/effect-lab.mjs --pairs scripts/effect-lab-shots/blur.json --only gaussian-blur --url http://localhost:<vite port>`.
- Loops: a `doc-clip.mjs` entry in `scripts/doc-clips/<group>.json`; `width` is the whole pair (default 960), within 1.5 MB and 12 s. Set `poster` to a moment where the effect shows: it is what readers who prefer reduced motion compare. `node scripts/doc-clip.mjs scripts/doc-clips/analog.json --only glitch --media <folder> --url http://localhost:<vite port>`.

**How the site shows it.** The sync (`docs-site/scripts/lib/compare.mjs`) builds a box of one half's size from the asset's own size, so the page never shifts; until `docs-site/src/scripts/docsCompare.js` runs, it reads as a split picture. A loop loads one file: both halves are drawn from its single video, frame by frame, so original and effect stay in sync. It plays only while it is on screen; under reduced motion the poster's halves stay, the line still moves and a small play button starts the loop. The sync reports a pair with an odd width, halves wider than 2.5:1 or narrower than 1:2 (likely a single frame, not a pair), and a poster of another size than its clip. It cannot see a gap or a split frame inside a pair, so look at every new pair yourself.

## Shot and clip tooling

The scripts that make the pictures and clips. Each prints the figure HTML to paste; [Effect pages](#effect-pages) says which picture an effect page needs.

Each effect group keeps its shot lists under the group's name: `scripts/effect-lab-shots/<group>.json` (stills), `scripts/effect-graph-shots/<group>.json` (graphs), `scripts/effect-editor-shots/<group>.json` (inspector excerpts, `tracking.json` for Face Cables) and `scripts/doc-clips/<group>.json` (loops). `scripts/effect-lab-shots/color-thumbs.json` renders the Brightness still and the split thumbnails of the subtle tonal effects. The basic-page stills come from `node scripts/effect-docs.mjs --lab-manifest <file>`.

### Effect Lab (review and doc stills)

`scripts/effect-lab.mjs` renders one effect through the real `EffectsPipeline` on
the hardware GPU (`tests/browser/effect-lab/`) and writes a PNG per image and
parameter variant plus a labelled contact sheet with the original as first
column. Test images (`tests/browser/effect-lab/images/`) cover skin tones in
stage light, fine daylight detail and saturated night lights. Run a Vite of the
checkout first (`npx vite --port 5175 --strictPort`), then for example
`node scripts/effect-lab.mjs --effect gaussian-blur --variants '[{"label":"r20","params":{"radius":20}}]' --out /tmp/blur`;
`--list` prints every effect with its parameters, `--times` renders a frame
sequence for temporal effects, and `--inset 0.7` places the image at 70 % on a
transparent frame (the contact sheet shows cells over a checkerboard) to check
alpha handling such as dark rims. `--metrics` adds per-cell numbers to the summary: mean
alpha (coverage, e.g. how far a particle outro has progressed), transparent pixels in the
outer 8 px, and newly crushed black (channels below 20 where the original averaged above
60); `--require-filled-border` fails the run when a variant leaves the frame border
transparent. Effects that need clip context (masks, face
landmarks, temporal source, tracking) render without it and are checked in the
editor instead. `--pairs <file>` writes docs close-ups: each entry renders two
effects (or `original`) on one image, crops the same region of both (`crop`, in
pixels of the rendered frame, `zoom` enlarges it) and puts them side by side as a
WebP, e.g. `node scripts/effect-lab.mjs --pairs scripts/effect-lab-shots/blur.json`
(`"layout": "compare"` makes the gap-free pair of a [compare slider](#compare-sliders));
`"backdrop": "checker"` or a flat colour (`"#3c6ec8"`, readable at float size) shows
transparent pixels. `--presets scripts/effect-lab-shots/presets.json [--only <id>]` makes the
preset strip of an effect page: every preset its definition declares, rendered on one image
(`image`, `crop`, `times` for a moving effect), in rows of `columns` (two for four presets) with the
preset name under each cell, as `docs/Features/assets/effects/presets/<id>.webp`. One entry per
effect in `presets.json`; names and values always come from the registry.

### Effect graph pictures

`?test=effect-graph&effect=<id>` shows an effect's default operator graph on the
real Node Workspace canvas, read-only and without editor chrome: the clip graph
of a freshly added effect, cropped to the effect and fitted to the window. Card
titles use the canvas' enlarged overview lettering with one size per picture
(`overviewTitles: 'uniform'`: the size at which half the titles fit; longer ones
may come out smaller, short ones no larger), so short stub names do not outshout
the recipe. Parameters choose the level:
`level=stages` (default, folders folded as when an effect is opened) or
`level=all`; `open=a,b` opens folders by label slug, `parent/child` path or
group id; `focus=folder` shows only one folder, with the flow layout it has
inside the effect wrapped into rows (`rows=n` sets the count, `break=a,b` starts
rows at these node ids instead) and named stub cards for the values that come from
outside the folder (Constants excepted); `only=a,b` (with `focus`) keeps just
these node ids and turns their other inputs into stubs, so a picture shows a recipe
instead of the whole folder (`--list` prints the ids; a composition's `@` may be
left out). The folder's own unpicked number cards, such as a Clamp's 0 and 1, are
left out instead of stubbed (say so in the caption). The literal values the picks
read from the Constants folder appear as
their own value cards ("Taper Gain −2"; `constants=hide` leaves them cut). A recipe
is laid out afresh (`compactRecipeLayout`): columns follow the cables, each card as
far right as its consumers allow; fed cards sit level with their highest source;
stubs and constants sit beside the port they feed, in a free slot that no cable
crosses (stacked at the canvas' 56-unit clearance, in port order); then cards that a
long cable still runs through move up or down until no cable passes a card it does
not connect, and back towards their first position as far as that allows. Each
wrapped row is as tall as its own cards; `plumbing=hide` leaves out the Constants
and Coordinates & Resources folders and their cables and lays the stages out the
same way, so an overview reads as one path; `omit=a,b` leaves out cards (an
overview without the effect's Output card); `chain=1` keeps the clip source and
output; `cables=avoid` routes the cables around the cards like the Node Workspace's
**Avoid** button (`NodeGraph.cableRouting`), so no cable runs behind a stub or a
wrapped row and shows the wrong wiring. The page mounts the canvas only once the
clip is in the timeline store, so its first placement does not reserve preview space
under cards that have none. Folder ports are named after what
they carry ("Sigma", "Tap Count"): an effect's presentation plan names its key
outputs (`portLabels` in `effectPresentationPlans.ts`). Folder headers stay
clickable for exploring. The page is part of dev builds only.

`scripts/effect-graph-shot.mjs` captures shots of that page in hardware-GPU
Chrome as WebP (at most 1600 px wide and 200 KB) into
`docs/Features/assets/effects/graphs/`, for example
`node scripts/effect-graph-shot.mjs --manifest scripts/effect-graph-shots/blur.json`
(one manifest per docs page keeps its pictures reproducible) or
`node scripts/effect-graph-shot.mjs 'gaussian-blur?plumbing=hide'`,
with a Vite of the checkout running (`npx vite --port 5176 --strictPort`). A shot
is `<effect>[?query][@file name]`; `--list` prints the folders and node ids of each
effect. Cables that bend out past the cards (the last cable of a wrapped row, or an
avoiding route) stay inside the crop. Two checks keep pictures readable: a shot fails
when a cable runs through (or within 8 units of) a card other than its two ends, since
it would look like that card's connection (`crossings=allow` lets it pass with a
warning), and a shot warns when card titles show below 11 px at the docs width of its
layout (720 px full, 418 px float). Before warning, the script narrows the page step
by step: a lower zoom letters titles larger relative to the cards, and the picture
still fills the column. Folded cards show their › on the canvas (it used to be drawn
only by the DOM button of an active card).
`marks=id[:from][:reach],…` in a shot's query adds numbered callouts on those node
cards (a stub id such as `wave-uv-split:y` keeps its colon; `reach` is the arrow
length in overlay units, default 84) and prints the figure markup (`layout=float`
sizes them for a picture beside the text). The crop grows into the canvas margin,
with extra room above and below for vertical callouts, so an arrow keeps its length
instead of shrinking to a badge on the card edge. The docs site links every picture to its full-size file and lets node
graphs scroll sideways on narrow screens.

For an effect without folders (Time Stack), `only=` without `focus` picks the
recipe from the whole effect. In a recipe, `omit=` also takes stubs (`uv:uv`, as
the stub list names them) and leaves them out before the layout, so they leave no
gap. A stub carries the name of what its source outputs: name those outputs in the
effect's port labels (`portLabels` in `effectPresentationPlans.ts`, for example "Time
Map" on Slit Scan's Switch), so the editor's cards and folder ports read the same.
`name.<id>=Label` overrides a stub's name for the picture only; real cards keep their
editor names, and a name that matches no stub fails with the list of stubs. Port
labels show at about 9 px in the 720 px docs column while a picture is three cards
wide (four: about 7 px): crop a recipe to the cards its text and remix need.

### Effect editor excerpts

`scripts/effect-editor-shot.mjs <shot file>` shows where an effect's controls
live: in a fresh project of hardware-GPU Chrome it puts an Effect Lab image on
the timeline, adds the effect with the given parameters, opens Properties →
Effects and captures the inspector with a strip of the preview as WebP (2× pixel
density, at most 200 KB) into `docs/Features/assets/effects/editor/`. It prints
the docs `<figure>` with numbered callouts on the named controls (parameter
labels, `tab:Effects`, `bypass`, `remove`, `add` or `preview:x,y`; text targets end
at the words, not at the empty rest of their row) in the
`docs-shot-overlay` style; `view: "nodes"` captures the Nodes tab instead, with the
clip picked as its graph source (targets `dock:Nodes`, `source`, `expand:<card>`
for the › of a folded card, `port:<name>`); `layout: "float"` sizes them for a picture beside the
text. `top: "tabs"` crops below the dock tab row (from the Properties sub-tabs),
`preview` sets the width of the preview strip (0: the card alone), a mark's `reach`
sets its arrow length (the crop grows to keep it), a parameter callout points at the
label text, and `hide` leaves named buttons that
the picture does not explain out of it. One shot file per category, e.g. `scripts/effect-editor-shots/blur.json`;
`--only <name>` recaptures one shot. A control the script cannot find stops it
with the card's text, so a renamed parameter does not silently drop a callout.
`viewport: { width, height }` sets the editor window (default 1600 × 900). Keep the
default width so the picture shows the inspector as most users see it; a taller window
fits a long card. A card taller than the panel is cropped at the panel's bottom edge,
not in the timeline below.

### Docs clips (motion and editor operations)

Which medium a page needs (still, loop or operation clip): [Style guide](#style-guide).

`scripts/doc-clip.mjs <shot file>` makes both kinds in the real editor of the
checkout, each in a throwaway project of hardware-GPU Chrome, from one JSON shot
list per docs page (`scripts/doc-clips/analog.json`):

- An **effect clip** puts the source video on the timeline, adds the effect with the
  given parameters and exports the `range` through `debugExport` (the export panel's
  `FrameExporter`, at the source size and frame rate), for `pair`, `compare` and `split`
  also once without the effect. ffmpeg builds the layout – `single`, `pair` (original | effect),
  `compare` (the same without a gap, for a [compare slider](#compare-sliders)),
  `split` (one picture, original left of a thin line) or `detail` (the frame | a 3×
  pixel-for-pixel detail at `detail` [x, y]) – and a seamless loop: the last `loop`
  seconds (default 0.5) fade into the first, so the clip ends on the frame it starts with.
- An **operation clip** sets dock split ratios (`dock`), opens Properties → Effects and
  records the page with Chrome's screencast while `steps` drive the real mouse:
  `click` or `move` to visible text ("+ Add Effect", "Glitch"), `type`, `drag` the
  slider of a row label to a value, `pause`. Moves are eased with a slight arc (about
  0.5–1.2 s); a drawn pointer follows them (Playwright shows no cursor), with a yellow
  ripple on clicks. The clip shows the named dock groups (`panels`), cropped together.

Each clip becomes `<name>.mp4` (H.264, yuv420p, BT.709, faststart, no audio; the
CRF rises until it fits `maxBytes`, 1.5 MB by default) and a WebP poster (`poster` seconds into the clip), and the script
prints the figure:

```html
<figure class="docs-shot docs-clip docs-shot--float-left">
<video src="assets/effects/clips/glitch.mp4" poster="assets/effects/clips/glitch.webp" width="962" height="490" autoplay muted loop playsinline preload="none" aria-label="…"></video>
<figcaption>…</figcaption>
</figure>
```

Run `npx vite --port 5192 --strictPort` in the checkout, then
`node scripts/doc-clip.mjs scripts/doc-clips/analog.json --media <folder>`; `--only
<name>` remakes one clip, `--keep <folder>` keeps the exports and screencast frames,
and `--reencode` then encodes the clips again from them without a browser (for
layout, crop, loop, poster or size changes). The analog page's source video
(`dancer_stage_motion.mp4`, 6 s, 1080p) is not in the repository: `--media` or
`DOC_CLIP_MEDIA` names its folder. Keep the real mouse away from the recording
window: the drawn pointer ignores foreign pointer events and the script warns about
them, but the editor's hover effects still react. The script also prints the
screencast frame gaps and how long the page took each pointer move; while the editor
is busy, a short compositor transition keeps the pointer gliding. The docs site
(`docs-site/scripts/sync-features.mjs`) gives a clip its site URLs and its poster's
size, and `docs-site/src/scripts/docsClips.js` plays it only while it is in view;
under `prefers-reduced-motion` the poster stays, with controls.

## Redirects

`docs/Features/redirects.json` lists published URLs that moved, old → new, as full `/docs/…` URLs (a target may carry an anchor). The sync writes the active ones to `docs-site/src/generated/redirects.json`, which becomes Astro's `redirects` (old path relative to the `/docs` base, target as written). A redirect waits while its old page is still published, so it can be added before the move; a target that is not a published page, or an anchor the target does not have, is reported. Unpublished internal pages get no redirect.

**Sections that leave a page that stays.** A server redirect cannot see the `#anchor`, so moved sections of a published page are listed under `"anchors"`: `{ "/docs/features/effects/": { "slit-scan": "/docs/effects/slit-scan/" } }`. The sync writes them to `docs-site/src/generated/anchor-redirects.json`; a small script in the page head sends a visit with that anchor on before the page renders. The sync reports an anchor the page still has, a page that is not published and a target that does not exist. Two rules keep old deep links working: when a group page's sections move into effect pages, its gallery cards keep the old heading slugs as ids; when sections leave any other published page (such as the old `Effects.md`), add their old anchors here.

## Generated output

Everything the sync writes is generated and untracked (`.gitignore`): `docs-site/src/content/docs/features/`, `guides/`, `effects/`, `getting-started/overview.md`, `docs-site/src/generated/` and `docs-site/public/assets/`. Never commit them. Hand-written site pages (`index.mdx`, `getting-started/welcome.md`) stay tracked. `npm run dev` and `npm run build` in `docs-site/` run the sync first; for a bare `npx astro dev`, run `npm run sync` once.

## Build integration

The root production build runs the editor build first and then the documentation build (`npm run docs:build`): it installs the `docs-site` packages, runs the sync with `--build` (which always clears the Astro content cache) and writes the static site to `dist/docs/`. A running `astro dev` of the same `docs-site` keeps its content cache (the sync checks the process behind `.astro/dev.json`). It restarts for a new sidebar but keeps serving pages a sync removed: the sync then says so, and the dev server needs a restart. `npm run docs:build:head` renders the committed state of `docs/Features` (`--source-ref HEAD`) without unrelated uncommitted documentation changes.

The sync reports, without failing:

- links to a missing page or to a heading the target page does not have (heading ids as Starlight makes them: the github-slugger rules in `docs-site/scripts/lib/slug.mjs`);
- pictures without alt text, clips without a poster or label;
- compare figures whose pair cannot be two equal halves (odd width, implausible halves) or whose poster and clip differ in size;
- assets over their budget;
- index rows for missing pages, pages listed twice, pages without a row, unknown directives;
- redirects that wait, or point nowhere.

The sidebar logic is covered by `tests/unit/docsSiteSync.test.ts`, the compare sliders (sync and client script) by `tests/unit/docsCompareSlider.test.ts`.

## Hosting and routing

Documentation ships inside the existing `masterselects` Cloudflare Pages deployment. It does not require a separate subdomain or DNS record. The Pages middleware recognizes `/docs` and `/docs/*` as valid static documentation routes while preserving the real-404 behavior for unknown application paths. Search is generated by Pagefind and is served from the same `/docs/` path.

## Verification

The deployed documentation check covers:

- `/docs/`
- `/docs/getting-started/overview/`
- representative feature pages such as `/docs/features/ai-studio/`
- `/docs/_astro/*` styles and client assets
- `/docs/pagefind/pagefind.js`

The Info-menu unit test also verifies the public URL, new-tab target, safe link relation, and menu-close behavior.

## Current stack

```text
Frontend          React 19 + TypeScript + Vite 7.x
State             Zustand with modular timeline and media slices
Rendering         WebGPU + WGSL + shared-scene 3D runtime
Media             MediaBunny, WebCodecs, experimental TurboRes, HTML media fallback paths
Audio             Web Audio API, artifact-backed analysis, spectral display, clip/track/master FX, recording
AI                Private hosted-agent kernel, hosted media generation, ElevenLabs/Suno, OpenAI transcription/moderation, MatAnyone2, MuScriptor
Persistence       File System Access API, project-local RAW copies, IndexedDB handle/cache storage
Native Helper     Rust service with HTTP/WebSocket bridge, yt-dlp, helper-backed jobs
```

## Source map

| Area | Location |
|---|---|
| UI components | `src/components/` |
| Timeline UI and interactions | `src/components/timeline/` |
| Preview and output surfaces | `src/components/preview/`, `src/components/outputManager/` |
| Panels and workspace shells | `src/components/panels/` |
| State stores | `src/stores/`, `src/stores/mediaStore/` |
| GPU engine | `src/engine/` |
| Effects and shaders | `src/effects/`, `src/shaders/`, `src/transitions/` |
| Services and bridges | `src/services/` |
| Kernel client | `src/services/kernelClient/` |
| Native helper | `tools/native-helper/` |

## Audit notes

- The authoritative app version is `src/version.ts`.
- Preview quality is wired into engine-backed preview resolution through `useEngine()`; it does not affect export resolution or the HTML-only source monitor.
- `openComposition` and `searchVideos` are mapped through the shared AI tool dispatcher.
- `AI_TOOLS` assembles the public model-tool definitions, including storyboard, worker-first, and motion-design tools. Gaussian debug definitions remain outside that public registry.
