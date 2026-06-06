# Torture Media Fixtures

This directory holds local media used by the bridge-driven editor torture tests.
The tracked file is only this README; copied media files, generated frames,
reports, and the local manifest stay out of Git.

Prepare the local media manifest with:

```powershell
npm run fixtures:torture-media -- --force "C:\Users\admin\Documents\MS\oper\Raw\kling_20260506_作品_Turbulent__5550_0 (1).mp4" "C:\Users\admin\Documents\MS\oper\Raw\kling_20260507_作品_Hier_dein__4006_0.mp4" "C:\Users\admin\Documents\MS\oper\Raw\kling_20260515_作品_Extreme_ul_5545_0.mp4"
```

The script writes:

- `media/primary_motion.mp4`
- `media/blend_mask.mp4`
- `media/detail_nested.mp4`
- `manifest.local.json`

Run the fast bridge test with the dev server open in a browser:

```powershell
npm run torture:bridge-fast
```

The runner reads `manifest.local.json`, creates a fresh nested timeline with
effects and masks through the dev bridge, performs scrub/playback checks,
captures a frame grid, and runs a short fast export probe. Add
`-- --include-precise` to also run the precise export probe. Reports are written
under `reports/`.
