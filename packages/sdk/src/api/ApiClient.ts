/**
 * ApiClient - HTTP client for Ermis Meeting API
 * Handles authentication and API requests
 */

import {
  CreateRoomResponse,
  CreateSubRoomRequest,
  CreateSubRoomResponse,
  CustomEventRequest,
  CustomEventResponse,
  EndRoomRequest,
  EndRoomResponse,
  ErmisClientConfig,
  HealthCheckResponse,
  HttpMethod,
  JoinRoomResponse,
  JoinSubRoomRequest,
  LeaveSubRoomRequest,
  ListParticipantsRequest,
  ListParticipantsResponse,
  ListRoomsResponse,
  RemoveParticipantResponse,
  RoomDetailsResponse,
  RoomUpdateData,
  TokenResponse,
  UpdateParticipantRequest,
  UpdateParticipantResponse,
} from '../types';

/**
 * ApiClient class
 */
export class ApiClient {
  private host: string;
  private apiBaseUrl: string;
  private jwtToken: string | null = null;
  private serviceToken: string | null = null;
  private userId: string | null = null;

  constructor(config: ErmisClientConfig = {}) {
    this.host = config.host || 'daibo.ermis.network:9993';
    this.apiBaseUrl = config.apiUrl || `https://${this.host}/meeting`;
  }

  /**
   * Set authentication token and user ID
   */
  setAuth(token: string, userId: string): void {
    this.jwtToken = token;
    this.userId = userId;
  }

  /**
   * Clear authentication
   */
  clearAuth(): void {
    this.jwtToken = null;
    this.serviceToken = null;
    this.userId = null;
  }

  /**
   * Set service token for admin operations (listRooms, createRoom)
   */
  setServiceToken(token: string): void {
    this.serviceToken = token;
  }

  /**
   * Check if authenticated
   */
  isAuthenticated(): boolean {
    return !!(this.jwtToken && this.userId);
  }


  /**
   * Get dummy token for authentication
   */
  async getDummyUserToken(userId: string): Promise<TokenResponse> {
    const endpoint = '/get-user-token';
    const options: RequestInit = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sub: userId, permissions: {
          can_subscribe: true,
          can_publish: true,
          can_publish_data: true,
          can_publish_sources: [
            ["mic_48k", true],
            ["video_360p", true],
            ["video_720p", true],
            ["screen_share_720p", true],
            ["screen_share_1080p", true],
            ["screen_share_audio", true],
          ],
          hidden: false,
          can_update_metadata: false
        }
      }),
    };

    try {
      const response = await fetch(`${this.apiBaseUrl}${endpoint}`, options);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Token request failed:', error);
      throw error;
    }
  }

  /**
   * Get dummy token for authentication
   */
  async getUserToken(userId: string): Promise<TokenResponse> {
    const endpoint = '/get-user-token';
    const options: RequestInit = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        issuer: userId,
      }),
    };

    try {
      const response = await fetch(`${this.apiBaseUrl}${endpoint}`, options);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Token request failed:', error);
      throw error;
    }
  }

  /**
   * Get dummy token for authentication
   */
  async getDummyServiceToken(userId: string): Promise<TokenResponse> {
    const endpoint = '/get-service-token';
    const options: RequestInit = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        issuer: userId
      }),
    };

    try {
      const response = await fetch(`${this.apiBaseUrl}${endpoint}`, options);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Token request failed:', error);
      throw error;
    }
  }

  /**
   * Generic API call method (uses user token)
   */
  async apiCall<T = any>(
    endpoint: string,
    method: HttpMethod = 'GET',
    body: any = null,
  ): Promise<T> {
    if (!this.userId) {
      throw new Error('Please authenticate first');
    }

    if (!this.jwtToken) {
      throw new Error('JWT token not found');
    }
    const bearer = `Bearer ${this.jwtToken}`;

    const options: RequestInit = {
      method,
      headers: {
        Authorization: bearer,
        'Content-Type': 'application/json',
      },
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(`${this.apiBaseUrl}${endpoint}`, options);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('API call failed:', error);
      throw error;
    }
  }

  /**
   * API call method using service token (for admin operations)
   */
  async serviceApiCall<T = any>(
    endpoint: string,
    method: HttpMethod = 'GET',
    body: any = null,
  ): Promise<T> {
    if (!this.serviceToken) {
      throw new Error('Service token not found. Call getDummyServiceToken first.');
    }
    const bearer = `Bearer ${this.serviceToken}`;

    const options: RequestInit = {
      method,
      headers: {
        Authorization: bearer,
        'Content-Type': 'application/json',
      },
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(`${this.apiBaseUrl}${endpoint}`, options);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('API call failed:', error);
      throw error;
    }
  }

  /**
   * Create a new room (requires service token)
   */
  async createRoom(roomName: string, roomType: string = 'main'): Promise<CreateRoomResponse> {
    return await this.serviceApiCall<CreateRoomResponse>('/rooms', 'POST', {
      room_name: roomName,
      room_type: roomType,
    });
  }

  /**
   * List available rooms (requires service token)
   */
  async listRooms(page: number = 1, perPage: number = 20): Promise<ListRoomsResponse> {
    return await this.serviceApiCall<ListRoomsResponse>('/rooms/list', 'POST', {
      list_query: {
        page,
        per_page: perPage,
        sort_by: 'created_at',
        sort_order: 'desc',
      },
      conditions: {
        is_active: true,
      },
    });
  }

  /**
   * Get room details by ID
   */
  async getRoomById(roomId: string): Promise<RoomDetailsResponse> {
    return await this.apiCall<RoomDetailsResponse>(`/rooms/${roomId}`);
  }

  /**
   * Join a room by room code
   */
  async joinRoom(roomCode: string, appName: string = 'Ermis-Meeting'): Promise<JoinRoomResponse> {
    return await this.apiCall<JoinRoomResponse>('/rooms/join', 'POST', {
      room_code: roomCode,
      app_name: appName,
    });
  }

  /**
   * Create a sub room
   */
  async createSubRoom(request: CreateSubRoomRequest): Promise<CreateSubRoomResponse> {
    return await this.apiCall<CreateSubRoomResponse>('/rooms/breakout', 'POST', request);
  }

  /**
   * Create breakout room
   */
  async createBreakoutRoom(mainRoomId: string, rooms: any[]): Promise<CreateSubRoomResponse> {
    return await this.apiCall<CreateSubRoomResponse>('/rooms/breakout', 'POST', {
      main_room_id: mainRoomId,
      rooms,
    });
  }

  /**
   * Join sub room
   */
  async joinSubRoom(request: JoinSubRoomRequest): Promise<JoinRoomResponse> {
    return await this.apiCall<JoinRoomResponse>('/rooms/join', 'POST', {
      app_name: request.app_name || 'Ermis-Meeting',
      parent_room_id: request.parent_room_id,
      sub_room_id: request.sub_room_id,
      room_code: request.room_code,
    });
  }

  /**
   * Join breakout room
   */
  async joinBreakoutRoom(request: { subRoomId: string; parentRoomId: string }): Promise<any> {
    return await this.apiCall('/rooms/breakout/join', 'POST', {
      sub_room_id: request.subRoomId,
      parent_room_id: request.parentRoomId,
    });
  }

  /**
   * Leave sub room and return to main room
   */
  async leaveSubRoom(request: LeaveSubRoomRequest): Promise<any> {
    return await this.apiCall('/rooms/breakout/leave', 'POST', {
      parent_room_id: request.parent_room_id,
      sub_room_id: request.sub_room_id,
    });
  }

  /**
   * Get sub rooms of a parent room
   */
  async getSubRooms(parentRoomId: string): Promise<any> {
    return await this.apiCall(`/rooms/${parentRoomId}/sub-rooms`);
  }

  /**
   * Close sub room (breakout rooms)
   */
  async closeSubRoom(mainRoomId: string): Promise<any> {
    return await this.apiCall(`/rooms/${mainRoomId}/breakout/close`, 'PUT');
  }

  /**
   * Leave a room
   */
  async leaveRoom(roomId: string, membershipId: string): Promise<any> {
    return await this.apiCall(`/rooms/${roomId}/members/${membershipId}`, 'DELETE');
  }

  /**
   * Switch to sub room
   */
  async switchToSubRoom(roomId: string, subRoomCode: string): Promise<any> {
    return await this.apiCall('/rooms/switch', 'POST', {
      room_id: roomId,
      sub_room_code: subRoomCode,
    });
  }

  /**
   * Get room members
   */
  async getRoomMembers(roomId: string): Promise<any> {
    return await this.apiCall(`/rooms/${roomId}/members`);
  }

  /**
   * Update room settings
   */
  async updateRoom(roomId: string, updates: RoomUpdateData): Promise<any> {
    return await this.apiCall(`/rooms/${roomId}`, 'PATCH', updates);
  }

  /**
   * Delete/Close room
   */
  async deleteRoom(roomId: string): Promise<any> {
    return await this.apiCall(`/rooms/${roomId}`, 'DELETE');
  }

  /**
   * Send a custom event to a room
   */
  async sendCustomEvent(request: CustomEventRequest): Promise<CustomEventResponse> {
    return await this.apiCall<CustomEventResponse>('/rooms/custom-event', 'POST', request);
  }

  /**
   * End an ongoing meeting room (requires service token)
   */
  async endRoom(request: EndRoomRequest): Promise<EndRoomResponse> {
    return await this.serviceApiCall<EndRoomResponse>('/rooms/end', 'PUT', request);
  }

  /**
   * Update participant permissions or metadata (requires service token)
   */
  async updateParticipant(request: UpdateParticipantRequest): Promise<UpdateParticipantResponse> {
    return await this.serviceApiCall<UpdateParticipantResponse>('/participants', 'PUT', request);
  }

  /**
   * List all participants in a room (requires service token)
   */
  async listParticipants(request: ListParticipantsRequest): Promise<ListParticipantsResponse> {
    return await this.serviceApiCall<ListParticipantsResponse>('/participants/list', 'POST', request);
  }

  /**
   * Remove a participant from a room by stream ID (requires service token)
   */
  async removeParticipant(streamId: string): Promise<RemoveParticipantResponse> {
    return await this.serviceApiCall<RemoveParticipantResponse>(`/participants/remove/${streamId}`, 'DELETE');
  }

  /**
   * Check the operational status of the meeting service
   * (No authentication required)
   */
  async healthCheck(): Promise<HealthCheckResponse> {
    try {
      const response = await fetch(`${this.apiBaseUrl}/health`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Health check failed:', error);
      throw error;
    }
  }
}

export default ApiClient;
