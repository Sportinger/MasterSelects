# MASterSelects

![Version](https://img.shields.io/badge/version-1.1.2-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![Platform](https://img.shields.io/badge/platform-Browser-lightgrey.svg)
![WebGPU](https://img.shields.io/badge/WebGPU-Powered-green.svg)
![React](https://img.shields.io/badge/React-19.2-61DAFB.svg?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6.svg?logo=typescript)
![Vite](https://img.shields.io/badge/Vite-7.2-646CFF.svg?logo=vite)

**Professional WebGPU Video Compositor & Timeline Editor**

A browser-based video editing application with After Effects-style compositing, AI-powered workflows, and real-time GPU rendering. No plugins or installations required.

## Features

| Feature | Description | Docs |
|---------|-------------|------|
| **Multi-track Timeline** | Video and audio tracks with nested compositions | [Timeline](docs/Features/Timeline.md) |
| **Cut Tool & Copy/Paste** | C to split clips, Ctrl+C/V to copy/paste | [Timeline](docs/Features/Timeline.md) |
| **Keyframe Animation** | Bezier curve editor with 5 easing modes | [Keyframes](docs/Features/Keyframes.md) |
| **Bezier Fade Curves** | Visual opacity fades with real-time preview | [Timeline](docs/Features/Timeline.md) |
| **37 Blend Modes** | All After Effects blend modes (Numpad +/- to cycle) | [Effects](docs/Features/Effects.md) |
| **30+ GPU Effects** | Color, blur, distort, stylize, keying effects | [Effects](docs/Features/Effects.md) |
| **Text Clips** | Typography with 50 Google Fonts, stroke, shadow | [Text Clips](docs/Features/Text-Clips.md) |
| **Vector Masks** | Rectangle, ellipse, pen tool with GPU feathering | [Masks](docs/Features/Masks.md) |
| **AI Integration** | 50+ editing tools via GPT-4/GPT-5 | [AI Integration](docs/Features/AI-Integration.md) |
| **AI Video Generation** | PiAPI integration for AI video creation | [AI Integration](docs/Features/AI-Integration.md) |
| **YouTube Integration** | Search, download with quality selection | [YouTube](docs/Features/YouTube.md) |
| **10-Band EQ** | Parametric equalizer with keyframe support | [Audio](docs/Features/Audio.md) |
| **Multicam Sync** | Audio-based cross-correlation synchronization | [Audio](docs/Features/Audio.md) |
| **4 Transcription Providers** | Local Whisper, OpenAI, AssemblyAI, Deepgram | [AI Integration](docs/Features/AI-Integration.md) |
| **RAM Preview** | Cached playback at 60fps with auto frame caching | [Preview](docs/Features/Preview.md) |
| **Export System V2** | Parallel decoding, shared decoder pool, frame caching | [Export](docs/Features/Export.md) |
| **Native Helper** | Hardware-accelerated ProRes/DNxHD (Windows Lite available) | [Native Helper](docs/Features/Native-Helper.md) |
| **Local Project Storage** | Auto-copy to Raw folder, UI state persistence | [Project Persistence](docs/Features/Project-Persistence.md) |
| **Smart Media Relink** | Auto-relink from Raw folder on project load | [Media Panel](docs/Features/Media-Panel.md) |
| **Mobile Support** | Responsive UI with touch gestures | [UI & Panels](docs/Features/UI-Panels.md) |

**[Full Documentation](docs/Features/README.md)** | **[Keyboard Shortcuts](docs/Features/Keyboard-Shortcuts.md)**

---

## Tech Stack

| Technology | Purpose |
|------------|---------|
| React 19 + TypeScript | UI framework |
| Vite 7.2 | Build tooling & HMR |
| Zustand | State management (modular slice architecture) |
| WebGPU + WGSL | GPU rendering (2,000+ lines of shaders) |
| WebCodecs | Hardware video decoding & encoding |
| FFmpeg WASM | Professional codecs (ProRes, DNxHR, HAP) |
| Web Audio API | 10-band EQ, varispeed scrubbing, audio master clock |
| File System Access API | Local project storage with Raw folder |
| OpenAI API | AI editing tools (GPT-4/GPT-5) |
| Native Helper (Rust) | Optional hardware-accelerated decode/encode |
| Logger Service | Professional debugging with module filtering |

---

## Quick Start

```bash
npm install
npm run dev     # http://localhost:5173
```

### Requirements

- **Browser**: Chrome 113+ or Edge 113+ (WebGPU required)
- **GPU**: Dedicated GPU recommended
- **RAM**: 8GB minimum, 16GB recommended

### Linux Users

Enable Vulkan for 60fps performance:
```
chrome://flags/#enable-vulkan → Enabled
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         UI Layer (React)                         │
│  Timeline │ Preview │ Media │ Properties │ AI Chat │ YouTube    │
├─────────────────────────────────────────────────────────────────┤
│                      State Layer (Zustand)                       │
│  timelineStore │ mediaStore │ multicamStore │ youtubeStore      │
├─────────────────────────────────────────────────────────────────┤
│                     Engine Layer (WebGPU)                        │
│  Compositor │ Effects │ Masks │ Export │ Parallel Decode        │
├─────────────────────────────────────────────────────────────────┤
│                      Services Layer                              │
│  Audio │ AI Tools │ Whisper │ Project │ Native Helper           │
└─────────────────────────────────────────────────────────────────┘
```

---

## Documentation

### Core Features
- [Timeline](docs/Features/Timeline.md) - Multi-track editing, clips, snapping, compositions
- [Keyframes](docs/Features/Keyframes.md) - Animation system with curve editor
- [Effects](docs/Features/Effects.md) - GPU effects and 37 blend modes
- [Masks](docs/Features/Masks.md) - Shape masks with GPU feathering

### Media & Audio
- [Media Panel](docs/Features/Media-Panel.md) - Import, folders, proxy generation
- [Audio](docs/Features/Audio.md) - 10-band EQ, waveforms, multicam sync
- [Preview](docs/Features/Preview.md) - RAM Preview, scrubbing, multiple outputs

### AI & Export
- [AI Integration](docs/Features/AI-Integration.md) - 50+ tools, transcription
- [Export](docs/Features/Export.md) - H.264/VP9 encoding

### System
- [UI & Panels](docs/Features/UI-Panels.md) - Dockable panels, layouts
- [GPU Engine](docs/Features/GPU-Engine.md) - WebGPU rendering details
- [Project Persistence](docs/Features/Project-Persistence.md) - Auto-save, IndexedDB
- [Keyboard Shortcuts](docs/Features/Keyboard-Shortcuts.md) - Complete reference

---

## Panel System

10 dockable panels with drag-and-drop arrangement:

| Panel | Purpose |
|-------|---------|
| **Preview** | Composition output canvas with quality settings |
| **Timeline** | Multi-track editor with navigator |
| **Media** | Media browser with columns and folders |
| **Properties** | Transform, Effects, Masks, Volume (unified) |
| **Export** | Render settings with Fast/Precise/FFmpeg modes |
| **Multicam** | Camera sync via audio cross-correlation |
| **AI Chat** | GPT-4/GPT-5 powered editing assistant |
| **AI Video** | PiAPI integration for AI video generation |
| **YouTube** | Search and download YouTube videos |
| **Slots** | Layer slot management |

---

## Key Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play/Pause |
| `C` | Cut tool - split clips at playhead |
| `Ctrl+C/V` | Copy/Paste clips |
| `Delete` | Delete selected |
| `I` / `O` | Set In/Out points |
| `Ctrl+Z` | Undo |
| `Ctrl+S` | Save project |
| `Numpad +/-` | Cycle blend modes |

[Full shortcut reference](docs/Features/Keyboard-Shortcuts.md)

---

## Development

```bash
npm run dev      # Development server
npm run build    # Production build
npm run lint     # ESLint check
npm run preview  # Preview production build
```

### Project Structure

```
src/
├── components/        # React components
│   ├── timeline/      # Timeline editor (hooks/, components/, utils/)
│   ├── panels/        # Dock panels (Properties, Media, YouTube, AI, Export)
│   ├── preview/       # Preview canvas and overlays
│   ├── common/        # Shared components (Toolbar, Dialogs, etc.)
│   ├── mobile/        # Mobile-specific components
│   ├── export/        # Export UI components
│   └── dock/          # Panel system
├── stores/            # Zustand state management
│   ├── timeline/      # Timeline slices (track, clip, keyframe, mask, etc.)
│   └── mediaStore/    # Media slices (import, folder, proxy, composition)
├── engine/            # WebGPU rendering (modular architecture)
│   ├── core/          # WebGPU context and render targets
│   ├── render/        # Compositor, render loop, layer collection
│   ├── export/        # Frame exporter, video encoder, V2 export system
│   ├── managers/      # Decode managers, texture managers
│   ├── pipeline/      # Render pipelines
│   ├── texture/       # Texture and frame caching (ScrubbingCache)
│   ├── audio/         # Audio encoder, mixer, time stretch
│   └── ffmpeg/        # FFmpeg WASM bridge
├── effects/           # Modular GPU effects (30+ effects)
├── shaders/           # WGSL shaders
├── services/          # Audio, AI, persistence, Native Helper
│   ├── project/       # Project file service (modular architecture)
│   ├── nativeHelper/  # Native decoder and client
│   └── ai/            # AI tools (modular architecture)
├── types/             # Shared TypeScript types
├── hooks/             # React hooks
└── utils/             # Utility functions
tools/
└── helpers/           # Native Helper (Rust) - win/, linux/, mac/
```

See [CLAUDE.md](CLAUDE.md) for detailed structure and patterns.

---

## Debugging

MASterSelects includes a professional Logger service for debugging and AI-assisted development.

### Console Commands

```javascript
// Enable debug logs for specific modules
Logger.enable('WebGPU,FFmpeg,Export')   // Comma-separated modules
Logger.enable('*')                       // All modules
Logger.disable()                         // Turn off debug logs

// Set minimum log level
Logger.setLevel('DEBUG')                 // Show all (DEBUG, INFO, WARN, ERROR)
Logger.setLevel('WARN')                  // Only warnings and errors

// Inspect logs
Logger.getBuffer()                       // Get all buffered logs
Logger.search('device')                  // Search by keyword
Logger.errors()                          // Recent errors only
Logger.dump(50)                          // Pretty print last 50 entries

// Status
Logger.status()                          // Show current config
Logger.modules()                         // List all registered modules
```

### Usage in Code

```typescript
import { Logger } from '@/services/logger';
const log = Logger.create('MyModule');

log.debug('Verbose info', { data });     // Only shows if DEBUG enabled
log.info('Important event');             // Always shows
log.warn('Warning', data);               // Orange in console
log.error('Error occurred', error);      // Red, always shows
```

---

## License

MIT - see [LICENSE](LICENSE)
