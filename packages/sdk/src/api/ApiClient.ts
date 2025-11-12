/**
 * ApiClient - HTTP client for Ermis Meeting API
 * Handles authentication and API requests
 */

import type {
  ApiClientConfig,
  TokenResponse,
  CreateRoomResponse,
  ListRoomsResponse,
  RoomDetailsResponse,
  JoinRoomResponse,
  CreateSubRoomRequest,
  CreateSubRoomResponse,
  JoinSubRoomRequest,
  LeaveSubRoomRequest,
  RoomUpdateData,
  HttpMethod,
} from '../types/api/apiClient.types';

export class ApiClient {
  private host: string;
  private apiBaseUrl: string;
  private jwtToken: string | null = null;
  private userId: string | null = null;

  constructor(config: ApiClientConfig = {}) {
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
    this.userId = null;
  }

  /**
   * Check if authenticated
   */
  isAuthenticated(): boolean {
    return !!(this.jwtToken && this.userId);
  }

  /**
   * Generic API call method
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

    const options: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${this.jwtToken}`,
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
   * Get dummy token for authentication
   */
  async getDummyToken(userId: string): Promise<TokenResponse> {
    const endpoint = '/get-token';
    const options: RequestInit = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sub: userId }),
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
   * Create a new room
   */
  async createRoom(roomName: string, roomType: string = 'main'): Promise<CreateRoomResponse> {
    return await this.apiCall<CreateRoomResponse>('/rooms', 'POST', {
      room_name: roomName,
      room_type: roomType,
    });
  }

  /**
   * List available rooms
   */
  async listRooms(page: number = 1, perPage: number = 20): Promise<ListRoomsResponse> {
    return await this.apiCall<ListRoomsResponse>('/rooms/list', 'POST', {
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
   * Close sub room
   */
  async closeSubRoom(mainRoomId: string): Promise<any> {
    return await this.apiCall(`/rooms/${mainRoomId}/breakout/close`, 'POST');
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
}

export default ApiClient;
