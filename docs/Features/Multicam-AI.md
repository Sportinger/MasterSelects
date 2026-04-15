[Back to Index](./README.md)

# AI Multicam Editor

Automatischer Multicam-Schnitt via lokaler Analyse, lokalem Whisper-Transkript und Claude-gestuetzter EDL-Erzeugung.

> **Status:** Implemented. Analyse, Transkription, EDL-Generierung und Timeline-Apply sind funktional. Face detection und Speaker-Diarisierung sind nicht implementiert.

---

## Pipeline

```
N Kameras
  -> Audio sync
  -> CPU-basierte Analyse
  -> lokales Whisper-Transkript
  -> Claude EDL
  -> Timeline-Apply
```

Das LLM bekommt keine Frames direkt. Es arbeitet mit:

- Kamerametadaten
- sampled motion/sharpness/audio data
- dem Transkript
- dem gewaehlten Edit-Stil

---

## Current Implementation

### Analyse

`multicamAnalyzer.ts` analysiert jede Kamera sequentiell und nutzt Canvas 2D statt WebGPU:

- Frame extraction at `320x180`
- Sample interval: `500ms`
- Motion: luminance frame diff
- Sharpness: Laplacian variance
- Audio: RMS values from `audioAnalyzer`
- Face detection: placeholder, returns `[]`

Die Analyse laeuft kameraweise nacheinander, nicht parallel. Ein Cancel-Controller kann den Lauf abbrechen und die UI yieldet regelmaessig, damit der Browser responsiv bleibt.

### Transkription

`whisperService.ts` nutzt Browser-basierte `@huggingface/transformers` mit `Xenova/whisper-tiny`.

Wichtige Details:

- Es transkribiert die Audiospur der Master-Kamera
- Wenn kein Master gesetzt ist, faellt es auf die erste Kamera zurueck
- Die Ausgabe-Texte bekommen standardmaessig `Speaker 1`
- Speaker diarization ist noch nicht vorhanden

### EDL-Erzeugung

`claudeService.ts` sendet direkt aus dem Browser an:

- `https://api.anthropic.com/v1/messages`

Aktuell verwendet es:

- model: `claude-sonnet-4-20250514`
- `max_tokens: 4096`
- header `anthropic-dangerous-direct-browser-access: true`

Der Prompt enthaelt:

- Kamera-Name und Rolle
- Edit-Stil-Presets
- sampled analysis data
- audio levels
- das komplette Transcript

Die Antwort wird als JSON-Array von Edit-Entscheidungen geparst.

---

## Store And UI

`multicamStore.ts` verwaltet:

- camera list and master camera
- analysis status/progress/error
- transcript status/progress/error
- EDL status/error
- edit style and custom prompt
- selection and EDL preview state

`MultiCamPanel.tsx` bietet den aktuellen UI-Workflow:

- Kameras aus importierten Media-Dateien hinzufuegen
- Audio sync starten
- Analyse starten
- Transcript generieren oder importieren
- Edit Style waehlen
- Claude API key setzen
- EDL generieren und manuell bearbeiten
- EDL auf die Timeline anwenden

---

## API Key Handling

Multicam nutzt den gemeinsamen `apiKeyManager` fuer lokale, verschluesselte Speicherung in IndexedDB.

- Legacy key id: `claude-api-key`
- Der Store speichert nur `apiKeySet`, nicht den Klartext-Key
- Beim Start wird asynchron geprueft, ob ein Key bereits vorhanden ist

Das ist ein lokaler Browser-Key, kein Cloudflare-Secret.

---

## Timeline Apply

`applyEDLToTimeline()` erstellt einen neuen Video-Track, fuegt Clips fuer jede Edit-Entscheidung ein und trimmt sie unter Beruecksichtigung des Sync-Offsets.

Das ist direkte Timeline-Integration, kein Export in Premiere XML oder Resolve EDL.

---

## Data Shapes

```typescript
interface MultiCamSource {
  id: string;
  mediaFileId: string;
  name: string;
  role: 'wide' | 'closeup' | 'detail' | 'custom';
  customRole?: string;
  syncOffset: number;
  duration: number;
  thumbnailUrl?: string;
}

interface MultiCamAnalysis {
  projectDuration: number;
  sampleInterval: number;
  cameras: CameraAnalysis[];
  audioLevels: { timestamp: number; level: number }[];
}

interface FrameAnalysis {
  timestamp: number;
  motion: number;
  sharpness: number;
  faces: DetectedFace[];
  audioLevel: number;
}

interface TranscriptEntry {
  id: string;
  start: number;
  end: number;
  speaker: string;
  text: string;
}

interface EditDecision {
  id: string;
  start: number;
  end: number;
  cameraId: string;
  reason?: string;
  confidence?: number;
}
```

---

## Edit Styles

- `podcast`
- `interview`
- `music`
- `documentary`
- `custom`

The presets are baked into the prompt and steer the EDL generation strategy, but they do not enforce hard rules in the store.

---

## Current Limitations

- Face detection returns empty arrays.
- Transcript speaker labels are not diarized.
- Analysis is CPU-based, not GPU-based.
- The AI generation call is direct browser access to Anthropic, so it depends on the user's local API key.
- Premiere XML and DaVinci Resolve export are not implemented.

---

## Related Documents

- [Audio](./Audio.md)
- [Timeline](./Timeline.md)

---

*Source: `src/stores/multicamStore.ts`, `src/services/multicamAnalyzer.ts`, `src/services/claudeService.ts`, `src/services/audioSync.ts`, `src/services/audioAnalyzer.ts`, `src/services/whisperService.ts`, `src/services/apiKeyManager.ts`, `src/components/panels/MultiCamPanel.tsx`, `src/components/timeline/MulticamDialog.tsx`*
