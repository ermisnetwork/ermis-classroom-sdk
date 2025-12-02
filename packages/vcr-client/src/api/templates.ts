/**
 * Event Templates API
 */

import type { VCRClient } from '../client';
import type {
  CreateEventTemplateDto,
  UpdateEventTemplateDto,
  EventTemplateResponseDto,
  PaginatedResponse,
  PaginationParams,
  ApiResponse,
} from '../types';

export class TemplatesAPI {
  constructor(private client: VCRClient) {}

  /**
   * Create a new event template
   */
  async create(data: CreateEventTemplateDto): Promise<ApiResponse<EventTemplateResponseDto>> {
    return this.client.post<ApiResponse<EventTemplateResponseDto>>('/event-templates', data);
  }

  /**
   * Get all event templates with pagination
   */
  async list(params?: PaginationParams): Promise<PaginatedResponse<EventTemplateResponseDto>> {
    return this.client.get<PaginatedResponse<EventTemplateResponseDto>>('/event-templates', params);
  }

  /**
   * Get event template by ID
   */
  async get(id: string): Promise<ApiResponse<EventTemplateResponseDto>> {
    return this.client.get<ApiResponse<EventTemplateResponseDto>>(`/event-templates/${id}`);
  }

  /**
   * Update event template
   */
  async update(id: string, data: UpdateEventTemplateDto): Promise<ApiResponse<EventTemplateResponseDto>> {
    return this.client.patch<ApiResponse<EventTemplateResponseDto>>(`/event-templates/${id}`, data);
  }

  /**
   * Delete event template
   */
  async delete(id: string): Promise<void> {
    await this.client.delete(`/event-templates/${id}`);
  }
}

