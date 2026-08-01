# Root README audit - 2026-08-02

## Verified

- Version badge matches `package.json`: `2.4.4`.
- The current code and feature docs support 74 runtime transitions, 37 blend modes, 23 audio FX, supported media formats, the optional Native Helper flows, and the Chrome/Edge WebGPU requirement.
- Feature links and setup commands were checked against the current repository structure and package scripts.

## Outdated or wrong

- The README listed 33 GPU effects and 19 direct runtime dependencies; the current effect registry has 34 effects and `package.json` has 20 runtime dependencies.
- The Multicam AI link targeted a removed `docs/Features/Multicam-AI.md` page and its description claimed hosted Claude EDL generation. It now links to the current audio-sync and multicam documentation.
- The transitions entry described only crossfade, although the current suite contains 74 GPU-rendered 2D and 3D transitions.
- The Native helper was described as providing native decode/encode; the shipped helper documentation instead covers Firefox storage, downloads, and MatAnyone2/MuScriptor sidecars.

## Noteworthy

- Browser codec and export support remains capability-dependent; FFmpeg WASM export is blocking and browser-memory constrained.
- Firefox project storage still requires the Native Helper when File System Access is unavailable.
- Historical, future-facing, and internal-status wording was removed while preserving current constraints and README structure.
