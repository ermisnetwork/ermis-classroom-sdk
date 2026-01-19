/**
 * VCR SDK - Virtual Classroom SDK
 * A TypeScript SDK for Virtual Classroom API
 * 
 * This SDK provides access to 5 resources:
 * - Events: Create, read, update, delete events
 * - Registrants: Manage event participants
 * - Rewards: Manage event rewards
 * - Ratings: Read-only access to event ratings
 * - Permissions: Manage student permissions in the classroom
 */

import { VCRHTTPClient } from './client';
import { EventsResource, RegistrantsResource } from './api/events';
import { RewardsResource } from './api/rewards';
import { RatingsResource } from './api/ratings';
import { PermissionsResource } from './api/permissions';

export interface VCRClientConfig {
  /**
   * API Key for authentication
   * Format: ak_<keyId>.<secret>
   * @example "ak_1234567890abcdef.a1b2c3d4e5f6789..."
   */
  apiKey: string;
  /**
   * Base URL of the VCR API
   * @default "https://api.vcr.example.com"
   */
  baseUrl?: string;
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
   * Use Authorization header instead of x-api-key header
   * @default false (uses x-api-key header - recommended)
   */
  useAuthorizationHeader?: boolean;
}

export class VCRClient {
  private httpClient: VCRHTTPClient;

  // API resources
  public readonly events: EventsResource;
  public readonly registrants: RegistrantsResource;
  public readonly rewards: RewardsResource;
  public readonly ratings: RatingsResource;
  public readonly permissions: PermissionsResource;

  constructor(config: VCRClientConfig) {
    // Initialize HTTP client
    this.httpClient = new VCRHTTPClient({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      timeout: config.timeout,
      headers: config.headers,
      useAuthorizationHeader: config.useAuthorizationHeader,
    });

    // Initialize API resources
    this.events = new EventsResource(this.httpClient);
    this.registrants = new RegistrantsResource(this.httpClient);
    this.rewards = new RewardsResource(this.httpClient);
    this.ratings = new RatingsResource(this.httpClient);
    this.permissions = new PermissionsResource(this.httpClient);
  }

  /**
   * Update API key
   */
  setApiKey(apiKey: string): void {
    this.httpClient.setApiKey(apiKey);
  }

  /**
   * Get the underlying HTTP client
   * Use this for custom requests if needed
   */
  getClient(): VCRHTTPClient {
    return this.httpClient;
  }
}

/**
 * Factory function to create a new VCR SDK instance
 */
export const createVCRClient = (config: VCRClientConfig): VCRClient => {
  return new VCRClient(config);
};

// Export all types
export * from './types';

// Export HTTP client and error classes
export {
  VCRHTTPClient,
  VCRError,
  AuthenticationError,
  PermissionError,
  NotFoundError,
  RateLimitError,
  ServerError,
} from './client';

// Export utility functions
export * from './utils';
