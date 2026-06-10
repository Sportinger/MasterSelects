import { useEffect } from 'react';
import { FrameExporter } from '../../../engine/export';
import type { ContainerFormat, VideoCodec } from '../../../engine/export';

interface UseExportDialogSupportArgs {
  width: number;
  height: number;
  fps: number;
  container: ContainerFormat;
  codec: VideoCodec;
  useCustomBitrate: boolean;
  setIsSupported: (supported: boolean) => void;
  setCodecSupport: (support: Record<VideoCodec, boolean>) => void;
  setBitrate: (bitrate: number) => void;
  setCodec: (codec: VideoCodec) => void;
}

export function useExportDialogSupport({
  width,
  height,
  fps,
  container,
  codec,
  useCustomBitrate,
  setIsSupported,
  setCodecSupport,
  setBitrate,
  setCodec,
}: UseExportDialogSupportArgs) {
  useEffect(() => {
    setIsSupported(FrameExporter.isSupported());
  }, [setIsSupported]);

  useEffect(() => {
    const checkSupport = async () => {
      const support: Record<VideoCodec, boolean> = {
        h264: await FrameExporter.checkCodecSupport('h264', width, height),
        h265: await FrameExporter.checkCodecSupport('h265', width, height),
        vp9: await FrameExporter.checkCodecSupport('vp9', width, height),
        av1: await FrameExporter.checkCodecSupport('av1', width, height),
      };
      setCodecSupport(support);
    };
    checkSupport();
  }, [width, height, setCodecSupport]);

  useEffect(() => {
    if (!useCustomBitrate) {
      setBitrate(FrameExporter.getRecommendedBitrate(width, height, fps));
    }
  }, [width, height, fps, useCustomBitrate, setBitrate]);

  useEffect(() => {
    const availableCodecs = FrameExporter.getVideoCodecs(container);
    if (!availableCodecs.find(c => c.id === codec)) {
      setCodec(availableCodecs[0].id);
    }
  }, [container, codec, setCodec]);
}
