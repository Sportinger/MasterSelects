export interface RotationDegrees {
  x?: number;
  y?: number;
  z?: number;
}

export interface RotationRadians {
  x: number;
  y: number;
  z: number;
}

export function degreesToRadians(value: number): number {
  return value * (Math.PI / 180);
}

/** Convert timeline/authoring rotation values into the renderer's radian contract. */
export function rotationDegreesToRadians(rotation: RotationDegrees): RotationRadians {
  return {
    x: degreesToRadians(rotation.x ?? 0),
    y: degreesToRadians(rotation.y ?? 0),
    z: degreesToRadians(rotation.z ?? 0),
  };
}
