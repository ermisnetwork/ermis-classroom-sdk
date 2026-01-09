/**
 * Ratings API (Read Only)
 * Manages event ratings (đánh giá)
 * Note: API Key chỉ có quyền xem, không có quyền tạo hay sửa đánh giá
 */

import type { VCRHTTPClient } from '../client';
import type {
  RatingList,
  ApiResponse,
} from '../types';

export class RatingsResource {
  constructor(private client: VCRHTTPClient) {}

  /**
   * Get event ratings
   * @param eventId Event ID
   * @returns Rating list with average rating and total ratings
   */
  async list(eventId: string): Promise<RatingList> {
    const response = await this.client.get<ApiResponse<RatingList>>(
      `/events/${eventId}/ratings`
    );
    return response.data;
  }
}
