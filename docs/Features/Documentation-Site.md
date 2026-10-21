# Documentation Website

For developers and agents who write or build the documentation. MasterSelects publishes its product documentation at `https://www.masterselects.com/docs/`, as part of the main website. The editor's **Info > Documentation** action opens that page in a new browser tab.

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
- Write links relative to the file that contains them, with their anchor: `../Effects.md#split-compare`, `./box-blur.md`, `../assets/effects/glow.webp`. The sync turns them into site routes. Links to files outside `docs/Features` (source code, the project README) and to unpublished pages keep only their text.
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
| `<!-- docs-sidebar: unpublished -->` | The section's pages stay in the repo but are not rendered, not searchable and not in the sidebar. Links to them become plain text. |

- Rows inside other HTML comments are planned pages: the sync counts them and does not list them. Move a row out of its comment when its page exists; the sync never lists a missing page.
- Pages without a row are placed by name and reported: `Effects-<group>.md` joins the matching effect subgroup (else the Effects group), `effects/<id>.md` its picker group, `Transitions-*.md` the group of `Transitions-Dissolve.md`, `guides/*.md` the Guides group. Every other page lands in a final **More** group.
- Expanded by default: Getting Started, Guides, Live and Stage and Effects (its subgroups stay collapsed). The reference groups and Developers are collapsed.

## Page templates

Simple at the top, deeper below. Every page ends in a fixed order, the deep parts always last.

- **A. Guide** (`guides/<slug>.md`, ≤ 600 words, 3–6 annotated pictures). One sentence on what the reader will do, then "Try it interactively: **Info → Tutorials → …**" when an in-app tutorial exists. Numbered steps, each with its picture or clip. An "I want to… / Do this" table. It ends with "Go deeper:" links to the reference pages.
- **B. Effect page** (`effects/<effect-id>.md`). The title is the effect name. One sentence on the look, the picker group in bold and a link to [Using effects](./Effects.md). A before/after still (`scripts/effect-lab.mjs --pairs`). "**Use it for:**" with 2–3 uses. The controls table (Control · What it changes · Range · Default) between `<!-- generated:controls start -->` and `<!-- generated:controls end -->`, then "**Tips:**". `## Node setup`: the overview graph (`scripts/effect-graph-shot.mjs`), 3–6 lines on its stages, one "**Remix:**" change, and a link to How effects are built. Style effects of the Pattern and Glyph engines get two lines and a link to their engine section instead of a graph. `## Technical details` comes last.
- **C. Effect group overview** (`Effects-<Group>.md`). The title is the picker label. One sentence and where to add an effect, then `<!-- docs-gallery: <group-id> -->`, then `## Which one?` (Look → Use), `## The shared idea` (one group graph) and `## Technical details`.
- **D. Feature reference** (`<Page>.md`). One sentence and a link to its guide, an annotated picture, then `## Options` (every control in UI order: name → what it does → default), the formats or other lists the feature needs, `## Limits` in plain words and `## Technical details` (short, or a link to the developer page).
- **E. Developer page** (Developers group). "For developers and agents. User docs: …", then `## Architecture` (with a diagram), `## Key files` (table), `## Contracts and invariants`, `## Tests` and `## Debugging`.

Rules for every page:

- No change-log wording ("in this update", "rebuilt", "fixed"). Put a new fact in the section it belongs to, never after Sources or Limitations.
- No manual table of contents: Starlight shows "On this page".
- User pages hold no internals. Code paths, store and test names, issue numbers, model IDs and kernel terms go under "Technical details" or into the Developers group. Credit prices and model lists live on one page.
- Facts follow the code: counts come from the effect catalog or are left out; menu paths are copied from the component labels; check pages against the running editor, not against older docs.
- Tables have at most four short columns, so they fit a phone.

## Pictures, clips, diagrams and galleries

**Pictures.** Wrap a screenshot in `<figure class="docs-shot">` with a `<figcaption>`. Variants: `docs-shot--float-right` / `--float-left` (text beside it on wide screens, below it on phones; end the float with `docs-float-end` or the next heading), `docs-shot--graph` (node graphs keep their size and scroll sideways on phones), `docs-shot--detail` (at most 27rem wide). Numbered callouts are an SVG `docs-shot-overlay` inside a `docs-shot-stage` (`scripts/docShotFigure.mjs`); the SVG is `aria-hidden`, so the caption names every number. Every picture becomes a link to its full-size file, with `width`, `height` and lazy loading after the first one. Alt text says what the picture shows.

**Clips** show motion only where motion is the point (a drag, a trim, an animated effect). `scripts/doc-clip.mjs` prints the figure:

```html
<figure class="docs-shot docs-clip">
<video src="assets/effects/clips/glitch.mp4" poster="assets/effects/clips/glitch.webp" width="960" height="540" autoplay muted loop playsinline preload="none" aria-label="Glitch on a dancer"></video>
<figcaption>What the clip shows.</figcaption>
</figure>
```

The Markdown shortcut `![Glitch on a dancer](../assets/effects/clips/glitch.mp4)` does the same: the sync adds a `.webm` sibling as the first `<source>`, the `.webp`/`.jpg`/`.png` sibling as the poster and a `.vtt` sibling as a captions track. Every `<video>` gets the class `docs-clip-video`, `muted`, `playsinline` and `controls`, and `autoplay` becomes `data-docs-autoplay`: the site script then plays a clip only while it is on screen and, under `prefers-reduced-motion`, keeps the poster and the controls. A clip without a poster or an `aria-label` is reported.

**Diagrams** are inline SVG in `<figure class="docs-shot docs-diagram">` with real `<text>`; colours come from the theme through `currentColor` and the classes `docs-diagram-lane`, `-clip`, `-clip--alt`, `-highlight`, `-playhead` and `-muted`. Meaning never rests on colour alone (clips carry their letters). `docs-diagram--wide` scrolls sideways on phones.

**Galleries.** `<!-- docs-gallery: blur -->` on its own line expands to a card grid of the group's effects in picker order (`keying+time` joins groups; `all` gives one `##` section per picker group, for `effects/index.md`). A card shows the thumbnail, the name and one line, and links to `effects/<id>.md` once that page exists. Each card keeps the old heading slug as its `id` (for example `#gaussian-blur`), so old in-page links still land on it. The cards read `docs/Features/effects/catalog.json` (written by `scripts/effect-docs.mjs`):

```json
{ "groups": [{ "id": "blur", "label": "Blur & Sharpen", "effects": ["box-blur", "gaussian-blur"] }],
  "effects": [{ "id": "gaussian-blur", "name": "Gaussian Blur", "group": "blur",
                "description": "A smooth, even softening.", "thumb": "assets/effects/thumbs/gaussian-blur.webp",
                "anchor": "gaussian-blur" }] }
```

`groups` is optional (the picker groups are read from `effectCatalogGroups.ts`), `thumb` is relative to `docs/Features`, and `anchor` defaults to the slug of `name`. Without the catalog, cards show the page title (or the id) and no picture.

**Budgets.** WebP/PNG/JPEG ≤ 200 KB and ≤ 1600 px wide (`scripts/docShotWebp.mjs`), gallery thumbnails ≤ 30 KB, clips ≤ 1 MB and ≤ 8 s; about 600 KB per effect page and 1.5 MB per guide. Reshoot only when the UI visibly changed: every reshoot stays in the Git history.

## Redirects

`docs/Features/redirects.json` lists published URLs that moved, old → new, as full `/docs/…` URLs (a target may carry an anchor). The sync writes the active ones to `docs-site/src/generated/redirects.json`, which becomes Astro's `redirects` (old path relative to the `/docs` base, target as written). A redirect waits while its old page is still published, so it can be added before the move; a target that is not a published page, or an anchor the target does not have, is reported. Unpublished internal pages get no redirect.

## Generated output

Everything the sync writes is generated and untracked (`.gitignore`): `docs-site/src/content/docs/features/`, `guides/`, `effects/`, `getting-started/overview.md`, `docs-site/src/generated/` and `docs-site/public/assets/`. Never commit them. Hand-written site pages (`index.mdx`, `getting-started/welcome.md`) stay tracked. `npm run dev` and `npm run build` in `docs-site/` run the sync first; for a bare `npx astro dev`, run `npm run sync` once.

## Build integration

The root production build runs the editor build first and then the documentation build (`npm run docs:build`): it installs the `docs-site` packages, runs the sync with `--build` (which always clears the Astro content cache) and writes the static site to `dist/docs/`. A running `astro dev` of the same `docs-site` keeps its content cache (the sync checks the process behind `.astro/dev.json`). `npm run docs:build:head` renders the committed state of `docs/Features` (`--source-ref HEAD`) without unrelated uncommitted documentation changes.

The sync reports, without failing:

- links to a missing page or to a heading the target page does not have (heading ids as Starlight makes them: the github-slugger rules in `docs-site/scripts/lib/slug.mjs`);
- pictures without alt text, clips without a poster or label;
- assets over their budget;
- index rows for missing pages, pages listed twice, pages without a row, unknown directives;
- redirects that wait, or point nowhere.

The sidebar logic is covered by `tests/unit/docsSiteSync.test.ts`.

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
