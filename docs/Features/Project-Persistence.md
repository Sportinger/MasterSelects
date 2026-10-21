# Project Persistence

[Back to feature index](./README.md)

Projects use a repository with continuous saving and durable, branching history.
A repository can live in a selected filesystem folder, browser storage (OPFS),
or a folder accessed through the Native Helper. See [Project Repository and
Durable History](./Project-Repository.md) for its format and transaction model.

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

FSA handles may require permission again after reload. Reopening a recent
project or restoring the last project's folder access also re-requests read
access to that project's known media source folders in the same click, before
the project loads, so linked media reconnect without a separate step. Media
that still lack access are offered in the Reconnect media dialog; choosing
"Allow on every visit" in the browser prompt avoids the prompt after reloads.
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
verified). In a read-only tab (another tab writes the project) a chosen folder
cannot save new media locations: its reconnect dialog says so and offers to reload
the tab once the writing tab is closed. Opening a composition checks all of its
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
  there; the tab then uses OPFS, also across reloads. Locations carry an
  explicit `store` (`opfs`/`indexeddb`) so one tab can address both stores.
- **Download .msproj archive** named after the project (full history); on
  iPhone/iPad it lands in the Files app. The open project stays temporary.

A temporary copy is removed only after its permanent copy is open, writable and
contains the last confirmed revision; on any failure it stays and the dialog
says so. The scratch browser recovery is never deleted. The dialog also shows
whether the browser keeps its storage (`navigator.storage.persisted()`), can
ask for it (`persist()`), and on iPhone/iPad notes that Safari grants persistence
by its own heuristics, most likely for the Home Screen app, whose storage is
separate. When a tab can use OPFS while projects remain in the fallback
database, the button reads "Move N temporary projects" and moves them with a
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

Pending recovery data is bounded. Storage pressure, lost permissions and I/O
failures can stop further content edits before the pending budget is exceeded.
Retry or protect the pending work before changing projects; a failed flush is
not treated as permission to discard it.

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
not use this ZIP container limit.

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
  its external source folder.
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
  An incomplete copy or an import that does not open is removed again and
  reported. The start-up project chooser offers the same import below the stored
  projects. The stored-project list shows only folders with a project
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
[Project Repository and Durable History](./Project-Repository.md). Existing
media, audio, document and timeline codecs are shared with the editor's runtime
restore paths. Provider orchestration remains in the separate private kernel.

Repository changes are verified with explicitly named regression tests, the
final application build, relevant Native Helper checks and live editor flows.
The full Vitest suite is not part of the shared-workspace verification command.

Related features: [Media Panel](./Media-Panel.md), [Timeline](./Timeline.md),
[Audio](./Audio.md), [UI Panels](./UI-Panels.md).
