/**
 * Rewards API
 * Services can manage rewards (CRUD).
 * Ownership Rule: You can only Update or Delete rewards that were created by your API Key.
 */

import type { VCRHTTPClient } from '../client';
import type {
  CreateRewardParams,
  UpdateRewardParams,
  Reward,
  ApiResponse,
  PaginatedResponse,
  ListRewardsParams,
} from '../types';

export class RewardsResource {
  constructor(private client: VCRHTTPClient) {}

  /**
   * Create a new reward
   * @param data Reward data including file (image)
   */
  async create(data: CreateRewardParams): Promise<Reward> {
    const formData = new FormData();
    formData.append('file', data.file);
    formData.append('name', data.name);
    if (data.description) {
      formData.append('description', data.description);
    }

    const response = await this.client.postFormData<ApiResponse<Reward>>(
      '/event-rewards',
      formData
    );
    return response.data;
  }

  /**
   * Get all available rewards
   * @param params Query parameters (page, limit, search, etc.)
   * @returns Paginated list of rewards
   */
  async list(params?: ListRewardsParams): Promise<PaginatedResponse<Reward>> {
    return this.client.get<PaginatedResponse<Reward>>('/event-rewards', params);
  }

  /**
   * Get reward by ID
   * @param rewardId Reward ID
   */
  async get(rewardId: string): Promise<Reward> {
    const response = await this.client.get<ApiResponse<Reward>>(
      `/event-rewards/${rewardId}`
    );
    return response.data;
  }

  /**
   * Update reward
   * @param rewardId Reward ID
   * @param data Update data
   * @note Only rewards created by this API Key can be updated
   */
  async update(rewardId: string, data: UpdateRewardParams): Promise<Reward> {
    const formData = new FormData();
    if (data.name) {
      formData.append('name', data.name);
    }
    if (data.description !== undefined) {
      formData.append('description', data.description);
    }
    if (data.file) {
      formData.append('file', data.file);
    }

    const response = await this.client.patchFormData<ApiResponse<Reward>>(
      `/event-rewards/${rewardId}`,
      formData
    );
    return response.data;
  }

  /**
   * Delete reward
   * @param rewardId Reward ID
   * @note Only rewards created by this API Key can be deleted
   */
  async delete(rewardId: string): Promise<void> {
    await this.client.delete(`/event-rewards/${rewardId}`);
  }
}
