export type AnnotationScope = 'composition' | 'clip';

export interface SourceAnnotation {
  id: string;
  text: string;
  startTime: number;
  endTime: number;
  createdAt: number;
  scope?: AnnotationScope;
  clipId?: string;
}
