export interface ExportGpuPhaseRecord {
  frame: number;
  timelineTime: number;
  compositeMs: number | null;
  outputMs: number | null;
  totalGpuMs: number | null;
}

class ExportGpuPhaseDiagnostics {
  private enabled = false;
  private generation = 0;
  private nextFrame = 1;
  private records: ExportGpuPhaseRecord[] = [];

  start(): void {
    this.generation += 1;
    this.nextFrame = 1;
    this.records = [];
    this.enabled = true;
  }

  stop(): void {
    this.enabled = false;
    this.generation += 1;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  trackFrame(input: {
    timelineTime: number;
    submittedAt: number;
    compositeCompletion: Promise<void>;
    totalCompletion: Promise<void>;
  }): void {
    if (!this.enabled) return;

    const generation = this.generation;
    const record: ExportGpuPhaseRecord = {
      frame: this.nextFrame++,
      timelineTime: input.timelineTime,
      compositeMs: null,
      outputMs: null,
      totalGpuMs: null,
    };
    this.records.push(record);

    let compositeCompletedAt: number | null = null;
    void input.compositeCompletion.then(() => {
      if (generation !== this.generation) return;
      compositeCompletedAt = performance.now();
      record.compositeMs = compositeCompletedAt - input.submittedAt;
    });
    void input.totalCompletion.then(() => {
      if (generation !== this.generation) return;
      const totalCompletedAt = performance.now();
      record.totalGpuMs = totalCompletedAt - input.submittedAt;
      record.outputMs = compositeCompletedAt === null
        ? null
        : Math.max(0, totalCompletedAt - compositeCompletedAt);
    });
  }

  snapshot(): {
    records: ExportGpuPhaseRecord[];
    averages: {
      compositeMs: number | null;
      outputMs: number | null;
      totalGpuMs: number | null;
    };
  } {
    const records = this.records.map((record) => ({ ...record }));
    const average = (key: 'compositeMs' | 'outputMs' | 'totalGpuMs'): number | null => {
      const values = records
        .map((record) => record[key])
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
      if (values.length === 0) return null;
      return values.reduce((sum, value) => sum + value, 0) / values.length;
    };
    return {
      records,
      averages: {
        compositeMs: average('compositeMs'),
        outputMs: average('outputMs'),
        totalGpuMs: average('totalGpuMs'),
      },
    };
  }
}

export const exportGpuPhaseDiagnostics = new ExportGpuPhaseDiagnostics();
