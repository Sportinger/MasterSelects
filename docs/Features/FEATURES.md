# MASterSelects - Feature Handbuch

Vollständige Dokumentation aller Features der Video-Editing-Anwendung.

---

## 1. Timeline

### Basis-Funktionen
- **Multi-Track Timeline**: Video- und Audio-Tracks
- **Clip-Management**: Hinzufügen, Entfernen, Verschieben von Clips
- **Clip-Trimming**: Links/Rechts-Kanten ziehen für In/Out-Points
- **Linked Clips**: Audio/Video bleiben beim Verschieben synchron
- **Overlap Resistance**: Magnetischer Widerstand beim Überlappen (Video + Audio)
- **Clip-Splitting**: Clips teilen mit C-Taste (splittet ALLE Clips am Playhead, oder nur ausgewählte)
- **Multi-Select**: Shift+Klick für Mehrfachauswahl, gemeinsam verschieben
- **Linked Clip Selection**: Klick wählt Video+Audio zusammen aus
- **Solid Color Clips**: Farbige Solid-Layer erstellen
- **Playhead**: Klicken zum Springen, Ziehen zum Scrubben
- **JKL Playback**: Industry-Standard J/K/L Shortcuts
- **Zoom**: Exponentieller Zoom mit Alt+Scroll (8% pro Schritt)
- **Fit Button**: Zoom anpassen um ganze Komposition zu sehen
- **Track-Höhe**: Individuelle Track-Höhen anpassbar
- **Track Solo/Mute**: Audio-Tracks stumm schalten oder solo hören

### Playback-Controls
- **Play/Pause/Stop**: Standard-Wiedergabe
- **Loop-Playback**: Schleifenwiedergabe innerhalb In/Out-Punkten
- **In/Out-Marker**: Arbeitsbereich mit I/O-Punkten setzen
- **Editierbare Duration**: Klick auf Gesamtdauer zum Ändern der Kompositionslänge

### Erweiterte Features
- **RAM Preview**: Frames cachen für flüssige Wiedergabe
- **Proxy-System**: Niedrigere Auflösung für bessere Performance
- **Waveform-Anzeige**: Audio-Wellenformen auf Clips (Rechtsklick zum Generieren)
- **Thumbnail-Strips**: Filmstreifen-Vorschau auf Video-Clips
- **Compositions**: Verschachtelte Timelines als Clips
- **Undo/Redo**: Ctrl+Z / Ctrl+Shift+Z (oder Ctrl+Y)

---

## 2. Keyframe-Animation

### Keyframe-Steuerung
- **Keyframes erstellen**: Auf Clip-Properties
- **Recording-Modus**: Keyframes live während Wiedergabe aufnehmen
- **Keyframes bearbeiten**: Zeit, Wert und Easing ändern
- **Multi-Selection**: Mehrere Keyframes mit Shift+Klick auswählen
- **Interpolation**: Automatische Wertberechnung zwischen Keyframes

### Easing-Funktionen
- Linear
- Ease-In
- Ease-Out
- Ease-In-Out

### Animierbare Properties
- **Opacity**: 0-1
- **Position**: X, Y, Z (Pixel)
- **Scale**: X, Y (Prozent)
- **Rotation**: X, Y, Z (Grad)
- **Effekt-Parameter**: Alle Effekt-Parameter animierbar

---

## 3. Effekte & Transforms

### Verfügbare Effekte
| Effekt | Beschreibung |
|--------|-------------|
| Hue Shift | Farben im HSV-Raum rotieren |
| Brightness | Helligkeit anpassen |
| Contrast | Kontrast und Mitten |
| Saturation | Farbsättigung |
| Levels | Histogram mit Input/Output Black/White, Gamma |
| Pixelate | Mosaik-Effekt |
| Kaleidoscope | Segment-Spiegelung mit Rotation |
| Mirror | Horizontal/Vertikal spiegeln |
| RGB Split | Chromatische Aberration |
| Invert | Farbumkehrung |

### Blend-Modes (After Effects-Style)
**Normal**: normal, dissolve, dancing-dissolve
**Darken**: darken, multiply, color-burn, linear-burn, darker-color
**Lighten**: add, lighten, screen, color-dodge, linear-dodge, lighter-color
**Contrast**: overlay, soft-light, hard-light, linear-light, vivid-light, pin-light, hard-mix
**Inversion**: difference, exclusion, subtract, divide
**Component**: hue, saturation, color, luminosity
**Stencil**: stencil-alpha, stencil-luma, silhouette-alpha, silhouette-luma, alpha-add

### Transform-Properties
- **Position**: X, Y, Z Koordinaten
- **Scale**: Unabhängige X/Y Skalierung
- **Rotation**: 3D-Rotation auf X, Y, Z Achsen
- **Opacity**: 0-100% Transparenz
- **Präzisions-Slider**: Shift=langsam, Ctrl=ultra-langsam

---

## 4. Media-Management

### Import & Organisation
- **Multi-Format**: Video, Audio, Bilder
- **Drag-and-Drop**: Dateien direkt ins Media Panel ziehen
- **File System Access API**: Native Dateiauswahl
- **Ordner-Struktur**: Ordner erstellen, umbenennen, löschen
- **Thumbnails**: Auto-generierte Vorschaubilder

### Composition-System
- **Compositions erstellen**: Neue verschachtelte Kompositionen
- **Composition-Settings**: Auflösung, Framerate
- **Verschachtelte Timelines**: Compositions als Clips verwenden
- **Tab-Wechsel**: Zwischen mehreren Compositions wechseln

### Proxy-System
- **Proxy-Generierung**: Niedrigere Auflösung für Performance
- **Proxy-Ordner**: Eigener Ausgabeort wählbar
- **Status-Anzeige**: "P" Badge auf Clips mit Proxy
- **Progress-Tracking**: Echtzeit-Fortschritt
- **Proxy-Cache**: Frame-Cache für flüssiges Scrubbing

---

## 5. Export

### WebCodecs Export (Standard)
- **Frame-by-Frame Rendering**: Präzise Frame-Ausgabe
- **Format**: MP4 mit H.264/VP9 Codec
- **Qualitätseinstellungen**: Auflösung und Bitrate
- **Preset-Auflösungen**: 1080p, 4K, Custom
- **Framerate**: 24p, 30p, 60p, etc.
- **Zeitbereich**: In/Out-Range oder komplette Timeline
- **Bitrate-Schätzung**: Automatische Empfehlung
- **Dateigröße-Vorschau**: Geschätzte Ausgabegröße
- **WebCodecs**: Hardware-beschleunigtes Encoding
- **Progress**: Echtzeit-Fortschrittsanzeige

### FFmpeg Export (Professionell)
- **Professional Codecs**: ProRes, DNxHR, HAP
- **Lossless**: FFV1, Ut Video
- **Delivery**: H.264 (x264), H.265 (x265), VP9, AV1
- **Container**: MOV, MP4, MKV, WebM, MXF
- **Platform Presets**: YouTube, Vimeo, Instagram, TikTok
- **NLE Presets**: Premiere, Final Cut, DaVinci, Avid
- **VJ Presets**: HAP Q für Media Server
- **On-Demand Loading**: WASM lädt bei Bedarf (~20MB)

---

## 6. Masken

### Zeichenwerkzeuge
- **Pen Tool**: Freiform-Masken mit Bezier-Kurven
- **Rechteck-Maske**: Schnelle rechteckige Maske
- **Ellipsen-Maske**: Kreisförmige/ovale Maske
- **Bezier-Handles**: Kubische Kontrollpunkte für glatte Kurven

### Masken-Properties
- **Opacity**: 0-100%
- **Feather**: Unschärfe-Radius (0-50px)
- **Feather Quality**: Low (9), Medium (17), High (25 Samples)
- **Invertiert**: Maske umkehren
- **Mask Modes**: Add, Subtract, Intersect
- **Mehrere Masken**: Stapeln auf einem Clip
- **Reihenfolge**: Drag zum Umsortieren

---

## 7. Transkription (Speech-to-Text)

### Provider
- **Local Whisper**: Browser-basiert, kein API-Key nötig
- **OpenAI Whisper API**: Cloud-basiert
- **AssemblyAI**: Alternative Cloud
- **Deepgram**: Alternative Cloud

### Features
- **11+ Sprachen**: Englisch, Deutsch, Französisch, Spanisch, etc.
- **Wort-Level Timing**: Präzise Zeitstempel pro Wort
- **Suche**: Transkript durchsuchen, Treffer hervorheben
- **Timeline-Marker**: Visuelle Marker auf Timeline
- **Echtzeit-Highlighting**: Aktuelles Wort während Wiedergabe
- **Status-Tracking**: Fortschritt und Fehlermeldungen

---

## 8. Video-Analyse

### Analysierte Metriken
- **Focus/Sharpness**: Laplacian Variance-basierte Schärfeerkennung
- **Motion**:
  - Global Motion (Kamerabewegung, Szenenwechsel)
  - Local Motion (Objektbewegung)
  - Schnitterkennung
- **Face Detection**: Gesichter zählen und lokalisieren

### Visualisierung
- **Farbcodierte Schwellwerte**:
  - Focus: Grün (>70% = gut), Rot (<40% = unscharf)
  - Motion: Blau (stabil), Rot (hoch/wackelig)
  - Gesichter: Gelbe Punkte oben
- **Analyse-Overlay**: Dual-Line Graph (Focus + Motion)
- **Frame-Sampling**: 500ms Intervall
- **GPU-Beschleunigung**: Optical Flow Analyzer

---

## 9. Multicam

### Features
- **Mehrere Kameras**: Clips zur Multicam-Gruppe hinzufügen
- **Master-Kamera**: Audio-Referenz wählen
- **Kamera-Rollen**: Wide, Close-up, Detail, Custom
- **Sync-Methoden**:
  - Audio-Synchronisation (Cross-Correlation)
  - Transkript-Synchronisation (Speech-Matching)
- **Sync-Offset**: Automatische Offset-Berechnung
- **Linked Groups**: Sync-Clips zusammen verschieben

---

## 10. AI Chat Panel

### Integration
- **OpenAI**: Direkte Chat-Verbindung
- **Modelle**: GPT-5.2, GPT-5.1, o3, o4-mini, GPT-4.1, etc.
- **Message History**: Kontext bleibt erhalten
- **API Key Management**: Sichere Schlüsselspeicherung

---

## 11. Video Scopes

### GPU-beschleunigte Scopes
- **Histogram**: RGB-Verteilungsgraph mit R/G/B/Luma View-Modes
- **Vectorscope**: Farb-Vektoranalyse mit Phosphor-Glow
- **Waveform**: DaVinci-style Waveform mit Sub-Pixel-Verteilung
- **Unabhängige Panels**: Jeder Scope als eigenständiges dockbares Panel
- **IRE Legende**: Broadcast-Referenz
- **Zero-Copy**: Vollständig GPU-gerendert, kein readPixels Overhead

---

## 12. Transitions

### Features
- **Crossfade-Transitions**: GPU-beschleunigte Überblendungen
- **Transitions Panel**: Modular mit Drag-and-Drop
- **Timeline-Integration**: Visuell auf Clips dargestellt

---

## 13. UI Features

### Dock-System
- **Anpassbares Layout**: Panels per Drag-and-Drop
- **Floating Panels**: Als separate Fenster
- **Panel-Tabs**: Mehrere Panels in einem Container
- **Split Panes**: Vertikal/Horizontal teilen
- **Layout-Persistenz**: Layouts speichern/laden

### Panels (14 Typen)
- Timeline, Preview, Media Panel, Properties Panel
- Export, Multicam, AI Chat, AI Video
- YouTube, Transitions, Histogram, Vectorscope, Waveform, Slots

### Toolbar
- **Projekt-Management**: New, Save, Load, Delete
- **Resolution Settings**: Ausgabeauflösung
- **Output Windows**: Zusätzliche Displays
- **MIDI Control**: MIDI-Input aktivieren

---

## 13. Performance

### Optimierungen
- **WebGPU**: GPU-beschleunigtes Rendering
- **Zero-Copy Textures**: Direkt VideoFrame zu GPU
- **Hardware Decoding**: WebCodecs für effizientes Decoding
- **Ping-Pong Buffers**: Effizientes Compositing
- **Lazy Loading**: On-Demand Ressourcen-Laden

### Monitoring
- **Echtzeit-FPS**: Aktuelle Frames pro Sekunde
- **Render-Timing**: Import/Render/Submit Aufschlüsselung
- **Frame-Drop Tracking**: Zählung und Gründe
- **Bottleneck-Erkennung**: Automatische Problem-Identifikation

---

## 14. Projekt-Management

### Funktionen
- **Neues Projekt**: Leere Projekte erstellen
- **Lokale Ordner**: Projekte in lokalen Ordnern speichern (File System Access API)
- **Raw-Ordner**: Importierte Medien automatisch nach Raw/ kopiert
- **Auto-Relink**: Fehlende Dateien automatisch aus Raw-Ordner wiederhergestellt
- **Auto-Save**: Konfigurierbares Intervall (1-10 min)
- **Backup-System**: Letzte 20 Backups automatisch
- **Save As**: Projekt an neuen Ort exportieren

---

## 15. Technische Spezifikationen

### Unterstützte Formate
- **Video**: H.264, HEVC, VP9, AV1 (via WebCodecs)
- **Audio**: WAV, MP3, OGG, FLAC, AAC, M4A, AIFF, Opus, WMA
- **Bilder**: JPG, PNG, WebP, GIF

### Anforderungen
- **WebGPU**: Chrome 113+, Safari 18+
- **WebCodecs**: Chrome 94+, Safari 16.4+
- **Display**: Empfohlen 1920x1080 minimum

### Performance-Ziele
- **Target FPS**: 60 FPS
- **Render-Zeit**: <16.67ms pro Frame
- **Multi-Layer**: 10+ Layer bei voller Auflösung
