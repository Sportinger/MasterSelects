---
title: "Inspector performance"
---

Effect and node controls keep DOM interaction on the main thread. Pointer drags
coalesce to one value per animation frame, with a synchronous final flush before
the undo transaction closes. Shared inspector number rows open a transaction only
when no enclosing transaction owns the gesture. Typing and resets stay immediate.

Image-effect inspectors prepare graph metadata in a shared module worker.
Normalization, composition recognition and expansion happen once per authored
graph revision, rather than during every React render. Ordinary parameter values
and playback updates reuse the same graph. Inspector metadata does not require
shader compilation; renderer validation and compilation remain unchanged.

One worker job runs at a time. Unsubscribed pending revisions are removed, late
answers remain attached to their original revision, and at most 32 unused/completed
revisions are retained alongside active subscribers. Worker errors are visible;
they do not silently trigger expensive synchronous work in the inspector.
Non-image graph families keep their existing preparation path.

Exposed numeric node bindings use the normal property/keyframe update path instead
of cloning and revalidating the whole graph as a structural edit. Graph-local
constants and connections still use structural validation. Slit Scan numeric
geometry programs reuse their instruction plans when only uniform values change;
resource-affecting changes and graph revisions still compile a new plan.

This does not move all rendering or project/history serialization into a worker.
The default render host remains the main host with WebGPU effect execution. The
manual `tests/manual/inspector-graph-worker.html` probe checks real worker output,
metadata parity, revision reuse and event-loop responsiveness while the job runs.
