/** Serializable shader specialization plus frame-varying scalar values. */
export interface ImageOperatorProgram {
  readonly key: string;
  readonly wgsl: string;
  readonly values: readonly number[];
}
