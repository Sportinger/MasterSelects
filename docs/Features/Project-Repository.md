# Project Repository and Durable History

[Back to feature index](./README.md)

The project repository stores content and undo history together. Edits produce
immutable revisions; undo and redo move between revisions. Editing an earlier
revision creates a branch and retains the previous branch.

**Undo skips the editor's own background work.** Some revisions are written by the editor itself, not
by you: media verification after an import ("Media verification", source `source-identity`), late
results of import and source jobs (`background`) and persisted job results (`artifact`). Undo and Redo
step over them to your previous or next edit and keep what they recorded, a background commit never
cancels an Undo or Redo that is running, and it does not take away your Redo. The history panel still
lists them. Planner: `transaction/historyNavigationPlan.ts`; background writers wait for a running
navigation with `coordinator.whenNavigationIdle()`. Test: `tests/unit/repositorySystemRevisionUndo.test.ts`.

## Saving and recovery

Content changes are saved continuously. **Ctrl/Cmd+S** waits for the current
content operation, history cursor and captured workspace changes to reach
storage. Saving does not create a named version. A named version points to a
chosen revision and remains available after subsequent edits.

An edit becomes visible synchronously; hashing and filesystem publication run
asynchronously through the storage worker. A successful logical edit is not
itself a disk acknowledgement. Save status distinguishes pending operations,
confirmed operations and failures. Failed writes remain pending for retry.

Clip-value and keyframe drags keep their intermediate values in the live timeline. An owned
gesture reserves the affected clip aggregates and keeps only their original immutable values;
it does not encode every pointer sample into repository entities or composition snapshots.
Release encodes the final state and saves one revision. Cancellation restores the initial values
without saving intermediate samples, while unrelated clip edits stay independent. Structural edits
within the same gesture flush the current preview before taking the normal mutation path.

A gesture's input owner (the pointer or control that started it) stays current for the whole
native event dispatch, including the microtasks between its listeners, and ends only when the
dispatch is over. A slider or drag started from a React handler therefore joins one gesture and
becomes one undo step instead of one step per frame. A history `startBatch` called while an editor
transaction is already running joins that transaction instead of opening a second gesture that
would stay open and block Undo (`transaction/editorGestureOwnership.ts`,
`src/stores/historyStore/index.ts`).

Consecutive revisions from one AI assistant request (source `agent-request:<id>`) form a single
Undo/Redo step, however many tool calls the request makes; a user revision in between splits the
step (`transaction/historyNavigationPlan.ts`).

A tool call is one transaction of its request, also when it writes after an await (a text clip is
added after its canvas is rendered, an import places clips after decoding). A transaction covers
only synchronous work, so such work carries it explicitly: the tool captures it before its first
await (`captureToolTransaction`, `transaction/editorTransactionBinding.ts`) and runs each later write
phase through it; async store actions such as `addTextClip`, `addCompClip`, `addCaptionClip` or media
deletion capture their caller's transaction the same way and commit after preparing. Nothing else joins
a tool's transaction: a background result, a timer or a user edit during the await (also from drop,
paste or double-click) keeps its own revision, and a second tool running meanwhile (the dev bridge next
to a chat) keeps its own step. Inside `executeBatch` and editor streams every step's writes after its
own awaits join the batch the same way (`addClipSegment` trims and de-clicks the inserted clip in it).
A tool write after the tool's transaction already closed (a timed-out tool that kept going) is its own
assistant step of the running request and never joins a user's sheet or gesture that is open then. A
captured binding writes only into the project open at capture time: after another project was opened
during the await, a later write is refused (AbortError) and a late result is dropped. Late job results
(proxy generation, clip analysis, scene descriptions) are background revisions that never form an Undo
step, also when they arrive inside a store action that started during a sheet's or a batch's await: the
innermost transaction entered decides, not the enclosing action. A background write begins its
transaction only with its first content change, so job progress and loading flags open, commit and
announce nothing; and while the project cannot take writes (read-only, storage failure, Undo/Redo
activation, handoff) a content result still updates the editor, is not saved and is logged
(`EditorMutation`) instead of throwing into the job. A failing tool, a cancelled phone sheet or a cancelled drag takes back only its own
writes: the runtime keeps one rollback entry per run of its own writes to a field (a write after another
transaction changed that field starts a new entry), reverts the items each entry changed and keeps what
other transactions changed in the same store fields meanwhile, so store and repository stay identical
(`transaction/editorRollbackMerge.ts`). Lists of `{ id }` items, Maps, Sets, lists of unique values and
plain records are reverted per item or key; in a `{ id }` item another write replaced since (a load
result on the same clip) only the keys this write changed return, an item another write removed since
stays removed, and a pure reorder is taken back when nobody reordered the list since. Where a revert is
ambiguous (repeated values, a reorder changed again, a key another transaction changed too) the later
value stays and the conflict is logged (`EditorRollback`). A Codex Direct request passes its request
id with every tool call, and its scene-stream bookkeeping (removing a replaced run, storing the scene
document) runs as explicit writes of that request, so the whole request is one Undo step.

A track's record arm, input monitoring, input device
and meter mode are workspace fields, not content: undoing an edit of that track keeps their live
values, and reopening the project restores them (`TRACK_AUDIO_WORKSPACE_FIELDS`).

Filesystem head checks discover the commit folder freshly right before the commit
file is written (inside the folder backend's write queue) and again after the
publication. Backends without that built-in check also discover it before
preparing the publication. Each discovery enumerates that folder once and pages through a
bounded filename snapshot, rather than rescanning it for every page. Independent
checks do not reuse an earlier discovery, so external commits remain detectable.
Snapshots expire, and folders exceeding the memory budget use bounded rescans.

### Folder projects on phones

On Android a project folder is a SAF document provider: every handle call
(look up, take a file snapshot, read, open a stream, close) is a round trip of
20-100+ ms instead of about 1 ms. What counts is the number of calls that must
run one after another. `tests/unit/folderBackendOperationBudget.test.ts` runs the
real main-thread preparation, lifecycle and storage worker against a counting
in-memory folder and fails when these numbers grow (sequential calls, empty
project):

| | before | after |
|---|---|---|
| create | 93 | 38 |
| edit + save | 74 | 19 |
| open | 178 (214 with 3 clips) | 19 (19 with 3 clips) |

How (`backends/directoryFileCache.ts` documents each safety argument):

- **Session caches in the folder backend.** File and folder handles are resolved
  once per session; listings hand over the handles they walk. Segment, commit and
  descriptor files are write-once (writes refuse to replace them), so their bytes
  are read once and records are sliced from memory; readers still verify every
  record and segment hash. Empty files (an interrupted write) are never cached.
  This workspace's view slots are served from memory only from its own write and
  only while it holds the writer locks.
- **Writes verify by size, not by read-back.** After `close()` the backend checks
  the stored length through the same handle and keeps the written bytes for later
  reads. Crash safety is unchanged: the commit file is written last, and on the
  next open recovery hashes every segment against its commit and every commit
  against its successor before it becomes a head.
- **Torn commit files are cleaned up.** A paused Android folder can fail a write
  and its cleanup, leaving an empty commit file (or, from this session's own
  failed write, one that does not parse). No valid chain references it, because
  a successor is written only after its predecessor was verified. Recovery skips
  it without a warning (`TornCommitFileError`, `persistence/publication.ts`), and
  the next head check of the writer removes it inside the write queue; a failed
  removal is logged and retried at the next save, never blocking it.
- **No duplicate work.** One head discovery per publication less (see above), no
  existence stat before an immutable write (the write refuses an existing file
  itself), no size probe for a commit file the head check listing proved absent,
  and the descriptor of a new project is written once, by the worker.
- **Concurrency where order does not matter.** Recovery reads the segments it is
  about to validate ahead (bounded by the cache budget); folder probes when
  opening, sibling folders of a listing, the folders a session uses and the view
  listing run together; view parts are written concurrently and the project
  shape only after all of them; view slot writes do not wait behind content writes.
- **Off the save path.** The startup cache refresh runs after the save returned
  (still serialized with publications); closing the project waits for it.

Rapid edit series (AI agents, scripts, fast slider commits) are group-committed.
While a publication is in flight, later revisions wait in order; the next write
takes the whole backlog of consecutive revisions (up to 32 or about 4 MB) into
one publication. Every revision keeps its own record, parent link and Undo step;
only the per-publication cost (segment write and its size check, validation and both
head checks) is shared. A batch ends after a revision that writes a checkpoint.
A failed batch is retried as the identical batch.

The in-memory pending queue is bounded. If persistence cannot keep up or fails
for too long, further content edits stop before exceeding that bound. Permission,
quota and I/O failures do not advance the confirmed save position.

Project switching first flushes the old session. The destination is prepared
before activation, and a failed handoff leaves the old project available.
Asynchronous results retain their original repository, session and source
identity; finishing an old job cannot attach its result to a newly opened
project.

## Content, workspace and journals

| Data | Storage and undo behavior |
| --- | --- |
| Clips, tracks, compositions, effects, keyframes, masks, audio edits, documents, graphs, tracking results and authored project data | Versioned content; restored by undo and branch navigation |
| Playhead, zoom, scroll, selection, active tabs and panel layout | Workspace view records; preserved separately from content history |
| Chat, provider requests, job events and execution evidence | Append-only journals; content undo does not erase a conversation or restart a job |
| Original media and generated binary results | Content-addressed blobs with immutable artifact manifests |
| File handles, media elements, decoders, workers and GPU resources | Runtime or local handle caches; excluded from portable project records |

Each composition owns its canonical timeline and master audio state. The visible
timeline is a projection of that composition. Switching compositions does not
create a competing copy of the same timeline data.

Checkout loads a selected revision asynchronously, then activates its domains
and rebinds runtime resources behind a publication barrier. Rendering and audio
observe the same content generation. Selection is pruned when its target no
longer exists; workspace navigation does not become content undo.

## Repository layout

```text
Project/
  project.msrepo.json
  .masterselects/
    commits/
    segments/
    artifacts/
    views/
  Media/
  Exports/
```

`project.msrepo.json` identifies the format, repository and content lineage.
The format is shared by File System Access, origin-private browser storage
(OPFS) and the Native Helper. `.msproj` is an explicit archive format; it is
not rewritten after each edit.

Immutable records contain direct references to their dependencies. Each record
reference identifies its hash, segment, byte offset and length. Relocating a
record during archive creation preserves its canonical hash. A small commit
manifest publishes completed records and the new heads only after required
bytes have been written.

Records are limited to 1 MiB and segments to 4 MiB. Larger domain values are
split into bounded structural blocks. Checkpoints limit reconstruction work;
unchanged entities and blobs are reused. A small clip edit does not serialize
every clip in the project.

Large workspace redo-preference maps also use bounded immutable blocks. Sessions
read both legacy inline cursors and blocked cursors, preserving every remembered
branch choice without allowing a long editing history to exceed the 1 MiB record
limit. The blocks remain reachable through the navigation head and are validated
and retained with it during recovery and history archive creation.

Checkpoint records live in the immutable segments and map entity IDs to existing
records; they do not duplicate media. New revisions link their checkpoint
directly. The checkpoint interval is 128 content revisions or 4 MiB of changes,
and its counters survive reopening. Loading a selected revision uses its branch's
applicable checkpoint plus subsequent changes, including when another branch
has a newer checkpoint.

Saving also writes a bounded startup cache into `.masterselects/cache/startup/`
inside the project folder. Two alternating slots and a browser-local checksum
attestation prevent an interrupted write from replacing the last complete cache.
It is refreshed at save/flush boundaries, never for intermediate drag samples;
unchanged saves do not rewrite it. A writable open that had to validate history
beyond the cache also writes it right after opening, so a project closed without
saving is slow to open at most once, not on every later open. No project archive
must be selected manually. Histories shorter than 16 operations
(`STARTUP_CACHE_MIN_OPERATIONS`) get no startup cache: validating them in full
costs about as much as validating a cache, which stats every history file too,
so a new or small project does not spend extra writes, read-backs and an
IndexedDB put at every save point and every open. The threshold only skips
creating a cache: a short project that already has one keeps refreshing it, so
it never reads a stale cache and then validates the history beyond it on every open.

A new project gets one save point, not two: its first revision, journals and
workspace views are handed to the storage worker together and confirmed by a
single flush, and the editor activates the workspace it just wrote instead of
reading the views back.

The per-browser scratch workspace (`repository-scratch/<workspace id>`) is
background recovery for edits made while no project is open. A project open,
create or Save As cancels a scratch open that is still queued or reading,
instead of waiting behind it while "Reading saved project" is on screen. A
scratch open that is creating its repository or activating the editor finishes
first. If the project open then fails, the scratch workspace opens again.

Every open, create, Save As, scratch open and explicit save measures its phases
(`repositoryLoadTimings.ts`): queue, prepare, handoff, target, storage_open,
session_read, initialize, views, workspace, activation, close_previous, and for
saves sync and publish. After a ready open (not a save) the measurement runs on to
the first painted frame and records that time as `first_frame_ms`, so a screen that
stays frozen after the storage work shows up. The report, together with long tasks
and the longest frame gap on the main thread meanwhile, is logged (a warning above 5 s), kept on
`window.__MS_PROJECT_LOAD__` for remote debugging and sent as the
`project_load_phases` analytics event (see [Product Analytics](./Product-Analytics.md)).
Long phases point at storage or the editor; short phases with a long frame gap
point at a screen that did not repaint while the work itself was quick.
`storage_open` starts with the storage worker's start, which includes fetching its
script; the report keeps that part as `workerStartMs` (shown as "storage worker
start" in the log line, not sent to analytics). A long `storage_open` with an equally
long worker start and no long tasks is a slow or stalled network fetch, not storage.

Opening automatically uses this cache when the same browser/location retains its
attestation and every previously validated history file still has the same size
and modification time. Current entity records retain SHA-256 validation when read;
older unchanged history does not undergo another full byte audit. Publications
added after the snapshot are validated and applied, rather than reverting to the
cached version. A changed/missing file, damaged cache, lost browser index, or fork
at older ancestry falls back to complete history validation. Backends without
file modification identities keep that full-validation path. All history and
media remain in place; the cache is disposable and is not a backup or an archive.
The loading indicator reports recovery and activation separately.

Published segments remain immutable. The history cache and history panel page
limits do not delete older on-disk revisions. Workspace views use two bounded
slots per view key, so playback and scrolling do not append permanent content
commits. Views live under `.masterselects/views/<workspace>/`; a browser keeps one
workspace id across tabs and reloads (only one tab holds the repository writer
lock). Keys a workspace has never stored fall back to the most recently written
value of another workspace of the same repository, and only that workspace's own
next write replaces them. The project workspace shape and its parts always come
from one workspace.
The project workspace shape is published after its referenced parts. If an older
interrupted save already published an incomplete shape, opening uses the previous
complete workspace slot while retaining the latest authored project and history.
Unopened media placeholders do not trigger analysis publication. Analysis artifacts
reuse their generation timestamp on reload so unchanged data does not create new
immutable manifest versions or keep the save queue busy.

## Ownership and the local index

One writer owns a repository at a time. Browser storage uses shared browser
locks and location identity; the Native Helper additionally owns an operating
system lock and validates the expected previous commit. A location without
write ownership can be opened read-only.

Writer handover between tabs (`lifecycle/writerHandover.ts`, bound to the
editor in `lifecycle/editorWriterHandover.ts`) runs over the
`ms.repository.writer-handover` BroadcastChannel: a read-only tab asks `who`
writes, the writer answers with its tab id, start time and visibility; a
`release` request makes the writer acknowledge (`releasing`), flush, reopen its
own project read-only so the old worker drops `ms.repository.writer:<id>`, and
confirm (`released`) or report the failure (`refused`). The requester then
reopens through the normal lifecycle and acquires the lock. Without an
acknowledgement within 2.5 s it inspects `navigator.locks.query()`: a still held
lock is reported as an unresponsive writer, a free lock is taken directly.
Every failed step stays visible in the toolbar and is logged as a warning.

IndexedDB is a derived metadata index for revision, branch and named-version
queries. Repository records remain authoritative.
Completed commit indexes are retained on reload instead of clearing and
rewriting every history row. Cold recovery validates authoritative bytes; a valid startup cache reuses its
locally attested history validation. Missing or interrupted index builds are
replayed before being marked complete.
Commit paths are discovered in one paged scan per opening, rather than listing
the entire history folder again for every revision.
Independent commit manifests use bounded parallel reads, and filesystem recovery
reuses directory handles within the session while reading record bytes freshly.
Index loss does not change the project format or require rewriting confirmed history. Queries and the
history panel are paginated; keyboard navigation addresses logical rows,
including rows not currently rendered.

OPFS remains tied to its browser profile and origin. Browser quota, eviction
or clearing site data can remove browser-stored projects. Cached FSA handles
can also be lost while the selected filesystem folder remains intact. Keep
independent backups of work that must survive loss of the browser profile.

## Media and immutable artifacts

A full content hash identifies a source version. The older file fingerprint
based on size and the first 2 MiB is only a lookup hint; it cannot establish
that historical source bytes are unchanged.

Blob identity and artifact-manifest identity are separate. Equal binary data
can be reused by different immutable manifests with different metadata or
source bindings. An older revision's artifact reference retains its original
meaning when a later analysis adds metadata.

Transcript and analysis saves wait for verification of the original media when
its full source hash is not available yet. A missing or changed source fails
the save explicitly; it cannot produce a successful save with an empty source
binding that the reader would later reject. Existing artifacts without a source
binding remain preserved and are reported in `RepositoryArtifacts` diagnostics.
Recover them against the confirmed original media, retaining the old artifact;
never attach them automatically to a relinked source or create a new transcript
just because the binding is missing.

On opening, media artifacts are hydrated after the repository session becomes
active. A lookup before activation is not a completed hydration. Hydration caches
belong to that session; late reads from a previous project cannot populate the
new project's media, even when both projects retain the same media IDs.
Transcript reads, writes and deletion use the active repository on every storage
backend; they do not require a legacy project-folder handle.

Retention accounts for all retained branches, named versions and journals,
including source-bound results. Cleanup must not remove another project's
assets or bytes still referenced by a confirmed revision. External media may
remain linked; a self-contained export must include every required source.

## Legacy import and transport

Opening an old-format project (a `.msproj` package or an older folder with
`project.json`) converts it in place without further prompts. MasterSelects adds
`project.msrepo.json` and `.masterselects/` to the same folder; every existing
file, including `project.json` or the package, stays byte-identical. Import reads
the old files as an explicit, read-only source and never saves back into them.
Project data, sidecars, documents and referenced artifacts are copied into the
repository with their original bytes and provenance. File System Access folders,
browser storage and the Native Helper convert in place the same way.

Media, proxies, renders and caches stay where they are. The converted project
links them through the project-folder media source root, which always resolves
to the open project folder: it needs no extra folder permission, and moving or
copying the whole folder keeps the media linked.

A folder that an earlier version converted into a separate `<name> (converted)`
folder asks once: open that converted project, or convert this folder in place
from its original state. Opening a finished conversion never imports it again,
so edits made after the conversion do not conflict with it.
Reopening rebinds audio, video and image clips as runtime data, including nested
compositions and locked tracks; it does not create an edit or clear audio analysis.
Saved sources are assumed available, including originals embedded in repository
blobs. Opening reads only the current preview/playback sources and nearby playback
lookahead; seeking, switching compositions, source-monitor selection and dragging
media to the timeline open additional sources on demand. Export waits for the
sources used by its composition. Unused library entries are neither opened nor
shown as offline, and there is no automatic whole-library Connecting media scan.
Automatic source opens use saved handles/paths without fingerprint or duration
probes. Only failed access (including an empty original) marks a source offline
and enables reconnection. Explicit relinks retain their validation checks.
External source-root handles are cached directly after connection, so later
opens do not search missing Raw paths in the converted project first.
Successful source validation remembers the physical file handle and its size,
timestamp, name, fingerprint and parsed duration. Reopening the same handle with
the same snapshot requires no media-byte scan. A different handle, changed
snapshot or explicit relink falls back to validation; freshly matching the
fingerprint and size can reuse a previously parsed duration from a bounded local
cache. These caches are derived metadata, not a full SHA-256 source identity.
Legacy media without a saved fingerprint can also reuse a successfully probed
duration, but only with the same physical handle and unchanged file snapshot.
The source-change proof hashes the package and sidecars completely but linked
media only by path and size, so projects with hundreds of gigabytes of footage
convert in seconds. Packages keep the old physical layout: raw media sit directly
in the media folder, caches in its `.masterselects-cache` folder and documents
at the project root. An interrupted in-place conversion starts again
automatically the next time the folder is opened, also when the old files were
changed in between (for example in an older build); an attempt that already
published its commit opens as it is. A separate conversion folder resumes when
the same original is converted into it again; opening that half-converted folder
directly reports that the conversion did not finish.
Listing the old folder walks it once per pass, and the repository's own
`.masterselects/` folder is never part of the legacy source. Regenerable caches
(proxy frames, audio proxies, thumbnails, waveforms and backups) stay usable in
place but are not listed or proven file by file, so tens of thousands of old
proxy frames do not slow the conversion; cached artifacts stay linked. A damaged
sidecar JSON or an unreadable `project.autosave.json` keeps its original bytes
and is recorded in the import provenance instead of stopping the conversion.

Older per-clip keyframes may include a redundant runtime `clipId`. Import
checks that it matches the containing clip and keeps the authored curve fields.
Missing artifact references in archived analysis or journal evidence are recorded
as unresolved source evidence; they do not prevent opening the current project.
Dependencies required by the current project remain mandatory.
Missing legacy waveform-cache bindings are cleared for regeneration, with
source-bound unresolved metadata retaining the original references. Authored audio
state and original/generated audio dependencies are preserved.

Legacy history is preserved honestly. If a snapshot lacks the composition or
source context needed to reconstruct a state, its raw evidence is retained
without inventing that context. Import cannot recover historical media bytes
that the source no longer contains.

Archive scopes distinguish the current state, named versions, selected branches
and full history. Export traverses the dependencies required by the selected
scope and rewrites physical record locations for the destination. A current
state archive can reopen without the source's metadata index or previous
revision chain.

Archive output currently uses classic ZIP, with explicit rejection at its
4 GiB size and 65,535-entry boundaries. ZIP64 is not implemented. These limits
apply to `.msproj` output, not directory-based repository storage or backups.

Duplicates receive a new repository identity while retaining content lineage.
Incremental backups mirror the source's immutable records and identity. Opening
a completed backup creates a separate editable copy with a new identity, leaving
the backup unchanged. A raw filesystem copy with an existing repository identity
must be treated as a restore or assigned a new copy identity before independent
editing.

## Implementation boundaries

- `src/services/project/repository/domains/`: canonical codecs and field ownership.
- `transaction/`: logical edits, mutation ownership, receipts and checkout.
- `persistence/`, `segments/`, `backends/`: record publication and recovery.
- `workspace/`, `history/`, `index/`: view slots and bounded history queries.
- `artifacts/`, `journal/`, `retention/`: immutable results and retained dependencies.
- `import/`, `archive/`, `lifecycle/`: source readers, transport and project handoff.
- `src/workers/projectStorage.worker.ts`: asynchronous repository I/O.

Provider orchestration remains outside the editor repository. The editor owns
deterministic domain mutations, transaction authorization, runtime restoration
and the durable records produced by those operations.

## Recovery and writer failure handling

Browser backends advertise writing only when writable file streams and Web Locks
are available. Older WebKit with readable OPFS but no `createWritable` can read
repositories without being treated as a writer. Scratch recovery rejects that
unsupported capability before creating a project. The toolbar shows preparing
recovery until a session exists, and recovery unavailable after failure; it never
claims browser recovery has saved a project without a repository session. This
is a capability guard, not a synchronous-access-handle fallback for older Safari.

Session handoff holds an outer publication barrier across projection activation
and writer installation. Inner activation cannot release it early. Layouts may
restore geometry during activation/read-only viewing, but cannot create tracks,
change track visibility, or insert a camera then. Interactive tutorials wait for
a writable repository before opening their history batch. Content guards remain
in force for explicit edit attempts against read-only projects.

A rejected edit (`RepositoryError` with code `ownership`: read-only tab,
activation or handoff in progress, content projection being activated) is not
applied. When it escapes a UI handler, the global error hooks
(`src/services/runtimeDiagnostics.ts`, `src/services/editRejection.ts`) record
it as a `WARN` diagnostic ("Edit not applied: …"), keep it out of crash reporting
and show a short "Not applied" notice with the reason. Other repository error
codes stay errors.

Live journals larger than 256 KiB use the bounded aggregate representation already
used by imported journals. Individual string/array/object blocks and mapping pages
remain below the record limit; the logical value is reconstructed on read. Queue
and logical-read budgets remain enforced. Rejected journal enqueue attempts do
not enter the editor's deduplication cache, so the same value can be retried.
Storage worker faults retain their actual code and message instead of being
reported as generic read-only ownership failures.


### Retrying older storage failures

Save retries a failed coordinator queue before capturing further workspace changes.
This ordering also works when the 32 MiB recovery queue is almost full. A transient
owner/discovery/preparation failure that happened before a physical publication was
prepared can be retried; it no longer permanently poisons the writer. Operation
sequence, ownership, immutable-file verification and unique-head checks still run
on retry. Persistent failures remain visible and accepted edits stay pending.

Regression coverage exercises a transient `InvalidStateError`, a blocked queue
filled to its budget, refusal of an excess edit, retry, subsequent edits and a
fresh repository reopen. A separate format regression recreates the old oversized
navigation record with 14,000 branch choices and checks that the existing chunked
representation saves and reopens the same choices intact. These are reproductions
of failure paths, not recovery of the original users' project files.

Fatal worker errors now include the storage phase (startup, opening or ready) and
pending protocol operation names. No request payload or project path is added.
Writer availability subscribers are notified immediately, including while the
worker is idle. A dead worker is not silently replaced while it may have pending
writes; the original error remains available for diagnostics.
