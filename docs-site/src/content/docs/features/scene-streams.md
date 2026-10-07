---
title: "Scene Streams"
---

[Back to Index](/features/readme/)

A scene stream (`ms-scene-v1`) is a named, re-runnable block of editor tool records that builds a piece of a timeline: tracks, solid and Blank clips, text, Motion Design shapes, stick figures with action clips, keyframes, effects, masks, markers and MIDI clips. It is the timeline counterpart of the [node stream](/features/node-catalog/#codex-direct-node-stream) (`ms-nodegraph-v1`) and uses the same parser (`src/services/nodeGraph/fencedRecordStream.ts`).

## Format

````text
```ms-scene-v1
{"op":"begin","schemaVersion":1,"scene":"Intro"}
{"op":"tool","seq":1,"ref":"fx","tool":"createTrack","args":{"type":"video","name":"Intro FX"}}
{"op":"tool","seq":2,"ref":"hero","tool":"createRig","args":{"trackId":{"$ref":"fx","field":"trackId"},"start":0,"duration":4,"params":{"scale":0.8}}}
{"op":"tool","seq":3,"tool":"addActionClip","args":{"figure":{"$ref":"hero","field":"figure"},"action":"walk","start":0.2,"duration":2}}
{"op":"tool","seq":4,"tool":"addKeyframe","args":{"clipId":{"$ref":"hero","field":"clipId"},"keys":{"opacity":[[0,0],[0.4,1,"ease-out"]]}}}
{"op":"end","lastSeq":4}
```
````

- `begin` names the scene. Optional `compositionId` pins it to a composition; by default a re-run uses the scene's previous composition, else the active one. `replace: false` keeps the previous run's entities.
- `seq` counts from 1 per block. `ref` names the record's result (default `s<seq>`). `{"$ref":"<alias>","field":"<result field>"}` inserts an earlier scalar result (`trackId`, `clipId`, `effectId`, `figure`, ...). Unlike the node stream, args carry `clipId`/`trackId` explicitly.
- Allowed tools: `SCENE_STREAM_TOOLS` in `src/services/scenes/sceneStream.ts` — creation and editing tools, no deletes, project, media-import or playback tools. `getStreamProtocol {"format":"ms-scene-v1"}` returns the full contract with the list.

## Ownership and re-runs

The executor diffs the timeline around every record and records which tracks, clips and markers each record created, so every tool works without per-tool knowledge. Running a scene again first removes everything its previous run created (tracks only when nothing else is left on them), then executes the records again. A scene is therefore edited by changing its text and re-running it; nothing accumulates. Edits a scene makes to clips it did not create are not reverted by a re-run.

Each scene is stored in a project document titled `Scene: <name>`: one code block with the canonical stream text and one with the registry of created ids (`msSceneRegistry`). Scenes save, load and travel with the project like any document. `listScenes` lists them.

## Where streams run

- **FlashBoard Codex Direct (live):** text deltas from the model feed the node and scene parsers as they arrive. A record executes at its closing brace while the model is still writing, through the same audited tool boundary, policy and undo as tool calls. Failed or skipped records are reported to the model with its next tool result and, if never repaired, as a visible chat warning. The chat collapses a scene block to one line (`[Szene „Intro“: 6 Schritte]`). The per-turn reference carries only a short pointer; the full contract is one `getStreamProtocol` call away.
- **`runEditorStream` (dev bridge, chat, console):** the text arrives complete with the tool call, so it is validated first and nothing runs when any record is malformed or not allowed (all problems are listed at once). Then the records of all `ms-scene-v1` and `ms-nodegraph-v1` blocks run in text order as one undo step; a failed record is reported and later records continue. `{ scene: "<name>" }` re-runs a stored scene; `dryRun: true` only validates. Agents outside FlashBoard send complete tool calls, so this path is not token streaming.

After every executed record the editor presents a frame, so a streamed scene visibly builds up.

## Tools added for scenes

- `createSolidClip { trackId?, start?, duration?, color?, blank?, name? }` — solid or transparent Blank clip (host for generator effects).
- `createTrack { type: "midi", instrument? }` — MIDI track with a Simple Synth preset (`sfx-punch`, `sfx-whoosh`, `pluck`, ...).
- `createMidiClip { trackId?, start?, duration?, notes: [{ time, pitch, duration?, velocity? }] }` — note times are clip seconds.
- `createRig { ..., params }` — any visible Stick Figure parameter, validated by name, type and options.
- `addKeyframe { clipId, effectId?, keys: { "<property>": [[time, value, easing?], ...] } }` — several properties of one clip in one atomic step; with `effectId`, bare names address that effect's parameters.

## Sources

- `src/services/nodeGraph/fencedRecordStream.ts` — shared fenced-record parser and `$ref` resolution
- `src/services/scenes/sceneStream.ts` — format, allowed tools, protocol, canonical formatting
- `src/services/scenes/sceneStreamExecutor.ts` — execution, entity registry, replacement
- `src/services/scenes/sceneDocuments.ts` — storage in project documents
- `src/services/aiTools/handlers/editorStream.ts` — `runEditorStream`, `getStreamProtocol`, `listScenes`
- `src/services/flashboard/FlashBoardDirectCodexTransport.ts` — live delta streaming
- `tests/unit/sceneStream.test.ts`
