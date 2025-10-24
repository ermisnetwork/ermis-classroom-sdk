/**
 * Events API
 */

import type { VCRClient } from '../client';
import type {
  CreateEventDto,
  UpdateEventDto,
  EventResponseDto,
  ListEventsParams,
  PaginatedResponse,
  ApiResponse,
  CreateRegistrantDto,
  UpdateRegistrantDto,
  JoinWithCodeDto,
  MockRegistrantsDto,
  ListRegistrantsParams,
  CreateAutoBreakoutRoomsDto,
  GetBreakoutRoomTokenDto,
  BreakoutRoomTokenResponseDto,
  UpdateAttendanceStatusDto,
  UpdateParticipantPermissionsDto,
  PinParticipantDto,
} from '../types';

export class EventsAPI {
  constructor(private client: VCRClient) {}

  /**
   * Create a new event
   */
  async create(data: CreateEventDto): Promise<ApiResponse<EventResponseDto>> {
    return this.client.post<ApiResponse<EventResponseDto>>('/events', data);
  }

  /**
   * Get events with filtering and pagination
   */
  async list(params?: ListEventsParams): Promise<PaginatedResponse<EventResponseDto>> {
    return this.client.get<PaginatedResponse<EventResponseDto>>('/events', params);
  }

  /**
   * Get event by ID
   */
  async get(eventId: string): Promise<ApiResponse<EventResponseDto>> {
    return this.client.get<ApiResponse<EventResponseDto>>(`/events/${eventId}`);
  }

  /**
   * Update event
   */
  async update(eventId: string, data: UpdateEventDto): Promise<ApiResponse<EventResponseDto>> {
    return this.client.patch<ApiResponse<EventResponseDto>>(`/events/${eventId}`, data);
  }

  /**
   * Delete event
   */
  async delete(eventId: string): Promise<void> {
    await this.client.delete(`/events/${eventId}`);
  }

  /**
   * Get participant statistics
   */
  async getParticipantStats(eventId: string): Promise<any> {
    return this.client.get(`/events/${eventId}/participants/stats`);
  }

  /**
   * Join event with registrant code
   */
  async joinWithCode(data: JoinWithCodeDto): Promise<any> {
    return this.client.post('/events/registrants/join', data);
  }

  // ============================================================================
  // Registrants
  // ============================================================================

  /**
   * Create event registrant
   */
  async createRegistrant(eventId: string, data: CreateRegistrantDto): Promise<any> {
    return this.client.post(`/events/${eventId}/registrants`, data);
  }

  /**
   * Get list of registrants
   */
  async getRegistrants(eventId: string, params?: ListRegistrantsParams): Promise<PaginatedResponse<any>> {
    return this.client.get<PaginatedResponse<any>>(`/events/${eventId}/registrants`, params);
  }

  /**
   * Get registrant by ID
   */
  async getRegistrant(eventId: string, registrantId: string): Promise<any> {
    return this.client.get(`/events/${eventId}/registrants/${registrantId}`);
  }

  /**
   * Update registrant
   */
  async updateRegistrant(eventId: string, registrantId: string, data: UpdateRegistrantDto): Promise<any> {
    return this.client.patch(`/events/${eventId}/registrants/${registrantId}`, data);
  }

  /**
   * Delete registrant
   */
  async deleteRegistrant(eventId: string, registrantId: string): Promise<void> {
    await this.client.delete(`/events/${eventId}/registrants/${registrantId}`);
  }

  /**
   * Create mock registrants for testing
   */
  async createMockRegistrants(eventId: string, data: MockRegistrantsDto): Promise<any> {
    return this.client.post(`/events/${eventId}/registrants/mock`, data);
  }

  /**
   * Approve registrant
   */
  async approveRegistrant(eventId: string, registrantId: string): Promise<any> {
    return this.client.post(`/events/${eventId}/registrants/${registrantId}/approve`);
  }

  /**
   * Reject registrant
   */
  async rejectRegistrant(eventId: string, registrantId: string): Promise<any> {
    return this.client.post(`/events/${eventId}/registrants/${registrantId}/reject`);
  }

  // ============================================================================
  // Breakout Rooms
  // ============================================================================

  /**
   * Create auto breakout rooms
   */
  async createAutoBreakoutRooms(eventId: string, data: CreateAutoBreakoutRoomsDto): Promise<any> {
    return this.client.post(`/events/${eventId}/breakout-rooms/auto`, data);
  }

  /**
   * Get breakout rooms
   */
  async getBreakoutRooms(eventId: string): Promise<any> {
    return this.client.get(`/events/${eventId}/breakout-rooms`);
  }

  /**
   * Get breakout room token
   */
  async getBreakoutRoomToken(eventId: string, data: GetBreakoutRoomTokenDto): Promise<BreakoutRoomTokenResponseDto> {
    return this.client.post<BreakoutRoomTokenResponseDto>(`/events/${eventId}/breakout-rooms/token`, data);
  }

  /**
   * Delete breakout room
   */
  async deleteBreakoutRoom(eventId: string, roomId: string): Promise<void> {
    await this.client.delete(`/events/${eventId}/breakout-rooms/${roomId}`);
  }

  // ============================================================================
  // Attendance
  // ============================================================================

  /**
   * Get attendance records
   */
  async getAttendance(eventId: string, params?: any): Promise<PaginatedResponse<any>> {
    return this.client.get<PaginatedResponse<any>>(`/events/${eventId}/attendance`, params);
  }

  /**
   * Update attendance status
   */
  async updateAttendanceStatus(eventId: string, registrantId: string, data: UpdateAttendanceStatusDto): Promise<any> {
    return this.client.patch(`/events/${eventId}/attendance/${registrantId}`, data);
  }

  /**
   * Export attendance
   */
  async exportAttendance(eventId: string, format: 'csv' | 'xlsx' = 'csv'): Promise<any> {
    return this.client.get(`/events/${eventId}/attendance/export`, { format });
  }

  // ============================================================================
  // Participants
  // ============================================================================

  /**
   * Update participant permissions
   */
  async updateParticipantPermissions(eventId: string, data: UpdateParticipantPermissionsDto): Promise<any> {
    return this.client.patch(`/events/${eventId}/participants/permissions`, data);
  }

  /**
   * Pin participant
   */
  async pinParticipant(eventId: string, data: PinParticipantDto): Promise<any> {
    return this.client.post(`/events/${eventId}/participants/pin`, data);
  }

  /**
   * Unpin participant
   */
  async unpinParticipant(eventId: string): Promise<any> {
    return this.client.delete(`/events/${eventId}/participants/pin`);
  }

  /**
   * Remove participant
   */
  async removeParticipant(eventId: string, participantAuthId: string): Promise<any> {
    return this.client.post(`/events/${eventId}/participants/remove`, { participantAuthId });
  }

  // ============================================================================
  // Materials & Submissions
  // ============================================================================

  /**
   * Get event materials
   */
  async getMaterials(eventId: string, params?: any): Promise<PaginatedResponse<any>> {
    return this.client.get<PaginatedResponse<any>>(`/events/${eventId}/materials`, params);
  }

  /**
   * Get event submissions
   */
  async getSubmissions(eventId: string, params?: any): Promise<PaginatedResponse<any>> {
    return this.client.get<PaginatedResponse<any>>(`/events/${eventId}/submissions`, params);
  }
}

