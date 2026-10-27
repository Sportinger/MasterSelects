// Probes what this browser can encode at the chosen size and frame rate: every WebCodecs video
// codec the editor exports, the audio encoder and WebAssembly (FFmpeg). Results are cached per
// size/fps; while a probe runs the codecs read null ("still checking").
import { useEffect, useState } from 'react';
import { FrameExporter } from '../../../engine/export';
import type { PhoneExportBrowserCapabilities, PhoneVideoCodec } from './phoneExportFormats';
import { probeAudioCodec } from './usePhoneExport';

const CODECS: readonly PhoneVideoCodec[] = ['h264', 'h265', 'vp9', 'av1'];
const cache = new Map<string, Promise<Record<PhoneVideoCodec, boolean>>>();

function probeCodecs(width: number, height: number, fps: number): Promise<Record<PhoneVideoCodec, boolean>> {
  const key = `${width}x${height}@${fps}`;
  let probe = cache.get(key);
  if (!probe) {
    probe = Promise.all(CODECS.map((codec) => FrameExporter.checkCodecSupport(codec, width, height, fps).catch(() => false)))
      .then((results) => Object.fromEntries(CODECS.map((codec, index) => [codec, results[index]])) as Record<PhoneVideoCodec, boolean>);
    cache.set(key, probe);
  }
  return probe;
}

const UNKNOWN: Record<PhoneVideoCodec, boolean | null> = { h264: null, h265: null, vp9: null, av1: null };

export function usePhoneExportCapabilities(width: number, height: number, fps: number, enabled: boolean): PhoneExportBrowserCapabilities {
  const webCodecs = typeof window !== 'undefined' && FrameExporter.isSupported();
  const wasm = typeof WebAssembly !== 'undefined';
  const key = `${width}x${height}@${fps}`;
  const [codecs, setCodecs] = useState<{ key: string; value: Record<PhoneVideoCodec, boolean> } | null>(null);
  const [audioCodec, setAudioCodec] = useState<'aac' | 'opus' | null>(null);

  useEffect(() => {
    if (!enabled || !webCodecs) return undefined;
    let active = true;
    void probeCodecs(width, height, fps).then((value) => {
      if (active) setCodecs({ key, value });
    });
    return () => { active = false; };
  }, [enabled, fps, height, key, webCodecs, width]);

  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    void probeAudioCodec().then((codec) => {
      if (active) setAudioCodec(codec);
    });
    return () => { active = false; };
  }, [enabled]);

  return {
    webCodecs,
    wasm,
    audioCodec,
    codecs: !webCodecs
      ? { h264: false, h265: false, vp9: false, av1: false }
      : codecs?.key === key ? codecs.value : UNKNOWN,
  };
}
