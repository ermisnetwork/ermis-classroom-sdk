/**
 * Events API
 * Manages events (lớp học/sự kiện)
 */

import type { VCRHTTPClient } from '../client';
import type {
  CreateEventParams,
  UpdateEventParams,
  Event,
  ApiResponse,
  CreateRegistrantParams,
  UpdateRegistrantParams,
  Registrant,
  PaginatedResponse,
  ListRegistrantsParams,
} from '../types';

export class EventsResource {
  constructor(private client: VCRHTTPClient) {}

  /**
   * Create a new event
   * @param data Event data
   * @returns Created event with joinLink and ermisRoomCode
   */
  async create(data: CreateEventParams): Promise<Event> {
    const response = await this.client.post<ApiResponse<Event>>('/events', data);
    return response.data;
  }

  /**
   * Get event by ID
   * @param eventId Event ID
   */
  async get(eventId: string): Promise<Event> {
    const response = await this.client.get<ApiResponse<Event>>(`/events/${eventId}`);
    return response.data;
  }

  /**
   * Update event
   * @param eventId Event ID
   * @param data Update data
   * @note Only events created by this API Key can be updated
   */
  async update(eventId: string, data: UpdateEventParams): Promise<Event> {
    const response = await this.client.patch<ApiResponse<Event>>(
      `/events/${eventId}`,
      data
    );
    return response.data;
  }

  /**
   * Delete event
   * @param eventId Event ID
   * @note Only events created by this API Key can be deleted
   */
  async delete(eventId: string): Promise<void> {
    await this.client.delete(`/events/${eventId}`);
  }
}

/**
 * Registrants API
 * Manages event registrants (học viên/người tham dự)
 */
export class RegistrantsResource {
  constructor(private client: VCRHTTPClient) {}

  /**
   * Create a new registrant for an event
   * @param eventId Event ID
   * @param data Registrant data
   * @returns Created registrant with personalJoinLink
   */
  async create(eventId: string, data: CreateRegistrantParams): Promise<Registrant> {
    const response = await this.client.post<ApiResponse<Registrant>>(
      `/events/${eventId}/registrants`,
      data
    );
    return response.data;
  }

  /**
   * Get list of registrants for an event
   * @param eventId Event ID
   * @param params Query parameters (page, limit, search, role)
   */
  async list(
    eventId: string,
    params?: ListRegistrantsParams
  ): Promise<PaginatedResponse<Registrant>> {
    return this.client.get<PaginatedResponse<Registrant>>(
      `/events/${eventId}/registrants`,
      params
    );
  }

  /**
   * Update registrant
   * @param eventId Event ID
   * @param registrantId Registrant ID
   * @param data Update data
   * @note Only registrants created by this API Key can be updated
   */
  async update(
    eventId: string,
    registrantId: string,
    data: UpdateRegistrantParams
  ): Promise<Registrant> {
    const response = await this.client.patch<ApiResponse<Registrant>>(
      `/events/${eventId}/registrants/${registrantId}`,
      data
    );
    return response.data;
  }

  /**
   * Delete registrant
   * @param eventId Event ID
   * @param registrantId Registrant ID
   * @note Only registrants created by this API Key can be deleted
   */
  async delete(eventId: string, registrantId: string): Promise<void> {
    await this.client.delete(`/events/${eventId}/registrants/${registrantId}`);
  }
}
