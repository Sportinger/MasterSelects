# Flex EQ Visual QA

The deterministic QA route for the flexible equalizer is available in the dev server at:

```text
http://127.0.0.1:5173/?test=flex-eq
```

It renders seeded fixtures for 10-band graphic EQ, free parametric curves, dense mastering curves with dynamic/spectral metadata, the preset browser surface, Sketch/Grab/Match controls, Band Solo state, Spectral Dynamics graph overlays, and a compact track-insert layout. The route does not depend on project state.

Headless Edge screenshot command:

```powershell
$out = Join-Path (Get-Location) '.tmp\flex-eq-visual-qa.png'
New-Item -ItemType Directory -Force -Path .tmp | Out-Null
& 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe' --headless=new --disable-gpu --virtual-time-budget=8000 --window-size=1280,1320 --screenshot=$out http://127.0.0.1:5173/?test=flex-eq
```

Use `--window-size=1280,1900` when checking the full fixture grid including compact controls.
