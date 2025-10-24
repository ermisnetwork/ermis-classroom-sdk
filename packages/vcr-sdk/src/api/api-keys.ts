/**
 * API Keys API
 */

import type { VCRClient } from '../client';
import type {
  CreateApiKeyDto,
  UpdateApiKeyDto,
  ApiKeyResponseDto,
  CreateApiKeyResponseDto,
  ListApiKeysParams,
} from '../types';

export class ApiKeysAPI {
  constructor(private client: VCRClient) {}

  /**
   * Create a new API key
   */
  async create(data: CreateApiKeyDto): Promise<CreateApiKeyResponseDto> {
    return this.client.post<CreateApiKeyResponseDto>('/api-keys', data);
  }

  /**
   * List all API keys with pagination
   */
  async list(params?: ListApiKeysParams): Promise<ApiKeyResponseDto[]> {
    return this.client.get<ApiKeyResponseDto[]>('/api-keys', params);
  }

  /**
   * Get API key by ID
   */
  async get(id: string): Promise<ApiKeyResponseDto> {
    return this.client.get<ApiKeyResponseDto>(`/api-keys/${id}`);
  }

  /**
   * Update API key
   */
  async update(id: string, data: UpdateApiKeyDto): Promise<ApiKeyResponseDto> {
    return this.client.patch<ApiKeyResponseDto>(`/api-keys/${id}`, data);
  }

  /**
   * Deactivate API key
   */
  async deactivate(id: string): Promise<void> {
    await this.client.delete(`/api-keys/${id}`);
  }

  /**
   * Regenerate API key secret
   */
  async regenerateSecret(id: string): Promise<CreateApiKeyResponseDto> {
    return this.client.post<CreateApiKeyResponseDto>(`/api-keys/${id}/regenerate`);
  }

  /**
   * Get API key usage statistics
   */
  async getUsageStats(id: string): Promise<any> {
    return this.client.get(`/api-keys/${id}/usage`);
  }
}

