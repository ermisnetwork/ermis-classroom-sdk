/**
 * Scores API
 */

import type { VCRClient } from '../client';
import type {
  CreateScoreDto,
  BulkCreateScoresDto,
  UpdateScoreDto,
  PublishScoresDto,
  ReviewScoreDto,
  ProcessReviewDto,
  ScoreResponseDto,
  PaginatedResponse,
  PaginationParams,
  ApiResponse,
} from '../types';

export class ScoresAPI {
  constructor(private client: VCRClient) {}

  /**
   * Create a new score
   */
  async create(data: CreateScoreDto): Promise<ApiResponse<ScoreResponseDto>> {
    return this.client.post<ApiResponse<ScoreResponseDto>>('/scores', data);
  }

  /**
   * Bulk create scores
   */
  async bulkCreate(data: BulkCreateScoresDto): Promise<ApiResponse<ScoreResponseDto[]>> {
    return this.client.post<ApiResponse<ScoreResponseDto[]>>('/scores/bulk', data);
  }

  /**
   * Get scores with pagination
   */
  async list(params?: PaginationParams & { eventId?: string; participantId?: string }): Promise<PaginatedResponse<ScoreResponseDto>> {
    return this.client.get<PaginatedResponse<ScoreResponseDto>>('/scores', params);
  }

  /**
   * Get score by ID
   */
  async get(id: string): Promise<ApiResponse<ScoreResponseDto>> {
    return this.client.get<ApiResponse<ScoreResponseDto>>(`/scores/${id}`);
  }

  /**
   * Update score
   */
  async update(id: string, data: UpdateScoreDto): Promise<ApiResponse<ScoreResponseDto>> {
    return this.client.patch<ApiResponse<ScoreResponseDto>>(`/scores/${id}`, data);
  }

  /**
   * Delete score
   */
  async delete(id: string): Promise<void> {
    await this.client.delete(`/scores/${id}`);
  }

  /**
   * Publish scores
   */
  async publish(data: PublishScoresDto): Promise<ApiResponse<any>> {
    return this.client.post<ApiResponse<any>>('/scores/publish', data);
  }

  /**
   * Request score review
   */
  async requestReview(scoreId: string, data: ReviewScoreDto): Promise<ApiResponse<any>> {
    return this.client.post<ApiResponse<any>>(`/scores/${scoreId}/review`, data);
  }

  /**
   * Process score review
   */
  async processReview(scoreId: string, data: ProcessReviewDto): Promise<ApiResponse<any>> {
    return this.client.post<ApiResponse<any>>(`/scores/${scoreId}/review/process`, data);
  }

  /**
   * Get scores by event
   */
  async getByEvent(eventId: string, params?: PaginationParams): Promise<PaginatedResponse<ScoreResponseDto>> {
    return this.list({ ...params, eventId });
  }

  /**
   * Get scores by participant
   */
  async getByParticipant(participantId: string, params?: PaginationParams): Promise<PaginatedResponse<ScoreResponseDto>> {
    return this.list({ ...params, participantId });
  }
}

