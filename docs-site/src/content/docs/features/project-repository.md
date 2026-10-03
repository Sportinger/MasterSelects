---
title: "Project Repository and Durable History"
---

[Back to feature index](/features/readme/)

The project repository stores content and undo history together. Edits produce
immutable revisions; undo and redo move between revisions. Editing an earlier
revision creates a branch and retains the previous branch.

## Saving and recovery

Content changes are saved continuously. **Ctrl/Cmd+S** waits for the current
content operation, history cursor and captured workspace changes to reach
storage. Saving does not create a named version. A named version points to a
chosen revision and remains available after subsequent edits.

An edit becomes visible synchronously; hashing and filesystem publication run
asynchronously through the storage worker. A successful logical edit is not
itself a disk acknowledgement. Save status distinguishes pending operations,
confirmed operations and failures. Failed writes remain pending for retry.

Filesystem head checks discover the commit folder freshly before and after a
publication. Each discovery enumerates that folder once and pages through a
bounded filename snapshot, rather than rescanning it for every page. Independent
checks do not reuse an earlier discovery, so external commits remain detectable.
Snapshots expire, and folders exceeding the memory budget use bounded rescans.

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

Checkpoint records live in the immutable segments and map entity IDs to existing
records; they do not duplicate media. New revisions link their checkpoint
directly. The checkpoint interval is 128 content revisions or 4 MiB of changes,
and its counters survive reopening. Loading a selected revision uses its branch's
applicable checkpoint plus subsequent changes, including when another branch
has a newer checkpoint.

Reconstructing the current state and validating the repository are separate
steps. Opening still validates the retained commit history; checkpoints alone
do not make that validation independent of history size. A bounded cache reuses
validated records within each commit, so a checkpoint with many dependencies
does not repeatedly decode and hash its parent record. Each new opening checks
the authoritative bytes again. The loading indicator reports import, recovery
and activation separately.

Published segments remain immutable. The history cache and history panel page
limits do not delete older on-disk revisions. Workspace views use two bounded
slots per view key, so playback and scrolling do not append permanent content
commits.
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

IndexedDB is a derived metadata index for revision, branch and named-version
queries. Repository records remain authoritative.
Completed commit indexes are retained on reload instead of clearing and
rewriting every history row. Recovery still validates authoritative bytes;
missing or interrupted index builds are replayed before being marked complete.
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
