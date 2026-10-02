/** Plain EXIF values; decoder and File handles belong to the runtime owner. */
export interface RawPhotoMetadata {
  camera: string;
  lens: string;
  focalLength: number;
  aperture: number;
  width: number;
  height: number;
}
