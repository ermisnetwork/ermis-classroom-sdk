/**
 * SDK Boilerplate
 * A TypeScript SDK template
 */

export class SDK {
  private config: SDKConfig;

  constructor(config: SDKConfig) {
    this.config = config;
  }

  /**
   * Initialize the SDK
   */
  async init(): Promise<void> {
    console.log('SDK initialized with config:', this.config);
  }

  /**
   * Get the current configuration
   */
  getConfig(): SDKConfig {
    return { ...this.config };
  }

  /**
   * Example method
   */
  async doSomething(input: string): Promise<string> {
    return `Processed: ${input}`;
  }
}

export interface SDKConfig {
  apiKey?: string;
  debug?: boolean;
}

export const createSDK = (config: SDKConfig): SDK => {
  return new SDK(config);
};

// Export everything
export * from './utils';

