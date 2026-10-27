# Phone Editor

[Back to Index](./README.md)

<figure class="docs-shot docs-shot--float-right">

![The phone editor at /m with a clip selected: the preview on top, the transport with play, undo and redo, the timeline with its fixed centre playhead, and the clip tools at the bottom with Split active and later tools greyed out](assets/phone-editor/phone-editor-clip-selected.webp)

<figcaption>The phone editor with a clip selected. Split works; tools of later milestones stay visible but greyed out.</figcaption>
</figure>

Open **masterselects.com/m** on your phone to edit with your thumb. It is the same editor
underneath: the same timeline, effects, undo history and projects as on the desktop. A project you
start on the phone opens unchanged at /editor, and the other way round.

The screen has five strips:

1. **Top bar** – project name, composition tabs, assistant and export.
2. **Preview** – the real picture of your composition. It stays visible while you work.
3. **Transport** – time, play, undo and redo.
4. **Timeline** – the playhead stays fixed in the middle and the clips move under it.
5. **Tools** – with nothing selected the main tools, with a clip selected that clip's tools.

**Swipe** across the timeline to scrub; the preview shows the frame under the playhead. **Pinch**
with two fingers to zoom; the frame under the playhead stays put. **Tap** a clip to select it and
tap empty space (or the clip again) to deselect. With the playhead inside the selected clip,
**Split** cuts it there; undo brings the clip back in one step.

**Tip:** a greyed-out tool is not hidden on purpose. Tap it: it tells you why it does not work on
the phone yet. Until then, the same project opens in the full editor at /editor.

## What works today

The phone editor grows in milestones. **M0** (this version) proves touch and speed: scrubbing,
pinch zoom, selecting and splitting. Importing from the gallery, trimming, deleting, titles and
export arrive with **M1**; effects, colour, transitions, speed and audio with **M2**; everything
else follows. Every tool already has its place in the toolbar and shows its milestone when tapped.

## Technical details

- Entry: the path `/m` (also `/m/…`) resolves to the `phone` experience in
  `src/routing/entryExperience.ts` and loads `src/components/mobileSkin/PhoneApp.tsx` lazily, without
  the desktop `App`. `?test` and `?entry=editor` still force the desktop editor. `/editor`,
  `/medium` and the automatic mobile dock layout are unchanged.
- Runtime: `runtime/PhoneRuntimeHost.tsx` owns the single `useEngine()` and `useGlobalHistory()`,
  mounts the playback and FlashBoard runtime hosts and restores the last project like the desktop
  toolbar (`runToolbarProjectBootRestore`, then `setupAutoSync`). Without an open project it shows the
  existing project chooser.
- Preview: `preview/PhonePreview.tsx` registers its canvas as the `activeComp` render target
  `phone-main-preview`; backing size follows the desktop preview-quality policy.
- Timeline: `timeline/phoneTimelineGeometry.ts` holds the fixed-centre geometry (half-viewport padding
  at both ends, frame-aligned seeks, scrolling stops at the last clip). One gesture owner
  (`usePhoneTimelineNavigation.ts`) handles pan, pinch (anchored at the playhead) and tap; only clips
  near the viewport are rendered and the content layer moves by transform. Zoom is phone-local
  (`state/phoneUiStore.ts`, 4–1200 px per second, default 60) and never touches the desktop zoom or scroll.
- Split dispatches `applyTimelineEditOperation` with `split-at-time` for the selected clips only, so it
  never cuts unselected clips under the playhead.
- Toolbar: `actions/phoneActionCatalog.ts` lists every root and clip action with its milestone;
  `PHONE_SHIPPED_MILESTONE` in `contracts.ts` decides which ones work. Unavailable actions are focusable,
  `aria-disabled` and explain themselves on tap.
- Tests: `tests/unit/phoneTimelineGeometry.test.ts`, `phoneCutActions.test.ts`, `phoneActionCatalog.test.ts`,
  `entryExperience.test.ts`; Playwright journeys in `tests/playwright/mobile/` (`npm run test:e2e:phone`,
  Pixel-7 and iPhone viewports with touch). The phone emulation does not spoof an Android user agent:
  the engine's Linux/Mesa presentation path is keyed on "not Android", and a spoofed Android agent on a
  Linux test host leaves the WebGPU preview black.
