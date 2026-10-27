# Phone Editor

[Back to Index](./README.md)

<figure class="docs-shot docs-shot--float-right">

![The phone editor at /m with a clip selected: the preview on top, the transport with play, undo and redo, the timeline with its fixed centre playhead, and the clip tools at the bottom with Split active and later tools greyed out](assets/phone-editor/phone-editor-clip-selected.webp)

<figcaption>The phone editor with a clip selected. Tools of later milestones stay visible but greyed out.</figcaption>
</figure>

Open **masterselects.com** on your phone and the phone editor opens by itself, made for your thumb
(the address is **masterselects.com/m**). It is the same editor underneath: the same timeline,
effects, undo history and projects as on the desktop. A project you start on the phone opens
unchanged in the full editor, and the other way round. Tablets and computers keep the full editor.

## Start or reopen a project

The home screen opens when no project is open, and any time you tap **Projects** (top left).

- **New project** asks for a name and a canvas: **9:16** (preselected), 16:9, 1:1 or 4:5. It creates
  the project with its first composition at 1080 px on the short side (9:16 is 1080 × 1920), 30 fps.
  The canvas is part of the new project itself, so Undo never turns it back into 1920 × 1080.
- **Recent projects** lists the projects stored on this device, most recent first. Tap one to open it.
- **Import project file** opens a `.msproj` archive from your phone.
- Tap the **project name** in the top bar for the project sheet; the small status next to it tells you
  where the project is stored and warns when the browser may delete it.

Closing the browser does not lose anything: reopen /m and the last project comes back with the same
timeline. If the browser asks for access to the project folder again, one tap resumes it.

## Switch to the full editor

**Full editor** on the home screen and in the project sheet saves the project and opens it in the
full editor with every tool. The phone remembers that choice. To come back, tap **Mobile** in the
bottom bar of the full editor. On a computer or tablet, **Layouts → Phone editor** opens the phone
editor too. While an export is running, both wait and tell you why.

MasterSelects installed as an app (from the browser's install button) stays in the full editor on a
phone, because the installed app covers only the full editor's address.

## The editing screen

The screen has five strips:

1. **Top bar** – projects, project name, assistant and export.
2. **Preview** – the real picture of your composition. It stays visible while you work, also above an
   open sheet.
3. **Transport** – time, play, undo and redo.
4. **Timeline** – the playhead stays fixed in the middle and the clips move under it.
5. **Tools** – with nothing selected the main tools, with a clip selected that clip's tools.

**Swipe** across the timeline to scrub; the preview shows the frame under the playhead. **Pinch**
with two fingers to zoom; the frame under the playhead stays put. **Tap** a clip to select it and
tap empty space (or the clip again) to deselect.

## Cut a story

- **Add media:** **Media** opens the phone's file picker for videos, images and audio. Several files
  land on the main track in the order you picked them.
- **Trim:** select a clip and drag the handles at its ends; the preview shows the new first or last
  frame.
- **Split:** with the playhead inside the selected clip, **Split** cuts it there.
- **Move and reorder:** long-press a clip and drag it. **Reorder** in the clip tools reminds you.
- **Delete** removes the selected clips and leaves a gap. **Delete & close gap** removes them and
  pulls everything after them forward. They are two separate commands on purpose: nothing shifts
  your timing unless you ask for it.
- **Duplicate** copies the selected clips right behind themselves.
- **Text:** with nothing selected, **Text** opens a sheet with a line above the keyboard and adds the
  title at the playhead. Cancel adds nothing.
- **Undo and redo** take back every step above, one at a time.

Sheets (media, text, export, projects) rise from the bottom with **Cancel** and **Done**. Cancel
throws the draft away and never changes your project; **Done** commits it as one undo step.

## Design your video

Every design tool opens as a sheet under the preview, so you see each change live. **Cancel** throws
the change away and leaves your project exactly as it was; **Done** keeps it as one step you can undo.

**Effects, filters and colour:** select a clip and tap **Effects** to browse every effect of the
editor by group, or search for one, and tap a card to add it. Your clip's effects are listed above the
cards: switch one off, move it up or down, remove it, or drag its slider to set its main value. With
nothing selected, **Effects** adds an adjustment layer at the playhead that changes everything below
it (Brightness, Contrast, Saturation, Invert and Gaussian Blur so far). **Filters** puts one look on
the clip, with **Strength** to make it subtler and **None** to remove it. **Adjust** changes the
colour: tap a tile (Brightness, Exposure, Contrast, Saturation, Temperature, Tint, Highlights, Shadows
and more) and drag the slider; **Reset** and **Reset all** go back to the defaults.

**Transitions:** wherever two clips meet on a track, the timeline shows a small square at the cut. Tap
it, pick a transition (Dissolve, Wipe, Slide and more) or None, and set its length. **Apply to all
cuts** gives every cut on that track the same transition. A square turns solid once its cut has one.

**Speed:** select a clip and tap **Speed**. Under **Normal**, drag the slider (0.1x to 10x) or tap a
preset; the clip gets shorter or longer on the timeline. **Keep pitch** keeps voices natural and
**Reverse** plays the clip backwards. Under **Curve**, a preset such as Speed up or Slow middle
changes the pace inside the clip and keeps its length.

**Sound:** select a clip and tap **Volume** for its level (silent to +18 dB), **Mute**, **Fade in** and
**Fade out**; on a video clip it changes the video's own sound. With nothing selected, **Audio** adds
**Music & sounds** from your phone at the playhead, records a **Voiceover** with your microphone, or
**Extracts the audio** of the video under the playhead into its own clip.

**Text style and animation:** in the Text sheet, the tabs above the text row set the font, size,
colour, outline, shadow and alignment while you type. To change a title later, select it and tap
**Edit text**. **Animation** brings a clip **In**, takes it **Out**, does both (**Combo**) or builds a
title letter by letter (**Reveal**); the slider sets how long it takes. The presets are ordinary
keyframes, so they open unchanged in the full editor.

**Keyframes:** select a clip, move the playhead and tap the **diamond** in the transport. It keys the
clip's position, size, rotation and opacity there and fills while you stand on a keyframe; tap it
again to remove those keys. **Keyframe** in the clip tools lists the animated properties, jumps to the
previous or next key and deletes one.

**Mask, crop and canvas:** **Mask** cuts the clip with a shape (Linear, Mirror, Circle, Rectangle,
Star, Heart) with position, size, angle, **Soft edge** and **Invert**. **Crop & transform** crops to a
ratio or edge by edge, and moves, scales, rotates, fades or flips the clip; **Fit** and **Fill** size
it to the frame. With nothing selected, **Overlay** puts a photo or video on top of your picture at
the playhead as a picture in picture, and **Format** changes the whole canvas (9:16, 16:9, 1:1, 4:5,
4:3, 21:9) while keeping every clip in proportion.

## Export and share

**Export** (top right) opens the export sheet for the composition at 1080p. It needs at least one
clip; without a clip it says so. You see a summary, a progress bar and **Cancel**. When the file is
ready, **Share** hands it to the phone's share sheet (`navigator.share` with the file) and **Save**
downloads it; phones without file sharing offer Save.

**Tip:** a greyed-out tool is not hidden on purpose. Tap it: it tells you why it does not work on
the phone yet. Until then, the same project opens in the full editor (tap the project name, then
**Full editor**).

## Assistant (beta)

The speech-bubble button in the top bar opens the assistant: the same MasterSelects chat as on the
desktop, in a tall sheet with the preview above it. Ask for an edit in your own words ("cut the
pauses", "add a title that says Berlin"). The assistant uses the same tools as on the desktop, and
every change is a normal step on the timeline that you can undo. It needs an account with AI access,
like the desktop chat. **Close** keeps the conversation; it continues on the desktop too.

## What works today

The phone editor grows in milestones. **M0** proved touch and speed, **M1** brought the story cutter
(projects, gallery import, trim, split, move, delete, titles, export, reopening) and the assistant as a
beta, and **M2** (this version) the design tools above. Captions, multiple compositions, every
parameter of an effect and the other pro tools follow with **M3**; the landscape editors (nodes,
mixer, multicam, colour wheels) with **M4**. Every tool already has its place and shows its milestone
when tapped.

## Technical details

- Entry: the path `/m` (also `/m/…`) resolves to the `phone` experience in
  `src/routing/entryExperience.ts` and loads `src/components/mobileSkin/PhoneApp.tsx` lazily, without
  the desktop `App`. Before the first render, `src/main.tsx` sends phones from `/` and `/editor` to
  `/m` (`src/routing/phoneEntry.ts`): a phone is a device whose primary pointer is coarse and whose
  screen has a short side below 600 CSS px, so tablets and unfolded foldables stay in the desktop
  editor with its automatic Mobile dock layout. `?test`, `?entry=editor`, `/medium`, `/chat` and
  deep links below `/editor/` never move, and neither does the installed app (display mode
  standalone, fullscreen or minimal-ui), whose manifest scope is `/editor`. **Full editor**
  (`project/phoneFullEditor.ts`) saves and stores `ms.phoneEditor.preferFullEditor` in
  localStorage (without storage it opens `/editor?entry=editor`); the desktop **Mobile** toggle on a
  phone and **Layouts → Phone editor** (`src/components/common/openPhoneEditor.ts`) save, clear
  that choice and open `/m`. Both refuse while an export runs (`services/project/editorSwitchGuard.ts`),
  and a failed save keeps the current editor open and shows why. The Android app serves `/m` as an
  editor entry (`EditorUrlPolicy.java`). Opening a stored project sets the media store's
  `currentProjectName` from the project itself (`editorProjectionActivation.ts`), and renames update
  it, so the top bar, AI audit and export names show the real name after a reload.
- Runtime: `runtime/PhoneRuntimeHost.tsx` owns the single `useEngine()` and `useGlobalHistory()`,
  mounts the playback and FlashBoard runtime hosts and restores the last project like the desktop
  toolbar (`runToolbarProjectBootRestore`, then `setupAutoSync`).
- Home: `home/PhoneHome.tsx` replaces the desktop project chooser. It shows when no project is open
  or when `requestPhoneHome()` (top bar Projects, project sheet) fires; everything goes through
  `project/usePhoneProjectCommands.ts` (create, open, import archive) and a failed command is shown
  inline. Only a stored project that needs its folder access again still uses the desktop
  `EditorProjectSelectionOverlay`, because the phone home has no resume command.
- Sheets: `sheets/PhoneSheet.tsx` is the frame (Cancel, title, Done; `half` is 45 % and `tall` 75 % of
  the visual viewport, lifted by `--phone-keyboard-inset`; Escape, Cancel and a backdrop tap cancel;
  focus moves in and back). `sheets/PhoneSheetHost.tsx` renders the sheet of
  `usePhoneUiStore().activeSheet` from the lazy `sheets/phoneSheetRegistry.tsx` (`projects`, `media`,
  `title`, `export`) through a portal into `.phone-shell`, so toasts and notices stay above it. While a
  sheet is open the preview is resized to the space above it (CSS `:has()`), never unmounted. A sheet
  chunk that fails to load shows a toast and closes.
- Clip edits: `actions/phoneClipEditActions.ts` holds delete, ripple delete and duplicate for the
  selected clips; `actions/phoneActionCatalog.ts` wires them, the sheets and the hints to the toolbar.
- Design sheets (M2): `effects/` (Effects, Filters = the editor's Looks via `applyLookToClip`, Adjust =
  the clip's colour grade Primaries), `transition/` + `timeline/PhoneCutButtons.tsx` (cut buttons,
  the editor's transition operations), `speed/` (`setClipSpeed`, `setClipPreservesPitch`,
  `toggleClipReverse`, `setClipTimeRemap` curves), `audio/` (volume and fades, `setClipAudioMuted`,
  music import, voiceover recording, extract audio), `text/` (title styles), `animation/` (In / Out /
  Combo / Reveal presets written as transform, opacity and text keyframes), `keyframe/` +
  `shell/PhoneTransport.tsx` (diamond and keyframe list), `mask/`, `crop/`, `overlay/` and `format/`
  (`updateComposition` with `resizeLayout: 'relative'`). Every sheet edits through
  `sheets/phoneEditSession.ts`: live changes inside one owned transaction (a repository gesture, or a
  history batch without a repository), **Done** commits one undo step, **Cancel** or closing the sheet
  rolls back to the exact earlier state. Options the phone cannot do yet stay visible, greyed, and
  explain themselves on tap.
- Editor changes made for M2 (also on the desktop): the timeline action `setClipAudioMuted` with a
  **Mute** row in the Properties Volume tab (`clip.audioState.muted` was honoured by playback and
  export but had no control); `updateComposition(id, updates, { resizeLayout: 'relative' })` keeps
  clips in proportion when the canvas changes (the default `'pixels'` is unchanged); the layer cache
  rebuilds when a lazily loaded image finishes (`getLazyImageStatusRevision`), so a photo added under a
  paused playhead appears at once.
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
  `PHONE_SHIPPED_MILESTONE` in `contracts.ts` (now `M1`) decides which ones work. Unavailable actions
  are focusable, `aria-disabled` and explain themselves on tap.
- Assistant beta: `assistant/PhoneAssistantSheet.tsx` mounts the existing `FlashBoardComposer` in chat mode
  (cloud service) with the story workflow provider the desktop dock normally supplies, and activates the
  primary chat workspace like `/medium`. No prompt, tool or kernel code changes.
- Tests: `tests/unit/phoneTimelineGeometry.test.ts`, `phoneCutActions.test.ts`, `phoneActionCatalog.test.ts`,
  `entryExperience.test.ts`, `phoneEntry.test.ts`, `WorkspaceBar.test.tsx` and the `phone*` unit tests of
  each M2 sheet; Playwright `m2-*.spec.ts` prove for every sheet that Done changes the picture, one Undo
  restores it and Cancel leaves pixels and timeline unchanged; Playwright journeys in `tests/playwright/mobile/` (`npm run test:e2e:phone`,
  Pixel-7 and iPhone viewports with touch). The phone emulation does not spoof an Android user agent:
  the engine's Linux/Mesa presentation path is keyed on "not Android", and a spoofed Android agent on a
  Linux test host leaves the WebGPU preview black.
