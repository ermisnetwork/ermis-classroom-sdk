/**
 * VCR SDK - Virtual Classroom SDK
 * A comprehensive TypeScript SDK for Virtual Classroom API
 */

import { VCRClient } from './client';
import { AuthAPI } from './api/auth';
import { ApiKeysAPI } from './api/api-keys';
import { UsersAPI } from './api/users';
import { EventsAPI } from './api/events';
import { TemplatesAPI } from './api/templates';
import { ScoresAPI } from './api/scores';
import { EventLogsAPI } from './api/event-logs';

export interface VCRSDKConfig {
  /**
   * Base URL of the VCR API
   * @example "http://localhost:3000/api"
   */
  baseUrl: string;

  /**
   * API key for authentication
   * Use this for server-to-server communication
   */
  apiKey?: string;

  /**
   * Access token for bearer authentication
   * Use this for user-authenticated requests
   */
  accessToken?: string;

  /**
   * Request timeout in milliseconds
   * @default 30000
   */
  timeout?: number;

  /**
   * Additional headers to include in all requests
   */
  headers?: Record<string, string>;

  /**
   * Enable debug mode
   * @default false
   */
  debug?: boolean;
}

export class VCRSDK {
  private client: VCRClient;

  // API modules
  public readonly auth: AuthAPI;
  public readonly apiKeys: ApiKeysAPI;
  public readonly users: UsersAPI;
  public readonly events: EventsAPI;
  public readonly templates: TemplatesAPI;
  public readonly scores: ScoresAPI;
  public readonly eventLogs: EventLogsAPI;

  constructor(config: VCRSDKConfig) {
    // Initialize HTTP client
    this.client = new VCRClient({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      accessToken: config.accessToken,
      timeout: config.timeout,
      headers: config.headers,
    });

    // Initialize API modules
    this.auth = new AuthAPI(this.client);
    this.apiKeys = new ApiKeysAPI(this.client);
    this.users = new UsersAPI(this.client);
    this.events = new EventsAPI(this.client);
    this.templates = new TemplatesAPI(this.client);
    this.scores = new ScoresAPI(this.client);
    this.eventLogs = new EventLogsAPI(this.client);

    if (config.debug) {
      console.log('VCR SDK initialized with config:', {
        baseUrl: config.baseUrl,
        hasApiKey: !!config.apiKey,
        hasAccessToken: !!config.accessToken,
      });
    }
  }

  /**
   * Set access token for bearer authentication
   * Useful after login to update the token
   */
  setAccessToken(token: string): void {
    this.client.setAccessToken(token);
  }

  /**
   * Set API key for API key authentication
   */
  setApiKey(apiKey: string): void {
    this.client.setApiKey(apiKey);
  }

  /**
   * Get the underlying HTTP client
   * Use this for custom requests
   */
  getClient(): VCRClient {
    return this.client;
  }
}

/**
 * Factory function to create a new VCR SDK instance
 */
export const createVCRSDK = (config: VCRSDKConfig): VCRSDK => {
  return new VCRSDK(config);
};

// Export all types
export * from './types';
export * from './client';
export * from './utils';

