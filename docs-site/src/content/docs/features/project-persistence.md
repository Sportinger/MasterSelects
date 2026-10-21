---
title: "Untitled"
---

﻿# Project Persistence

[Back to feature index](/features/readme/)

Projects use a repository with continuous saving and durable, branching history.
A repository can live in a selected filesystem folder, browser storage (OPFS),
or a folder accessed through the Native Helper. See [Project Repository and
Durable History](/features/project-repository/) for its format and transaction model.

## Choose and open a project

The **Choose project** dialog offers **New project**, **Open existing**, and
remembered recent projects. New projects use a named repository directory.
Cancelling a folder picker leaves the current project and entered name intact.
Invalid names and storage failures remain visible in the dialog.

Browser folder pickers open a selected directory. Where those pickers are
unavailable, the chooser lists projects stored on the device. Recent entries
reuse their remembered location and may need folder permission again.

An existing repository is opened from its `project.msrepo.json` descriptor.
Legacy `project.json` folders and `.msproj` packages are converted in place on
first open: the repository is added to the same folder through a separate,
read-only import path, and the old files stay unchanged. Opening old work does
not overwrite its source format.
An incomplete or unreadable source is reported instead of being replaced with
a new blank project.

Project opening prepares the new session before activation. Switching flushes
the previous session first; failure leaves its state available. Project
switches are outside content undo. Recent, startup, Android and Native Helper
entrypoints use the same session handoff.

## Storage backends

| Backend | Location and access |
| --- | --- |
| File System Access (FSA) | A user-selected directory; browser permissions and directory handles |
| OPFS | The current browser profile and site origin; no system directory picker |
| Native Helper | A granted local directory; helper protocol and operating-system writer ownership |

All three use the same repository format. The browser's IndexedDB databases
cache handles and derived metadata; they are not the authoritative project
history. An unavailable index can be reconstructed from committed records.

A deploy does not change stored project or media links: handles, recent
projects, the workspace id and the repository stay as they are. What lapses is
the browser's permission. Chrome keeps File System Access grants for the
browsing session only (unless "Allow on every visit" was chosen): after a
browser restart, or once every tab of the site was closed, a stored folder
reports `prompt` again; a same-tab reload (including the version reload after a
deploy) keeps it. The editor then does not reopen the project silently and does
not treat it as lost. The **Choose project** dialog shows **Resume “<project>”**
first (the toolbar shows the same Restore action, also while the startup
recovery scratch is open): one click re-grants the stored folder handle, and
Chrome's restore prompt brings back the folders and files allowed on the last
visit. Reopening a recent project or resuming the last project also re-requests
read access to that project's known media source folders and to media linked as
single files (remembered with the recent entry; already granted ones cost no
prompt, at most 8 further prompts) in the same click, before the project loads,
so linked media reconnect without a separate step. Access that is still not
granted is logged and offered by the Reconnect media dialog. Media
that still lack access are offered in the Reconnect media dialog; choosing
"Allow on every visit" in the browser prompt (or the installed app, see
below) avoids the prompt after a browser restart.
Media imported as single files (picker or drop) keep their exact saved file
location. The dialog's single "Reconnect media" click re-allows those files
directly (up to 8 browser prompts) instead of asking for a folder. With more
files, or when no saved location is left, "Choose folder…" opens the picker in
the folder where an offline file was last found; the chosen folder becomes a
known media folder, so later reloads need only the one-click re-allow. The
dialog shows one large animated status with live found and missing counts while it
checks the composition or searches folders, without any button. Afterwards it
offers exactly one action ("Reconnect media" when the browser needs a click to
re-allow a folder, otherwise "Choose folder…", or "Choose another folder…" with
the missing names after a chosen folder left files missing);
Escape, the backdrop or the close icon postpone it, and single files stay
relinkable from the Media panel. Folder pickers start in the remembered media
folder; without one, the browser reopens the folder last chosen for media
reconnects. Browsers only remember folders per site origin, so a new origin
(for example a second dev port) asks for the folder once. A file relinked on its
own records the known source folder that contains it, so a reopen finds it
without asking again. When a folder search finds several files for one media
item and no saved path decides, the file named exactly like the media wins over
files that only share an older saved file name (size and content are still
verified). In a read-only tab (another tab writes the project, for example an older tab
still open when a new deploy is checked in a second tab) a chosen folder cannot
save new media locations: its reconnect dialog says so and offers **Take over
editing**, which makes the writing tab save and switch to read-only. Opening a composition checks all of its
sources in the background (nested clips and multicam angles included, the
playhead first), so missing media surface together and the reconnect dialog
appears once after the check instead of repeatedly during playback. Allowed
folders are searched automatically, one search at a time, whenever media go
offline that no search has looked for yet. Full-content source hashing pauses
while media are reconnected, because both read the same, often external, disk. A chosen
folder that holds a known folder's saved media (for example the same drive after
it was mounted elsewhere) takes that folder's place, so every saved location
under it reconnects without a search.

Saved media locations (source folder and relative path) are part of the
browser's project workspace, together with layout and playhead. Every tab of a
browser reuses one workspace, so closing the tab and reopening the project later
keeps them. A workspace that has never stored a value (another browser, origin or
machine) reads it from the most recently written workspace of the project
instead of starting without media locations.

The relink dialog shows each known source folder with one of its saved paths
("contains …"), so the right folder is recognizable. A remembered folder that no
longer holds its saved media, or a newly chosen folder without them, is not
rebound to that source folder: the dialog names the folder that is needed and
still searches the chosen one for matching files.
If browser storage was
cleared, select the existing project folder again. The filesystem directory
can still exist even when its cached browser handle has been lost.

OPFS projects are subject to browser quota, eviction and clearing site data.
Persistent-storage permission reduces eviction risk but does not prevent a
user from deleting site data. OPFS projects do not become independent backups
merely because the browser remembers their names.

WebKit (every iOS/iPadOS browser) can refuse OPFS with an opaque `UnknownError`
while its storage process resumes, in Private Browsing, in in-app browsers or on
a nearly full device. Opening the project root and the scratch recovery retries
once; if OPFS stays unavailable, browser projects switch to an IndexedDB
fallback (`ms-browser-project-storage`) that serves the same directory/file
handle surface, so project creation, saving, scratch recovery and `.msproj`
export keep working. The choice is made on the first storage access and kept
for the tab (`sessionStorage`), and the storage worker adopts the editor's
choice, so one project never spans both stores. While the fallback is active
the save status reads "Temporary storage", explains that Private Browsing and
in-app browsers may delete the project when the window closes, and a warning
styled **Temporary · Save permanently** button sits next to it (only "Save" on
phone widths). Both open the *Save this project permanently* dialog, which
offers only the destinations this device supports, best first:

- **Save to a folder** (folder picker or Native Helper): the existing Save As
  copy of the repository with history, journals and workspace views; the
  editor switches to the folder.
- **Keep in this browser** (when OPFS opens and accepts a write in this tab
  now): the repository is copied into OPFS as a new repository and opened
  there and adopted by the project core, so thumbnails, waveforms and caches
  follow the copy; the tab then uses OPFS, also across reloads. Locations carry an
  explicit `store` (`opfs`/`indexeddb`) so one tab can address both stores.
- **Download .msproj archive** named after the project (full history); on
  iPhone/iPad it lands in the Files app. The open project stays temporary.

Moving between the stores never locks a project read-only: the writer registry
(`ms-repository-identity-locations`) treats `opfs:<origin>:<path>` and
`indexeddb:<origin>:<path>` of one repository as the same project changing
store, and a moved temporary project that gets a new folder name takes over the
writer registration from its verified source. Copies at any other location still
open read-only (Copy/Restore). Renaming (also inside Save As and Keep in this
browser) rewrites only the project root, so media carrying repository-internal
source-identity proofs no longer abort these moves.

A temporary copy is removed only after its permanent copy is open, writable and
contains the last confirmed revision; on any failure it stays and the dialog
says so. The scratch browser recovery is never deleted. The dialog also shows
whether the browser keeps its storage (`navigator.storage.persisted()`), can
ask for it (`persist()`), and on iPhone/iPad notes that Safari grants persistence
by its own heuristics, most likely for the Home Screen app, whose storage is
separate. When a tab itself uses OPFS while projects remain in the fallback
database (a tab still on the fallback only lists them, because Open Project
would not find them there), the button reads "Move N temporary projects" and moves them with a
byte-verified copy (SHA-256 per file) under their repository writer lock; a
project open in another tab is skipped. Only when IndexedDB refuses as
well do project dialogs and the save status explain the cause instead of the
raw browser text. iOS, iPadOS and Android never try the desktop Native Helper.
To test the fallback on a device whose OPFS works, start the dev server with
`VITE_MS_FORCE_BROWSER_STORAGE=indexeddb`; production builds ignore it.

The Native Helper checks granted paths and negotiates repository write support.
A connected helper with ordinary file commands does not by itself prove that
it can safely own a repository writer. Native protocol or ownership failures
are reported rather than silently weakening the commit protocol.

Only one writer owns a repository. A second session can browse read-only.
Read-only history navigation does not publish project changes or bypass the
active writer's ownership.

A read-only tab shows **Take over editing** next to the save status; its
tooltip names when the writing tab started editing and whether it is in the
background. The action asks the writing tab to save, reopen itself read-only
(it then says "Editing moved to another tab") and release the writer lock;
this tab then reopens the project with write access. If no tab holds the lock
(the writer was closed, or folder access was missing), the action reads
**Enable editing** and reopens directly, requesting folder access first.

A read-only tab does not follow the writer's edits live. The writing tab
announces every saved revision on the handover channel; a read-only tab that
shows an older revision (including a former writer after a handover) then says
"This project changed in another tab" and offers **Reload**, which reopens it
read-only at the latest saved revision. While a handover or reload runs, the
toolbar buttons stay focusable (`aria-disabled`); when the focused button
disappears after a keyboard takeover or reload, focus moves to the save status
instead of falling to the page body.

During a project open or reopen, media entries exist before their runtime
files are restored. Composition previews log such clips at debug level as "not
loaded yet" (not as "Media file not found") and rebuild the composition once
the file arrives; an entry that stays without a file outside a load is reported
as offline or needing relink.

### Installed app keeps folder access

MasterSelects is installable as an app in Chrome and Edge on Windows and Linux
(`public/manifest.webmanifest`, linked from `index.html`: start URL `/editor`,
scope `/`, standalone window, `#0f0f0f` theme and background from
`--bg-primary`). Chrome keeps File System Access grants of an installed web app
across browser restarts, so projects opened in the app window do not ask for
their folders again; a browser tab still loses them when the session ends.
While the browser offers installation (`beforeinstallprompt`) and the editor is
not already running as an installed app, the **Resume “<project>”** chooser and
the **Reconnect media** dialog show a dismissible **Install MasterSelects to keep
folder access** hint. **Install** opens the browser's install dialog; the
result is shown (installed, or a pointer to the address-bar install icon when
the dialog could not open) and logged under `AppInstall`. Hiding the hint is
remembered on this device. An app installed earlier is not detected from a
browser tab, so the hint is simply absent there: open MasterSelects from its app
window. Grants belong to the window they were made in; folders allowed in a tab
must be allowed once more in the app.

There is no service worker; the manifest only makes the editor installable and
does not cache the app. The icons in `public/icons/` (`any` and `maskable`,
192/512 px, plus a 180 px `apple-touch-icon`) are rendered from the 2048 px
"MS" logo by `node scripts/generate-pwa-icons.mjs` (needs ffmpeg). On iPad, a
home-screen web app has its own storage, separate from Safari's, so projects
stored in Safari's browser storage do not appear there.

## Continuous saving

Completed content actions become immutable revisions and enter the asynchronous
storage queue. There is no manual-only or interval-save mode after repository
cutover. **Ctrl/Cmd+S** requests a flush and waits for the captured content,
history navigation and workspace state to be confirmed.

The visible edit happens before disk confirmation. Hashing, record publication
and filesystem work run through the storage worker. Pending and failed writes
remain distinguishable from confirmed saves. A failure does not clear pending
work or display a successful save acknowledgement.

Small edits encode their affected aggregates. Clips and tracks are separately
versioned, and large data is split into bounded structural blocks. Unchanged
binary artifacts are reused. Saving a keyframe does not rebuild a complete
`.msproj` package or duplicate every mesh and audio result.

Workspace changes such as playhead, zoom, scroll and dock layout use coalesced
view slots. They do not append content revisions on every playback tick. Each
view has two slots so an interrupted update can retain its last valid value.
A workspace that lacks a view (a new tab, browser or machine) takes it from the
workspace that wrote it most recently. Each slot stores its write time
(`updatedAt`), because the Native Helper backend reports no file times; slots
written before that field existed fall back to the file time, and equal times
pick the lowest workspace id, so every reader chooses the same source.

Pending recovery data is bounded. Storage pressure, lost permissions and I/O
failures can stop further content edits before the pending budget is exceeded.
Retry or protect the pending work before changing projects; a failed flush is
not treated as permission to discard it.

### Folder access paused while a project is open

Chrome can also withdraw a session-only grant while the project is open, for
example after the tab sat in the background. The editor treats that as a pause,
not as a failure or a missing file:

- **Detection.** The storage worker reports a refused read or write
  (`NotAllowedError`/`SecurityError`) with the repository code `access`
  (`permission` stays reserved for repository policy refusals). Returning to the
  tab, window focus and a 30-second check also query the project folder and the
  media locations this session already opened, so the pause shows before a save
  fails.
- **One toolbar state.** The toolbar shows "Folder access was paused by the
  browser" with **Re-allow**; the save status reads **Access paused** (not
  "Save failed") and re-allows on click, as does Ctrl/Cmd+S.
- **No data loss.** Edits keep committing in the tab; their writes stay queued
  in order. Re-allow asks for the project folder first (Chrome's restore prompt
  can bring back the other folders with it), then the media folders and files of
  this session, and republishes every queued write before the pause clears. If
  the browser refuses, the pause and the queue stay.
- **No relink dialog.** Media whose saved location only waits for the prompt,
  and whose access worked earlier in this session, stay "not opened yet"
  instead of offline; export explains the pause. After Re-allow they open from
  their saved locations. Media that still cannot be read then go to the
  Reconnect media dialog as before; locations never allowed in this session
  (e.g. after a browser restart) keep using the Resume and Reconnect flows above.
- **Interrupted writes.** A write cut off after its file was created leaves an
  empty file whose removal the browser also refused. Immutable records are
  never empty, so a later retry finishes that file instead of failing with a
  conflict.

## Save status and lifecycle

Save status belongs to the active repository session. Its operation receipt
tracks content and navigation independently of the currently selected revision,
so undo followed by Save confirms the new cursor position as well as the
required records.

Closing, switching and development reload handling use the same persistence
boundary. Asynchronous jobs retain their original session and source identity.
A result that finishes after a switch cannot modify the destination project.
Scratch recovery follows the same domain serialization rules as named projects.

A repository with no write ownership remains explicitly read-only. Local
navigation in that session must not be reported as a new repository commit.

## What gets saved

| Category | Examples | Restored by content undo? |
| --- | --- | --- |
| Project content | Composition settings, clips, tracks, keyframes, effects, masks, markers, authored In/Out ranges and per-composition master audio | Yes |
| Other authored domains | Documents, graphs, MIDI mappings, tracking results, storyboard decisions, generated items, export settings and saved job definitions | Yes |
| Workspace | Active tabs, selection, playhead, zoom, scroll, panel layout, inspector state and display preferences | Separately preserved |
| External journals | Conversations, provider requests, job events, execution evidence and Agent Timeline records | No |
| Artifacts | Original media, document attachments, audio bakes, transcripts and analysis results | Through immutable references |
| Runtime | File handles, object URLs, DOM/media elements, decoders, GPU resources and running workers | Recreated, never serialized into content |

Undo does not restart an export or provider request and does not erase chat.
Selection is cleaned up when its referenced object no longer exists. Each
composition remains the owner of its timeline and master audio state.

Temporary camera `NO KF` live offsets remain preview-session state. Provider
credentials and authentication state are excluded from portable project
records and archives.

## Media and relinking

**Media Source → Link proxy file…** links another file to a video media item, for
example an H.264 copy of a codec the browser cannot decode in real time. The original
stays the media's identity; the linked file plays, and Media Source switches back.
Exports always render the originals: for the export run, media playing a linked
proxy switch to their original and back afterwards (the saved choice is unchanged;
an unreachable original keeps the proxy and logs a warning).

Original media can remain linked to its selected source location. A source-root
identifier and relative path describe the binding; browser directory handles
stay in local handle storage. The relink dialog and **Preferences > Import >
Connect source folder** can restore access to a selected source tree.

Chromium uses directory handles when available. Folder upload remains a
session-level fallback on browsers without those handles. Project-local or
imported retained bytes can be read from the repository before requesting an
external source again.

Linking only survives a reload where the browser can keep the file's handle in
IndexedDB. The editor measures this with a real handle (an aborted probe write,
never the user agent): WebKit (Safari on iPhone, iPad and Mac) refuses handles
with `DataCloneError`, so there - and for every file without a reopenable
location, such as `<input>` picks - imports and relinks are copied into the
project's `Raw/` folder by default. This works in named projects and in the
browser recovery project, in OPFS and in the IndexedDB fallback, and the copies
move along with **Save permanently**. A notice shows the copied size and the
browser storage left, reports copies that fail (the media stay usable until the
next reload) and offers **Link future imports**; **Preferences > Import > Copy
media that cannot stay linked** holds that per-device choice
(`ms.media.linkWhenNotDurable`). Chromium keeps linking as before.

The old size-plus-file-prefix fingerprint is a lookup hint. Historical source
identity requires a full content hash: equal filenames, sizes or the first
2 MiB do not prove that the original bytes are unchanged. Replacing a source
creates a new source version; it must not silently reinterpret old revisions.

Artifact binary data and its metadata have separate identities. New metadata
produces a new immutable manifest even when the binary bytes are identical.
Retained branches, named versions and journals protect the versions they use.
Cleanup cannot delete another project's data or confirmed historical
requirements just because the current timeline no longer displays them.

If media is unavailable, use the Media panel's relink action to restore access
or select a replacement. Historical originals that were never retained cannot
be reconstructed from metadata alone.

## History and named versions

Undo and redo navigate existing revisions. Editing an older revision preserves
its former future as another branch. Named versions are durable references to
chosen revisions and are separate from Save.

The History panel loads bounded pages and renders only its visible rows.
Keyboard navigation uses logical positions so it can reach revisions outside
the currently rendered page. In-memory cache limits do not truncate on-disk
history.

A checkout prepares domains and runtime resources asynchronously, then publishes
one shared content generation for rendering and audio. A failed activation
restores the previous state instead of exposing a partly restored project.

## Archives, duplicates and backups

The File menu's transport actions distinguish current-state, named-version,
selected-branch and full-history archives. `.msproj` is an explicit archive;
it is not the active continuous-save container.

A self-contained archive includes the dependencies required by its selected
scope, including verified original media. Unavailable historical bytes are
reported rather than replaced with a same-named current file. Import does not
require the source repository's IndexedDB index.

The current `.msproj` archive writer uses classic ZIP. It rejects archives at
the 4 GiB size boundary or 65,535-entry boundary instead of emitting an invalid
file; ZIP64 is not supported. Directory-based repository storage and backups do
not use this ZIP container limit. The exported file is named after the open
project (`<Project name>.msproj`); only an unnamed project falls back to
`MasterSelects Project.msproj`.

Restoring an archive streams it entry by entry: entries are stored strictly in
archive order, so a small entry never waits behind a later entry that still
needs input (this ordering once hung the import at "Reading selected project
10%"). If no entry makes progress for two minutes, the restore fails with an
"Archive extraction stalled" error naming the entry instead of hanging silently.
Work on an entry that does not read archive bytes (digesting an already staged
copy of a large file when a restore resumes) reports progress itself, so it
never trips the watchdog. A repository archive is recognised at its first
repository entry instead of being buffered in memory as an old package first.
The restore stages into `repository-archive-staging/<import>`; that copy is
removed once the project holds it, after a failed in-place import, and after a
cancel. Only a failed import into a separate folder keeps it, to resume from.

Duplicates receive a new repository identity and retain the content lineage.
Incremental backups preserve the source's immutable descriptor and commit chain;
opening a completed backup imports it into a separate editable repository with
a new identity. A backup is complete only after its required dependencies are
present and confirmed.

Legacy imports preserve raw historical evidence, including multiple roots and
ambiguous snapshots. Missing composition context is not invented to make an
unreconstructable snapshot appear navigable.

## Workspace and recent projects

Dock layout, active composition/document tabs, media-panel presentation,
playhead and timeline view state are restored independently of content history.
Global named/default layouts remain application preferences. The Output
Manager's browser window identity and position remain browser/runtime state.

Recent entries remember the repository location. Access or read failures remain
visible with a recovery action; reconnect the original location rather than
create a replacement project. Clearing the recent list does not delete project
files. Clearing browser site data is a different operation and can remove OPFS
projects as well as cached handles.

## Troubleshooting

- **Folder permission is missing:** reconnect the existing project directory or
  its external source folder. To stop the prompt after every browser restart,
  install MasterSelects as an app (see *Installed app keeps folder access*) or
  choose "Allow on every visit" in the browser prompt.
- **"Folder access was paused by the browser":** click **Re-allow** and accept
  the browser prompt; choose "Allow on every visit" or install the app to avoid
  it. Queued changes are saved afterwards.
- **Project is read-only:** use **Take over editing** in the toolbar. If the
  writing tab does not answer within a few seconds while it still holds the
  lock (a frozen or suspended tab), the toolbar says so: switch to that tab or
  close it and try again. Deleting media in a read-only tab is refused up front
  with the read-only notice instead of failing midway.
- **No project folder picker:** browsers without the File System Access API
  (Firefox, Safari) open project folders only through a running Native Helper.
  Without it, File > Open Project lists the projects stored in this browser and
  offers **Import .msproj archive**: the archive is copied into a new
  browser-storage project folder (`Name`, `Name (2)`, …) and opened there, which
  restores a repository archive or converts an older `.msproj` package in place.
  The archive is streamed from disk into browser storage; the log line
  `Project archive copied into browser storage` reports setup and copy times.
  An incomplete copy or an import that does not open is removed again and
  reported. While the import runs, **Cancel import** (or Escape, or closing the
  dialog) aborts the copy, the archive restore or the conversion; the partial
  project folder and its staging are removed and the open project stays as it
  was, including its save status. The start-up project chooser offers the same
  import below the stored projects, where **Back** turns into **Cancel import**
  while it runs. A failed or cancelled open of another project never marks the
  open project as "Save failed". The stored-project list shows only folders with a project
  (`project.msrepo.json`, `project.json` or a not yet imported `.msproj`), not
  model caches or repository staging folders.
- **Writes are pending or failed:** inspect the storage error, restore access or
  available space, and retry. A pending edit is not yet a confirmed disk save.
- **The history index is unavailable:** records remain authoritative; allow
  reconstruction or fallback queries rather than deleting project data.
- **Media is missing:** restore source access or select a replacement. A backup
  without historical original bytes cannot recover those bytes.
- **Browser storage is unavailable:** protect recoverable work before resetting
  the browser. Clearing site data can delete the project itself.

## Implementation and verification

The public repository format and module boundaries are documented in
[Project Repository and Durable History](/features/project-repository/). Existing
media, audio, document and timeline codecs are shared with the editor's runtime
restore paths. Provider orchestration remains in the separate private kernel.

Repository changes are verified with explicitly named regression tests, the
final application build, relevant Native Helper checks and live editor flows.
The full Vitest suite is not part of the shared-workspace verification command.

Related features: [Media Panel](/features/media-panel/), [Timeline](/features/timeline/),
[Audio](/features/audio/), [UI Panels](/features/ui-panels/).
