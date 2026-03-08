# MASterSelects - Feature Handbuch

Vollständige Dokumentation aller Features der Video-Editing-Anwendung.

Version 1.2.11 | Detaillierte Dokumentation: [README.md](./README.md)

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
- **Text Clips**: Typografie-Layer mit 50 Google Fonts, Stroke, Schatten
- **Playhead**: Klicken zum Springen, Ziehen zum Scrubben
- **JKL Playback**: Industry-Standard J/K/L Shortcuts
- **Zoom**: Exponentieller Zoom mit Alt+Scroll (8% pro Schritt)
- **Fit Button**: Zoom anpassen um ganze Komposition zu sehen
- **Track-Höhe**: Individuelle Track-Höhen anpassbar
- **Track Solo/Mute**: Audio-Tracks stumm schalten oder solo hören
- **Transitions**: Crossfade-Transitions mit GPU-beschleunigtem Rendering

### Playback-Controls
- **Play/Pause/Stop**: Standard-Wiedergabe
- **Loop-Playback**: Schleifenwiedergabe innerhalb In/Out-Punkten
- **In/Out-Marker**: Arbeitsbereich mit I/O-Punkten setzen
- **Editierbare Duration**: Klick auf Gesamtdauer zum Ändern der Kompositionslänge
- **Marker Drag-to-Create**: M-Button ziehen um Marker mit Geister-Vorschau zu erstellen

### Erweiterte Features
- **RAM Preview**: Frames cachen für flüssige Wiedergabe
- **Proxy-System**: Niedrigere Auflösung für bessere Performance
- **Waveform-Anzeige**: Audio-Wellenformen auf Clips (Rechtsklick zum Generieren)
- **Thumbnail-Strips**: Filmstreifen-Vorschau auf Video-Clips (WYSIWYG mit Effekten)
- **Compositions**: Verschachtelte Timelines als Clips (orange Umrandung, Boundary-Marker)
- **Undo/Redo**: Ctrl+Z / Ctrl+Shift+Z (oder Ctrl+Y)
- **Copy/Paste**: Ctrl+C/V mit Effekten, Keyframes, Masken

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
- Custom Bezier (frei einstellbare Bezier-Kurve)

### Erweiterte Keyframe-Features
- **Copy/Paste**: Ctrl+C / Ctrl+V für Keyframes
- **Keyframe-Ticks**: Visuelle Tick-Markierungen auf Clip-Balken in der Timeline
- **Curve Editor**: SVG-basiert mit Bezier-Handle-Manipulation
- **Curve Editor Auto-Scale**: Automatische Skalierung der Kurvenansicht
- **Multi-Select Movement**: Mehrere Keyframes zusammen um gleichen Zeitdelta verschieben

### Animierbare Properties
- **Opacity**: 0-1
- **Position**: X, Y, Z (Pixel)
- **Scale**: X, Y (Prozent)
- **Rotation**: X, Y, Z (Grad)
- **Effekt-Parameter**: Alle Effekt-Parameter animierbar

---

## 3. Effekte & Transforms

### Verfügbare Effekte (30 Effekte)

#### Color (9)
| Effekt | Beschreibung |
|--------|-------------|
| Brightness | Helligkeit anpassen |
| Contrast | Kontrast und Mitten |
| Saturation | Farbsättigung |
| Vibrance | Intelligente Sättigung (schont Hauttöne) |
| Hue Shift | Farben im HSV-Raum rotieren |
| Temperature | Farbtemperatur (warm/kalt) |
| Exposure | Belichtungskorrektur |
| Levels | Histogram mit Input/Output Black/White, Gamma |
| Invert | Farbumkehrung |

#### Blur (5)
| Effekt | Beschreibung |
|--------|-------------|
| Box Blur | Einfacher Weichzeichner |
| Gaussian Blur | Gausssche Unschärfe |
| Motion Blur | Bewegungsunschärfe mit Richtung |
| Radial Blur | Kreisförmige Unschärfe |
| Zoom Blur | Zentraler Zoom-Effekt |

#### Distort (7)
| Effekt | Beschreibung |
|--------|-------------|
| Pixelate | Mosaik-Effekt |
| Kaleidoscope | Segment-Spiegelung mit Rotation |
| Mirror | Horizontal/Vertikal spiegeln |
| RGB Split | Chromatische Aberration |
| Twirl | Spiralförmige Verzerrung |
| Wave | Wellenförmige Verzerrung |
| Bulge | Kugelförmige Verzerrung (Fischauge) |

#### Stylize (8)
| Effekt | Beschreibung |
|--------|-------------|
| Vignette | Randabdunklung |
| Grain | Film-Korn Simulation |
| Glow | Leuchtender Weichzeichner |
| Posterize | Farbreduktion / Poster-Effekt |
| Edge Detect | Kantenerkennung |
| Scanlines | CRT-Monitor Scanlines |
| Threshold | Schwellwert-Binarisierung |
| Sharpen | Nachschärfen |

#### Keying (1)
| Effekt | Beschreibung |
|--------|-------------|
| Chroma Key | Greenscreen/Bluescreen-Entfernung |

### Inline-Effekte
Brightness, Contrast, Saturation und Invert laufen direkt im Composite-Shader (keine extra Render-Passes).

### Blend-Modes (37 Modi, After Effects-Style)
**Normal**: normal, dissolve, dancing-dissolve
**Darken**: darken, multiply, color-burn, classic-color-burn, linear-burn, darker-color
**Lighten**: add, lighten, screen, color-dodge, classic-color-dodge, linear-dodge, lighter-color
**Contrast**: overlay, soft-light, hard-light, linear-light, vivid-light, pin-light, hard-mix
**Inversion**: difference, classic-difference, exclusion, subtract, divide
**Component**: hue, saturation, color, luminosity
**Stencil**: stencil-alpha, stencil-luma, silhouette-alpha, silhouette-luma, alpha-add

### Transform-Properties
- **Position**: X, Y, Z Koordinaten
- **Scale**: Unabhängige X/Y Skalierung
- **Rotation**: 3D-Rotation auf X, Y, Z Achsen
- **Opacity**: 0-100% Transparenz
- **Edit Mode**: Direkte Manipulation im Preview (Tab-Taste) mit Corner/Edge Handles

---

## 4. Media-Management

### Import & Organisation
- **Multi-Format**: Video, Audio, Bilder
- **Drag-and-Drop**: Dateien direkt ins Media Panel ziehen
- **File System Access API**: Native Dateiauswahl
- **Ordner-Struktur**: Ordner erstellen, umbenennen, löschen
- **Thumbnails**: Auto-generierte Vorschaubilder (WYSIWYG mit Effekten)
- **Grid/List View**: Umschaltbare Ansichtsmodi

### Composition-System
- **Compositions erstellen**: Neue verschachtelte Kompositionen
- **Composition-Settings**: Auflösung, Framerate
- **Verschachtelte Timelines**: Compositions als Clips verwenden
- **Tab-Wechsel**: Zwischen mehreren Compositions wechseln

### Proxy-System
- **Proxy-Generierung**: GPU-beschleunigte niedrigere Auflösung für Performance
- **Proxy-Ordner**: Eigener Ausgabeort wählbar
- **Status-Anzeige**: "P" Badge auf Clips mit Proxy
- **Progress-Tracking**: Echtzeit-Fortschritt
- **Proxy-Cache**: Frame-Cache für flüssiges Scrubbing
- **Cross-Platform**: Windows, Linux, Mac

---

## 5. Export

### WebCodecs Export (Standard)
- **Fast Mode**: Sequenzielles Decoding mit MP4Box Parsing
- **Precise Mode**: Frame-genaues Seeking für komplexe Timelines
- **Format**: MP4 mit H.264/VP9 Codec
- **Qualitätseinstellungen**: Auflösung und Bitrate (5-35 Mbps)
- **Preset-Auflösungen**: 480p, 720p, 1080p, 4K
- **Framerate**: 24, 25, 30, 60 fps
- **Zeitbereich**: In/Out-Range oder komplette Timeline
- **Parallel Decoding**: Multi-Clip paralleles Decoding für schnellere Exports
- **Auto Fallback**: Fällt automatisch auf Precise-Modus zurück
- **Progress**: Echtzeit-Fortschrittsanzeige mit Abbrechen
- **Audio**: AAC/Opus mit automatischer Browser-Codec-Erkennung

### FFmpeg Export (Professionell)
- **Professional Codecs**: ProRes, DNxHR, HAP
- **Lossless**: FFV1, Ut Video
- **Delivery**: H.264 (x264), H.265 (x265), VP9, AV1
- **Container**: MOV, MP4, MKV, WebM, MXF
- **Platform Presets**: YouTube, Vimeo, Instagram, TikTok
- **NLE Presets**: Premiere, Final Cut, DaVinci, Avid
- **VJ Presets**: HAP Q für Media Server
- **On-Demand Loading**: WASM lädt bei Bedarf (~20MB)

### Weitere Export-Optionen
- **FCP XML Export**: Timeline als Final Cut Pro XML für Premiere/Resolve Interchange
- **Einzelbild-Export**: PNG Frame Capture

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
- **Feather Quality**: GPU 3-Tier Blur (17/33/61 Taps)
- **Expansion**: Maske vergrößern/verkleinern
- **Invertiert**: Maske umkehren
- **Mask Modes**: Add, Subtract, Intersect
- **Mehrere Masken**: Stapeln auf einem Clip
- **Reihenfolge**: Drag zum Umsortieren
- **Vertex Editing**: Punkte auswählen, verschieben, löschen

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

## 9. Download Panel

### Features
- **Multi-Plattform Downloads**: Videos von verschiedenen Plattformen herunterladen
- **Unterstützte Plattformen**: YouTube, TikTok, Instagram, Twitter/X, Facebook, Reddit, Vimeo, Twitch
- **YouTube-Suche**: Suche via Invidious oder YouTube Data API
- **Native Helper Integration**: Downloads via yt-dlp über den Native Helper Service
- **Cobalt Fallback**: Download via Cobalt API wenn Native Helper nicht verfügbar
- **Qualitätsauswahl**: Verschiedene Auflösungen und Formate wählbar
- **H.264 Bevorzugung**: Bevorzugt H.264 gegenüber AV1/VP9 für Kompatibilität
- **Direkt zur Timeline**: Download und direkt zur Timeline hinzufügen
- **Projekt-Speicherung**: Downloads in Projekt YT/-Ordner gespeichert
- **Plattform-Unterordner**: Downloads nach Plattform organisiert

---

## 10. Multicam

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

## 11. AI Features

### AI Chat Panel
- **OpenAI**: Direkte Chat-Verbindung
- **Modelle**: GPT-5.2, GPT-5.1, o3, o4-mini, GPT-4.1, etc.
- **33 AI Tools**: Clip, Track, Keyframe, Effekt-Operationen via Function Calling
- **Message History**: Kontext bleibt erhalten
- **Context Awareness**: AI kennt den aktuellen Timeline-Zustand
- **API Key Management**: Sichere Schlüsselspeicherung

### AI Video Generation
- **PiAPI Integration**: AI-gesteuerte Videoerzeugung

### SAM2 AI Segmentation
- **AI-basierte Objektsegmentierung**: Meta SAM2 Modell zur automatischen Maskenerstellung
- **Interaktive Auswahl**: Objekte im Video per Klick auswählen und verfolgen
- **WebGPU ONNX Inference**: GPU-beschleunigte Segmentierung

### Scene Description
- **AI-gesteuerte Szenenanalyse**: Automatische Beschreibung von Szeneninhalten

---

## 12. Video Scopes

### GPU-beschleunigte Scopes
- **Histogram**: RGB-Verteilungsgraph mit R/G/B/Luma View-Modes
- **Vectorscope**: Farb-Vektoranalyse mit Phosphor-Glow
- **Waveform**: DaVinci-style Waveform mit Sub-Pixel-Verteilung
- **Unabhängige Panels**: Jeder Scope als eigenständiges dockbares Panel
- **IRE Legende**: Broadcast-Referenz
- **Zero-Copy**: Vollständig GPU-gerendert, kein readPixels Overhead

---

## 13. Transitions

### Features
- **Crossfade-Transitions**: GPU-beschleunigte Überblendungen
- **Transitions Panel**: Modular mit Drag-and-Drop
- **Timeline-Integration**: Visuell auf Clips dargestellt

---

## 14. Audio

### Features
- **10-Band Parametric EQ**: 31Hz bis 16kHz Frequenzbänder
- **EQ Gain Range**: -12dB bis +12dB pro Band
- **Live EQ via Web Audio**: Echtzeit-Equalization, Änderungen sofort hörbar
- **EQ Keyframes**: EQ-Parameter über Zeit animierbar
- **Audio Master Clock**: Playhead folgt Audio für perfekte Synchronisation
- **Varispeed Scrubbing**: Kontinuierliche Wiedergabe mit Geschwindigkeitsanpassung
- **Speed Property**: Keyframeable Clip-Wiedergabegeschwindigkeit
- **Waveform-Anzeige**: 50 Samples/Sekunde Auflösung
- **Lautstärkeregelung**: Pro-Clip Lautstärke
- **Audio Tab für Video-Clips**: Video-Clips haben eigenen Audio-Tab
- **Composition Audio**: Verschachtelte Composition Audio-Mixdown
- **Track Mute/Solo**: Pro-Track stumm schalten oder solo hören

---

## 15. UI Features

### Dock-System
- **Anpassbares Layout**: Panels per Drag-and-Drop
- **Floating Panels**: Als separate Fenster
- **Panel-Tabs**: Mehrere Panels in einem Container
- **Split Panes**: Vertikal/Horizontal teilen
- **Layout-Persistenz**: Layouts speichern/laden
- **Hold-to-Drag Tabs**: 500ms halten zum Umsortieren

### Panels (16 Typen)
- Preview, Multi-Preview, Timeline, Properties Panel
- Media Panel, Export, Multicam, AI Chat
- AI Video, AI Segment, Scene Description
- Download, Transitions
- Histogram, Vectorscope, Waveform

> Hinweis: Slot Grid ist in das Timeline-Panel integriert (Ctrl+Shift+Scroll zum Umschalten).

### Toolbar
- **Projekt-Management**: New, Save, Load, Delete
- **Resolution Settings**: Ausgabeauflösung
- **Output Windows**: Zusätzliche Displays
- **MIDI Control**: MIDI-Input aktivieren

### Weitere UI-Features
- **AE-Style Settings Dialog**: Sidebar-Navigation mit kategorisierten Einstellungen
- **Menu Bar**: File, Edit, View, Output, Audio, Info, Window
- **Kontextmenüs**: Rechtsklick-Operationen (Viewport-begrenzt)
- **WYSIWYG Thumbnails**: Thumbnails zeigen Effekte auf Clips
- **What's New Dialog**: Zeitgruppierter Changelog nach Aktualisierung
- **Tutorial System**: Spotlight-basierte Panel-Einführung mit Clippy Maskottchen
- **Welcome Screen**: Programmauswahl (Premiere, Resolve, FCP, AE, Beginner)
- **Mobile Support**: Responsives Layout mit Touch-Gesten
- **Desktop Mode Toggle**: Option für volle UI auf Mobilgeräten

---

## 16. Projekt-Management

### Funktionen
- **Neues Projekt**: Leere Projekte erstellen
- **Lokale Ordner**: Projekte in lokalen Ordnern speichern (File System Access API)
- **Raw-Ordner**: Importierte Medien automatisch nach Raw/ kopiert
- **Auto-Relink**: Fehlende Dateien automatisch aus Raw-Ordner wiederhergestellt
- **Auto-Save**: Konfigurierbares Intervall (1-10 min)
- **Backup-System**: Letzte 20 Backups automatisch
- **Save As**: Projekt an neuen Ort exportieren
- **Smart Media Relink**: Verschobene/umbenannte Dateien automatisch finden
- **IndexedDB Error Dialog**: Klare Fehlermeldung bei korruptem Browser-Speicher

---

## 17. Output Manager

### Multi-Output Rendering
- **RenderTarget-System**: Mehrere unabhängige Ausgabeziele gleichzeitig rendern
- **Source Routing**: Quellzuweisung pro Output (aktive Komposition, spezifische Compositions, Slots)
- **Slice-System**: Corner-Pin Warping für Projection Mapping
- **Mask Layers**: Sichtbarkeitskontrolle pro Output über Masken-Ebenen mit Invertierung
- **Auto-Save**: Konfigurationen werden automatisch pro Projekt gespeichert
- **Window Management**: Fensterposition und -größe werden wiederhergestellt beim Öffnen

---

## 18. Slot Grid

### Resolume-Style Performance Grid
- **4x12 Grid**: 4 Layer (A-D) mit je 12 Slots
- **Click-to-Play**: Klick startet Clip, erneuter Klick startet neu
- **Multi-Layer Composition**: Layer A-D werden live übereinandergelegt
- **Unabhängige Wall-Clock Time**: Jeder Layer läuft mit eigener Echtzeit-Uhr
- **Ansichtswechsel**: Ctrl+Shift+Scroll zum Umschalten zwischen Timeline und Slot Grid

---

## 19. Tutorial System

### Interaktives Onboarding
- **Welcome Screen**: Programmauswahl beim ersten Start
- **Spotlight-Einführung**: Panel-basierte Einführung mit Spotlight-Hervorhebung
- **Timeline Deep-Dive**: Teil 2 mit detaillierter Timeline-Erklärung
- **Clippy Maskottchen**: Animierter Begleiter während des Tutorials

---

## 20. Native Helper (Turbo Mode)

### Features
- **Einheitlicher Cross-Platform Build**: FFmpeg Decode/Encode + yt-dlp Downloads auf allen Plattformen
- **ProRes Decoding**: Alle Profile mit nativer Geschwindigkeit
- **DNxHD/DNxHR Decoding**: Alle Profile mit nativer Geschwindigkeit
- **Hardware-Beschleunigung**: VAAPI (Intel/AMD), NVDEC (NVIDIA)
- **YouTube Downloads**: yt-dlp Integration mit Qualitätsauswahl
- **Frame Cache**: LRU Cache bis 2GB
- **Background Prefetch**: Frames werden vor dem Playhead vorgeladen
- **Native Encoding**: 10x schnellerer ProRes/DNxHD Export
- **Auto-Erkennung**: Toolbar zeigt "Turbo" wenn verbunden

---

## 21. Technische Spezifikationen

### Unterstützte Formate
- **Video**: H.264, HEVC, VP9, AV1 (via WebCodecs)
- **Audio**: WAV, MP3, OGG, FLAC, AAC, M4A, AIFF, Opus, WMA
- **Bilder**: JPG, PNG, WebP, GIF

### Anforderungen
- **WebGPU**: Chrome 113+, Edge 113+
- **WebCodecs**: Chrome 94+
- **File System Access**: Optional, empfohlen
- **Display**: Empfohlen 1920x1080 minimum

### Performance-Ziele
- **Target FPS**: 60 FPS
- **Render-Zeit**: <16.67ms pro Frame
- **Multi-Layer**: 10+ Layer bei voller Auflösung
