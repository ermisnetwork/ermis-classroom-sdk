/**
 * Events API
 * Backend services can strictly manage the "Event" entity.
 * Supports: Create, Get, List, Update, Delete, and Get Participant Statistics
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
  BulkCreateRegistrantsParams,
  BulkCreateRegistrantsResult,
  ListEventsParams,
  ParticipantStats,
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
   * List events with pagination
   * @param params Query parameters (page, limit, search, etc.)
   * @returns Paginated list of events
   */
  async list(params?: ListEventsParams): Promise<PaginatedResponse<Event>> {
    return this.client.get<PaginatedResponse<Event>>('/events', params);
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

  /**
   * Get participant statistics for an event
   * @param eventId Event ID
   * @returns Participant statistics
   */
  async getParticipantStats(eventId: string): Promise<ParticipantStats> {
    const response = await this.client.get<ApiResponse<ParticipantStats>>(
      `/events/${eventId}/participants/stats`
    );
    return response.data;
  }
}

/**
 * Registrants API
 * Full control over the attendee list.
 * Supports: Create, Bulk Create, Create Mock, List, Update, Delete, Kick, Ban, Unban
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

  /**
   * Bulk create registrants for an event
   * Supports partial success: some registrants may fail while others succeed.
   * The server enforces max 100 registrants per request.
   */
  async bulkCreate(
    eventId: string,
    payload: BulkCreateRegistrantsParams,
  ): Promise<BulkCreateRegistrantsResult> {
    // Client-side basic validation (SDK recommendation)
    if (!payload.registrants || payload.registrants.length === 0) {
      throw new Error('registrants array must not be empty');
    }

    if (payload.registrants.length > 100) {
      throw new Error('registrants array must not contain more than 100 items');
    }

    const response = await this.client.post<ApiResponse<BulkCreateRegistrantsResult>>(
      `/events/${eventId}/registrants/bulk`,
      payload,
    );

    return response.data;
  }

  /**
   * Create mock registrants for an event
   * Creates fake users for testing purposes.
   * @param eventId Event ID
   * @param count Number of mock registrants to create
   * @returns Created mock registrants
   */
  async createMock(
    eventId: string,
    count: number
  ): Promise<Registrant[]> {
    const response = await this.client.post<ApiResponse<Registrant[]>>(
      `/events/${eventId}/registrants/mock`,
      { count }
    );
    return response.data;
  }

  /**
   * Kick a participant from an event
   * Removes the user from the video room immediately. They can rejoin if they have valid access.
   * @param eventId Event ID
   * @param registrantId Registrant ID
   * @param reason Optional reason for kicking
   * @returns Updated registrant
   */
  async kick(
    eventId: string,
    registrantId: string,
    reason?: string
  ): Promise<Registrant> {
    const response = await this.client.post<ApiResponse<Registrant>>(
      `/events/${eventId}/registrants/${registrantId}/kick`,
      reason ? { reason } : undefined
    );
    return response.data;
  }

  /**
   * Ban a registrant from an event
   * Kicks the user and prevents them from rejoining the event.
   * @param eventId Event ID
   * @param registrantId Registrant ID
   * @param reason Optional reason for banning
   * @returns Updated registrant with ban information
   */
  async ban(
    eventId: string,
    registrantId: string,
    reason?: string
  ): Promise<Registrant> {
    const response = await this.client.post<ApiResponse<Registrant>>(
      `/events/${eventId}/registrants/${registrantId}/ban`,
      reason ? { reason } : undefined
    );
    return response.data;
  }

  /**
   * Unban a registrant from an event
   * Allows the registrant to join the event again.
   * @param eventId Event ID
   * @param registrantId Registrant ID
   * @returns Updated registrant without ban information
   */
  async unban(eventId: string, registrantId: string): Promise<Registrant> {
    const response = await this.client.post<ApiResponse<Registrant>>(
      `/events/${eventId}/registrants/${registrantId}/unban`
    );
    return response.data;
  }
}
