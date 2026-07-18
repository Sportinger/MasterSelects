import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  isAudioFile,
  isGaussianSplatFile,
  isMediaFile,
  isModelFile,
  isVideoFile,
} from '../../src/components/timeline/utils/fileTypeHelpers';

const fcOptions = {
  numRuns: 200,
  seed: 20260518,
};

const representativeMediaExtensions = ['mp4', 'wav', 'png', 'obj', 'fbx', 'gltf', 'glb', 'ply', 'lottie'] as const;
const representativeModelExtensions = ['obj', 'fbx', 'gltf', 'glb'] as const;
const representativeGaussianSplatExtensions = ['ply', 'splat'] as const;

const knownVideoExtension = 'mp4';
const knownAudioExtension = 'wav';
const unknownExtension = fc.array(fc.constantFrom(
  '0', '1', '2', '3', '4', '5', '6', '7',
  '8', '9', 'a', 'b', 'c', 'd', 'e', 'f',
), { minLength: 8, maxLength: 16 })
  .map((chars) => chars.join(''))
  .map((suffix) => `masterselects-property-unknown-${suffix}`);

const fileStem = fc.string({ minLength: 1, maxLength: 24 }).filter((value) => (
  !value.includes('.') && !value.includes('/') && !value.includes('\\')
));

function randomlyCaseExtension(ext: string): fc.Arbitrary<string> {
  return fc.array(fc.boolean(), { minLength: ext.length, maxLength: ext.length })
    .map((upperFlags) => ext
      .split('')
      .map((char, index) => (upperFlags[index] ? char.toUpperCase() : char.toLowerCase()))
      .join(''));
}

function fileWithExtension(name: string, ext: string, type = ''): File {
  return new File([''], `${name}.${ext}`, { type });
}

describe('timeline file type helper properties', () => {
  it('detects representative public media extensions case-insensitively', () => {
    fc.assert(
      fc.property(
        fileStem,
        fc.constantFrom(...representativeMediaExtensions).chain((ext) => randomlyCaseExtension(ext)),
        (name, ext) => {
          expect(isMediaFile(fileWithExtension(name, ext))).toBe(true);
        },
      ),
      fcOptions,
    );
  });

  it('uses MIME prefixes as media evidence even for unknown extensions', () => {
    fc.assert(
      fc.property(
        fileStem,
        fc.constantFrom('video/custom', 'audio/custom', 'image/custom'),
        unknownExtension,
        (name, type, ext) => {
          const file = fileWithExtension(name, ext, type);

          expect(isMediaFile(file)).toBe(true);
          expect(isVideoFile(file)).toBe(type.startsWith('video/'));
          expect(isAudioFile(file)).toBe(type.startsWith('audio/'));
        },
      ),
      fcOptions,
    );
  });

  it('keeps representative model and gaussian splat extension classifiers scoped to their public behavior', () => {
    fc.assert(
      fc.property(
        fileStem,
        fc.constantFrom(
          ...representativeModelExtensions,
          ...representativeGaussianSplatExtensions,
        ).chain((ext) => randomlyCaseExtension(ext)),
        (name, ext) => {
          const file = fileWithExtension(name, ext);
          const normalizedExt = ext.toLowerCase();

          expect(isModelFile(file)).toBe(
            representativeModelExtensions.includes(normalizedExt as typeof representativeModelExtensions[number]),
          );
          expect(isGaussianSplatFile(file)).toBe(
            representativeGaussianSplatExtensions.includes(
              normalizedExt as typeof representativeGaussianSplatExtensions[number],
            ),
          );
        },
      ),
      fcOptions,
    );
  });

  it('does not classify current unknown sentinel extensions without media MIME evidence', () => {
    fc.assert(
      fc.property(fileStem, unknownExtension, (name, ext) => {
        const file = fileWithExtension(name, ext);

        expect(isMediaFile(file)).toBe(false);
        expect(isVideoFile(file)).toBe(false);
        expect(isAudioFile(file)).toBe(false);
        expect(isModelFile(file)).toBe(false);
        expect(isGaussianSplatFile(file)).toBe(false);
      }),
      fcOptions,
    );
  });

  it('uses the final extension segment for multi-dot names', () => {
    fc.assert(
      fc.property(fileStem, unknownExtension, (name, ext) => {
        const hiddenVideoExtension = new File([''], `${name}.${knownVideoExtension}.${ext}`);
        const hiddenAudioExtension = new File([''], `${name}.${knownAudioExtension}.${ext}`);
        const finalVideoExtension = new File([''], `${name}.${ext}.${knownVideoExtension}`);
        const finalAudioExtension = new File([''], `${name}.${ext}.${knownAudioExtension}`);

        expect(isMediaFile(hiddenVideoExtension)).toBe(false);
        expect(isVideoFile(hiddenVideoExtension)).toBe(false);
        expect(isMediaFile(hiddenAudioExtension)).toBe(false);
        expect(isAudioFile(hiddenAudioExtension)).toBe(false);

        expect(isMediaFile(finalVideoExtension)).toBe(true);
        expect(isVideoFile(finalVideoExtension)).toBe(true);
        expect(isMediaFile(finalAudioExtension)).toBe(true);
        expect(isAudioFile(finalAudioExtension)).toBe(true);
      }),
      fcOptions,
    );
  });

  it('treats MIME and extension evidence additively when they conflict', () => {
    fc.assert(
      fc.property(fileStem, (name) => {
        const audioNamedVideo = fileWithExtension(name, knownAudioExtension, 'video/custom');
        const videoNamedAudio = fileWithExtension(name, knownVideoExtension, 'audio/custom');

        expect(isMediaFile(audioNamedVideo)).toBe(true);
        expect(isVideoFile(audioNamedVideo)).toBe(true);
        expect(isAudioFile(audioNamedVideo)).toBe(true);

        expect(isMediaFile(videoNamedAudio)).toBe(true);
        expect(isVideoFile(videoNamedAudio)).toBe(true);
        expect(isAudioFile(videoNamedAudio)).toBe(true);
      }),
      fcOptions,
    );
  });
});
