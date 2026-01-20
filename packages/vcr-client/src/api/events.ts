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
  BulkCreateRegistrantsParams,
  BulkCreateRegistrantsResult,
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

  /**
   * Kick a user from the event's video room
   * Disconnects the user from the video room immediately by closing their stream/socket connection.
   * 
   * **Important Notes:**
   * - This API ONLY disconnects the user from the current session, it does NOT prevent them from rejoining.
   * - The user can join again immediately after being kicked (unless they are also banned).
   * - To permanently prevent rejoining, use `registrants.ban()` after kicking.
   * - Backend automatically looks up the `streamId` from `authId`, so you only need to provide `authId`.
   * 
   * @param eventId Event ID
   * @param authId User ID (authId) of the user to kick - this is the `authId` field from registrant/user system
   * @param reason Optional reason for kicking (will be shown to the user when they are disconnected)
   * @returns Promise that resolves when kick is successful (API returns 204 No Content)
   * @throws {NotFoundError} If event doesn't exist or doesn't have a video room
   * @throws {PermissionError} If user doesn't have permission to kick
   * @note Requires Bearer Token (Teacher/Admin/AO) or API Key
   * @example
   * ```typescript
   * // Scenario 1: Temporary kick (user can rejoin)
   * await client.events.kick('event-123', 'student_12345', 'Gây mất trật tự');
   * 
   * // Scenario 2: Permanent ban (kick + ban)
   * // Step 1: Ban the registrant (prevents future joins)
   * await client.registrants.ban('event-123', 'registrant-456', 'Vi phạm quy chế thi');
   * // Step 2: Kick if currently online (disconnects immediately)
   * await client.events.kick('event-123', 'student_12345', 'Vi phạm quy chế thi');
   * ```
   */
  async kick(
    eventId: string,
    authId: string,
    reason?: string
  ): Promise<void> {
    const body: { authId: string; reason?: string } = { authId };
    if (reason) {
      body.reason = reason;
    }
    
    // API returns 204 No Content on success, so we don't expect a response body
    await this.client.post<void>(`/events/${eventId}/kick`, body);
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

  /**
   * Ban a registrant from an event
   * Prevents the registrant from joining the event, even with a valid join code.
   * API keys can bypass this restriction when joining.
   * 
   * **Important Notes:**
   * - This API automatically updates the database status (`isBanned = true`) AND kicks the user from the video room if they are currently online.
   * - The system will automatically call the kick service when banning, so you don't need to call `events.kick()` separately.
   * - If the kick fails (e.g., user is not online), the ban operation still succeeds because the database ban is completed.
   * - Uses `authId` (User ID from your auth system) instead of `registrantId` for easier integration.
   * 
   * @param eventId Event ID
   * @param authId User ID (authId) of the user to ban - this is the `authId` field from your auth/registrant system
   * @param reason Optional reason for banning
   * @returns Success response with message
   * @note Only Admin and Teacher can ban registrants
   * @example
   * ```typescript
   * // Ban a registrant (automatically kicks if online)
   * await client.registrants.ban('event-123', 'student_12345', 'Vi phạm quy chế thi');
   * ```
   */
  async ban(
    eventId: string,
    authId: string,
    reason?: string
  ): Promise<ApiResponse<{ success: boolean; message: string }>> {
    const body: { authId: string; reason?: string } = { authId };
    if (reason) {
      body.reason = reason;
    }
    
    const response = await this.client.post<ApiResponse<{ success: boolean; message: string }>>(
      `/events/${eventId}/registrants/ban`,
      body
    );
    return response;
  }

  /**
   * Unban a registrant from an event
   * Allows the registrant to join the event again by removing the ban status.
   * After unbanning, the user can join the event using their join code or personal join link.
   * 
   * **Important Notes:**
   * - Uses `authId` (User ID from your auth system) instead of `registrantId` for easier integration.
   * - The system will find the registrant by `authId` and remove the ban status.
   * 
   * @param eventId Event ID
   * @param authId User ID (authId) of the user to unban - this is the `authId` field from your auth/registrant system
   * @returns Success response with message
   * @note Only Admin and Teacher can unban registrants
   * @example
   * ```typescript
   * // Unban a registrant
   * await client.registrants.unban('event-123', 'student_12345');
   * ```
   */
  async unban(eventId: string, authId: string): Promise<ApiResponse<{ success: boolean; message: string }>> {
    const response = await this.client.post<ApiResponse<{ success: boolean; message: string }>>(
      `/events/${eventId}/registrants/unban`,
      { authId }
    );
    return response;
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
}
