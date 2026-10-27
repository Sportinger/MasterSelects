# Phone Editor

[Back to Index](./README.md)

<figure class="docs-shot docs-shot--float-right">

![The phone editor at /m with a clip selected: the preview on top, the transport with play, undo and redo, the timeline with its fixed centre playhead, and the clip tools at the bottom with Split active and later tools greyed out](assets/phone-editor/phone-editor-clip-selected.webp)

<figcaption>The phone editor with a clip selected. Tools of later milestones stay visible but greyed out.</figcaption>
</figure>

Open **masterselects.com/m** on your phone to edit with your thumb. It is the same editor
underneath: the same timeline, effects, undo history and projects as on the desktop. A project you
start on the phone opens unchanged at /editor, and the other way round.

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

## Export and share

**Export** (top right) opens the export sheet for the composition at 1080p. It needs at least one
clip; without a clip it says so. You see a summary, a progress bar and **Cancel**. When the file is
ready, **Share** hands it to the phone's share sheet (`navigator.share` with the file) and **Save**
downloads it; phones without file sharing offer Save.

**Tip:** a greyed-out tool is not hidden on purpose. Tap it: it tells you why it does not work on
the phone yet. Until then, the same project opens in the full editor at /editor.

## Assistant (beta)

The speech-bubble button in the top bar opens the assistant: the same MasterSelects chat as on the
desktop, in a tall sheet with the preview above it. Ask for an edit in your own words ("cut the
pauses", "add a title that says Berlin"). The assistant uses the same tools as on the desktop, and
every change is a normal step on the timeline that you can undo. It needs an account with AI access,
like the desktop chat. **Close** keeps the conversation; it continues on the desktop too.

## What works today

The phone editor grows in milestones. **M0** proved touch and speed. **M1** (this version) is the
story cutter: projects, gallery import, trim, split, move, delete, delete and close gap, duplicate,
titles, undo, export with share, and reopening, plus the assistant as a beta. Effects, colour, transitions, speed and audio come
with **M2**; everything else follows. Every tool already has its place in the toolbar and shows its
milestone when tapped.

## Technical details

- Entry: the path `/m` (also `/m/…`) resolves to the `phone` experience in
  `src/routing/entryExperience.ts` and loads `src/components/mobileSkin/PhoneApp.tsx` lazily, without
  the desktop `App`. `?test` and `?entry=editor` still force the desktop editor. `/editor`,
  `/medium` and the automatic mobile dock layout are unchanged.
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
  `entryExperience.test.ts`; Playwright journeys in `tests/playwright/mobile/` (`npm run test:e2e:phone`,
  Pixel-7 and iPhone viewports with touch). The phone emulation does not spoof an Android user agent:
  the engine's Linux/Mesa presentation path is keyed on "not Android", and a spoofed Android agent on a
  Linux test host leaves the WebGPU preview black.
