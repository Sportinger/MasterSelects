import type { CropData } from './ImageCropper';

// Export cropped image as data URL
export async function exportCroppedImage(
  imageUrl: string,
  cropData: CropData,
  aspectRatio: { width: number; height: number },
  outputWidth: number = 1280
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      const canvas = document.createElement('canvas');
      const outputHeight = Math.round(outputWidth / aspectRatio.width * aspectRatio.height);
      canvas.width = outputWidth;
      canvas.height = outputHeight;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }

      const imgAspect = img.naturalWidth / img.naturalHeight;
      const targetAspect = aspectRatio.width / aspectRatio.height;

      let srcWidth: number, srcHeight: number, srcX: number, srcY: number;

      if (imgAspect > targetAspect) {
        srcHeight = img.naturalHeight / cropData.scale;
        srcWidth = srcHeight * targetAspect;
      } else {
        srcWidth = img.naturalWidth / cropData.scale;
        srcHeight = srcWidth / targetAspect;
      }

      const maxOffsetX = (img.naturalWidth - srcWidth) / 2;
      const maxOffsetY = (img.naturalHeight - srcHeight) / 2;

      srcX = (img.naturalWidth - srcWidth) / 2 - cropData.offsetX * maxOffsetX;
      srcY = (img.naturalHeight - srcHeight) / 2 - cropData.offsetY * maxOffsetY;

      srcX = Math.max(0, Math.min(img.naturalWidth - srcWidth, srcX));
      srcY = Math.max(0, Math.min(img.naturalHeight - srcHeight, srcY));

      ctx.drawImage(
        img,
        srcX, srcY, srcWidth, srcHeight,
        0, 0, outputWidth, outputHeight
      );

      resolve(canvas.toDataURL('image/png'));
    };

    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = imageUrl;
  });
}
