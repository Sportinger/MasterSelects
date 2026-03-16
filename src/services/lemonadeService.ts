// Lemonade Service
// Server management wrapper for Lemonade Server
// Handles server lifecycle, health monitoring, and user-facing status

import { Logger } from './logger';
import { lemonadeProvider, LEMONADE_MODELS, MODEL_PRESETS } from './lemonadeProvider';

const log = Logger.create('LemonadeService');

export interface ServerStatus {
  available: boolean;
  models: string[];
  currentModel: string;
  usingFallback: boolean;
  lastCheck: number;
  error?: string;
}

export interface ServerHealth {
  status: 'online' | 'offline' | 'checking';
  models?: Array<{
    id: string;
    name: string;
    size?: string;
    description?: string;
    loaded?: boolean;
  }>;
  currentModel?: string;
  error?: string;
}

export interface LemonadeServiceConfig {
  autoCheckOnStartup: boolean;
  checkInterval: number; // ms between automatic health checks
  endpoint: string;
  defaultModel: string;
  fallbackModel: string;
}

class LemonadeServiceClass {
  private status: ServerStatus = {
    available: false,
    models: [],
    currentModel: LEMONADE_MODELS.PRIMARY,
    usingFallback: false,
    lastCheck: 0,
  };

  private checkIntervalId: number | null = null;
  private config: LemonadeServiceConfig = {
    autoCheckOnStartup: true,
    checkInterval: 30000, // 30 seconds
    endpoint: 'http://localhost:8000/api/v1',
    defaultModel: LEMONADE_MODELS.PRIMARY,
    fallbackModel: LEMONADE_MODELS.FAST_FALLBACK,
  };

  private statusListeners: Set<(status: ServerStatus) => void> = new Set();

  constructor() {
    if (this.config.autoCheckOnStartup) {
      this.checkHealth();
    }
    this.startPeriodicChecks();
  }

  /**
   * Subscribe to status changes
   */
  subscribe(listener: (status: ServerStatus) => void): () => void {
    this.statusListeners.add(listener);
    // Immediately call with current status
    listener(this.status);
    // Return unsubscribe function
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  /**
   * Notify all listeners of status change
   */
  private notifyListeners(): void {
    this.statusListeners.forEach(listener => {
      try {
        listener({ ...this.status });
      } catch (error) {
        log.error('Status listener error:', error);
      }
    });
  }

  /**
   * Start periodic health checks
   */
  private startPeriodicChecks(): void {
    this.stopPeriodicChecks();
    this.checkIntervalId = window.setInterval(() => {
      this.checkHealth();
    }, this.config.checkInterval);
    log.debug('Started periodic health checks', { interval: this.config.checkInterval });
  }

  /**
   * Stop periodic health checks
   */
  private stopPeriodicChecks(): void {
    if (this.checkIntervalId !== null) {
      clearInterval(this.checkIntervalId);
      this.checkIntervalId = null;
      log.debug('Stopped periodic health checks');
    }
  }

  /**
   * Check server health and update status
   */
  async checkHealth(): Promise<ServerHealth> {
    log.debug('Checking server health...');

    try {
      const result = await lemonadeProvider.checkServerHealth();

      this.status = {
        available: result.available,
        models: result.models || [],
        currentModel: this.status.currentModel,
        usingFallback: this.status.usingFallback,
        lastCheck: Date.now(),
        error: result.error,
      };

      this.notifyListeners();

      const health: ServerHealth = {
        status: result.available ? 'online' : 'offline',
        models: this.getKnownModels(result.models || []),
        currentModel: this.status.currentModel,
        error: result.error,
      };

      log.debug('Health check complete', { status: health.status, models: health.models?.length });
      return health;
    } catch (error) {
      this.status = {
        available: false,
        models: [],
        currentModel: this.status.currentModel,
        usingFallback: this.status.usingFallback,
        lastCheck: Date.now(),
        error: error instanceof Error ? error.message : 'Unknown error',
      };

      this.notifyListeners();

      return {
        status: 'offline',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get known models with metadata
   */
  private getKnownModels(availableModels: string[]): ServerHealth['models'] {
    return MODEL_PRESETS.map(preset => ({
      id: preset.id,
      name: preset.name,
      size: preset.size,
      description: preset.description,
      loaded: availableModels.includes(preset.id),
    }));
  }

  /**
   * Get current server status
   */
  getStatus(): ServerStatus {
    return { ...this.status };
  }

  /**
   * Get all available model presets
   */
  getModelPresets(): typeof MODEL_PRESETS {
    return MODEL_PRESETS;
  }

  /**
   * Set current model
   */
  async setModel(modelId: string): Promise<boolean> {
    const presets = MODEL_PRESETS;
    const preset = presets.find(p => p.id === modelId);

    if (!preset) {
      log.warn('Unknown model:', modelId);
      return false;
    }

    // Check if model is available
    if (!this.status.models.includes(modelId)) {
      log.warn('Model not available:', modelId);
      // Still allow setting it - model may load on demand
    }

    lemonadeProvider.configure({ model: modelId });
    this.status.currentModel = modelId;
    this.notifyListeners();

    log.info('Model changed', { model: modelId });
    return true;
  }

  /**
   * Toggle fallback model
   */
  setUseFallback(useFallback: boolean): void {
    lemonadeProvider.toggleFallback(useFallback);
    this.status.usingFallback = useFallback;
    this.notifyListeners();
    log.info('Fallback setting changed', { useFallback });
  }

  /**
   * Get current model
   */
  getCurrentModel(): string {
    return this.status.usingFallback
      ? this.config.fallbackModel
      : this.status.currentModel;
  }

  /**
   * Check if a specific model is available
   */
  isModelAvailable(modelId: string): boolean {
    return this.status.models.includes(modelId);
  }

  /**
   * Get recommended model for task type
   */
  getRecommendedModel(taskType: 'simple' | 'complex' | 'default'): string {
    switch (taskType) {
      case 'simple':
        return this.config.fallbackModel;
      case 'complex':
        return LEMONADE_MODELS.HIGH_QUALITY;
      default:
        return this.status.currentModel;
    }
  }

  /**
   * Update configuration
   */
  configure(config: Partial<LemonadeServiceConfig>): void {
    this.config = { ...this.config, ...config };

    if (config.endpoint) {
      lemonadeProvider.configure({ endpoint: config.endpoint });
    }

    log.info('Configuration updated', this.config);
  }

  /**
   * Get configuration
   */
  getConfig(): LemonadeServiceConfig {
    return { ...this.config };
  }

  /**
   * Manually refresh server status
   */
  async refresh(): Promise<ServerHealth> {
    return this.checkHealth();
  }

  /**
   * Check if server is online
   */
  isOnline(): boolean {
    return this.status.available;
  }

  /**
   * Get user-friendly status message
   */
  getStatusMessage(): string {
    if (this.status.available) {
      const modelCount = this.status.models.length;
      return `Lemonade Server online (${modelCount} model${modelCount !== 1 ? 's' : ''} available)`;
    } else if (this.status.error) {
      return `Lemonade Server offline: ${this.status.error}`;
    } else {
      return 'Lemonade Server offline - Is it running?';
    }
  }

  /**
   * Cleanup on unmount
   */
  destroy(): void {
    this.stopPeriodicChecks();
    this.statusListeners.clear();
    log.debug('Service destroyed');
  }
}

// HMR-safe singleton
let instance: LemonadeServiceClass | null = null;

if (import.meta.hot) {
  import.meta.hot.accept();
  if (import.meta.hot.data?.lemonadeService) {
    instance = import.meta.hot.data.lemonadeService;
    log.debug('Restored instance from HMR');
  }
  import.meta.hot.dispose((data) => {
    data.lemonadeService = instance;
  });
}

// Export singleton instance
export const lemonadeService = instance ?? new LemonadeServiceClass();

if (import.meta.hot && !instance) {
  instance = lemonadeService;
  import.meta.hot.data.lemonadeService = instance;
}

// Export class for testing
export { LemonadeServiceClass };
