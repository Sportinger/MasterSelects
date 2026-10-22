# Building an effect

For developers and agents who build a new effect or rework an existing one. A request usually arrives as a photo, a video or a description of a look. This page is the path from there to a finished effect: robust controls, presets, a docs page and reviewed quality. How effects work inside: [Effect system](./Effect-System.md). User docs: [Using effects](./Effects.md).

## The path

1. **Understand the reference.** Look at the photo, or at the video frame by frame (a contact sheet). Write down in a few sentences what makes the look: shapes, motion, colour, and what reacts to the picture underneath. Decide whether it is a **filter** (it changes the clip's picture) or a **generator** (it draws its own picture or 3D structure, like Weave or Flocking).
2. **Reuse before you build.** Check the [Effect catalog](./effects/index.md), the [Node Catalog](./Node-Catalog.md) and the shared effect engines. When an existing effect reaches the look with other values, the answer is a preset of that effect, not a new one. A new effect is built from small reusable nodes, so other agents can rebuild and remix it in the node graph.
3. **Build it robust.** The rules of [Contracts and invariants](./Effect-System.md#contracts-and-invariants) apply, in short:
   - Every control changes the picture, stays safe over its whole range (no NaN, no black frames) and is keyframeable where that makes sense.
   - A value the effect clamps or ignores is reported in the card or the tool result, never changed silently.
   - Transparency is handled premultiplied; the preview and the export match.
   - No GPU state is shared between two instances of the effect.
   - Saved projects keep their look (`legacyDefault`, retired parameters).
   - The card uses the shared inspector rows (AGENTS.md, section 9).
4. **Compare with the reference.** Render the effect with `scripts/effect-lab.mjs` on the shared images, and on the moving footage when it moves. Put the result next to the reference and keep going until a viewer would recognise the look.
5. **Presets.** Give the effect three to five named presets that show its range. They belong to the effect and are picked in its card. Each one has to look good on its own, so render every preset and look at it.
6. **The docs page.** Write `docs/Features/effects/<effect-id>.md` by hand, following the [Style guide](./Documentation-Site.md#style-guide) and the [Effect pages](./Documentation-Site.md#effect-pages) contract. Video wherever something changes, stills where nothing does:
   - the top: a [compare slider](./Documentation-Site.md#compare-sliders) on a still or a loop for a filter, the effect alone on black for a generator;
   - the presets: one loop of all presets in a grid for a moving effect, a strip of stills for a static one;
   - one paragraph per control with its limits, and for a moving effect a short loop beside it that sweeps the control;
   - the inspector picture and the node setup with yellow callouts: the overview, then one section per stage folder with a picture of its inside and a paragraph per marked node.

   Every picture and clip is a recipe in your group's shot lists ([Shot and clip tooling](./Documentation-Site.md#shot-and-clip-tooling)). Make them all with `node scripts/docs-media.mjs <effect-id>` and look at the contact sheet it writes; after a change to the effect, `node scripts/docs-media.mjs --stale <effect-id>` remakes what it touched (name the effect: other lanes' pictures are theirs). Then run `node scripts/effect-docs.mjs`.
7. **Review rounds.** See below.
8. **Finish.**
   - Run the targeted tests by name (never the full suite) and `npm run build` once.
   - Check the effect live in the editor: add it, apply every preset, undo, and use the card with pointer and keyboard.
   - Look at the docs page at 1440 px and 420 px wide.
   - Commit on your task branch with the tests named in the message. Report the branch, a reference | result picture, what changed and anything still open.

## Review rounds

When the effect and its page are built, two reviewers who did not build them look at the result independently:

- **An art director** checks whether it matches the reference, whether the defaults and presets look good, whether the page explains everything in plain words and whether the pictures are right.
- **An engineer** checks correctness, GPU and transparency handling, every control at the edges of its range, saved projects, preview against export, and the tests.

Each reviewer lists issues as blocking, major or minor. The builder fixes every blocking and major issue at its root, and cheap minor ones too, or explains why an issue is wrong. The next round checks the fixes and looks for new problems.

Stop when a round finds no blocking or major issue: at least one round, at most three. Whatever is still open after the third round goes into the report.

In Claude Code the reviewers are subagents or a workflow; with Codex they are separate review workers. Give them the reference, the branch, this page and the Style guide.

## Done when

- The look matches the reference: a picture of both side by side is in the report.
- Every control acts, is safe over its whole range and has its own paragraph on the page.
- Three to five presets, each one good on its own.
- The page follows the Style guide, and every picture and clip has been checked by eye.
- The last review round found no blocking or major issue.
- The targeted tests, the build and the live check passed.

## Key files

| What | Where |
|---|---|
| Effect definitions and engines | `src/effects/` |
| Reusable nodes | [Node Catalog](./Node-Catalog.md), `src/services/operators/` |
| All docs pictures and clips from their recipes | `scripts/docs-media.mjs` (footage and theme: `scripts/docShotSettings.mjs`) |
| Renders for comparison and stills | `scripts/effect-lab.mjs` |
| Loops and pointer clips | `scripts/doc-clip.mjs` |
| Editor pictures with callouts | `scripts/effect-editor-shot.mjs`, `scripts/effect-graph-shot.mjs` |
| Effect pages, catalog and checks | `scripts/effect-docs.mjs`, `tests/unit/effectDocsCatalog.test.ts`, `tests/unit/effectControlsRead.test.ts` |
