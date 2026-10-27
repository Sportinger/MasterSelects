// Reasons of the settings the phone shows greyed (hardware, desktop programs).
export const PHONE_SETTINGS_LIMITS = {
  touchGoo: 'The goo touch blobs belong to the full editor. On the phone every surface is a precision surface (timeline, sliders, preview), so the blobs would cover what you touch; use Show touches instead.',
  externalDisplay: 'A phone browser cannot address a second screen on its own: casting or a cable only mirrors this screen, and there is no browser or app transport for an independent second picture. Use the fullscreen preview (the fullscreen button next to play) or Output windows in the full editor on a computer.',
  optix: 'The native OptiX renderer runs as a local CUDA/OptiX process with NVIDIA drivers, which a phone browser cannot run. The phone renders with WebGPU, the same picture the export uses.',
  localModels: 'MatAnyone2, MuScriptor and the other local models run in the desktop native helper with Python (and an NVIDIA GPU for MatAnyone2), which a phone browser cannot install or start. Browser AI (segmentation, transcription on this device) needs no helper; projects keep their helper results and open on the desktop to continue.',
} as const;
