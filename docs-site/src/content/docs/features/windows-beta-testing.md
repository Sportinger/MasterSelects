---
title: "Windows beta testing"
---

The first unattended Windows campaign creates a project through the native folder
picker, accepts Chrome's scoped folder permission, imports two clips, drags and
trims timeline clips, edits a rectangle mask, verifies undo/redo, and exports using
WebCodecs Fast. Run `npm run test:e2e:beta` on an unlocked Windows desktop with
installed Chrome, FFmpeg and the reference-media pack.

The campaign waits for project, import, clip and waveform readiness. Preview
checks require stable pixels and compare the source against an independent decode.
Generated fixtures encode an exact frame counter and separate audio tones. Export
checks validate the browser's suggested filename, MP4/H.264/AAC format, dimensions,
duration, audio, all 90 video frames and their presentation timestamps. Playback of
the exported file checks completion, dropped frames and rebuffering in Chrome.

The test exposed a FAST export bug that returned a neighboring buffered frame
before the requested source frame was ready. Export now waits for the exact sample
and fails if it remains unavailable. It also exposed a preview startup race where
Chrome reported loaded media before the first playing frame had a GPU resource;
live texture import now waits for that first frame.

Tests use a dedicated Chrome profile and short project workspace. Teardown closes
only that profile's Chrome processes and removes its temporary project/media files,
including after failures. Evidence remains under the ignored `output/windows-beta`
directory. Cleanup rejects unrelated paths and filesystem reparse points.

Campaign `run-28` passed eight checks in 1.8 minutes on Windows/RTX hardware. Both
real-footage and generated exports presented 90 frames with zero dropped frames
and zero rebuffer events. This covers three-second 640x360, 30 fps fixtures, not all
codecs, resolutions, durations, features or devices. Media import uses a browser
file input; only project-directory selection currently exercises the native picker.
Whole-machine termination still requires a future external cleanup supervisor.

Implementation and evidence details: harness README.
