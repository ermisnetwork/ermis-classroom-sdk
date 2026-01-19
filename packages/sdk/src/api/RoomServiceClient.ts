import { signRoomServiceToken } from '../utils/signRoomServiceToken';
import {
  BreakoutRequest,
  BreakoutRoomResponse,
  CreateRoomResponse,
  CustomEventRequest,
  EndRoomRequest,
  EndRoomResponse,
  GetServiceTokenRequest,
  GetTokenResponse,
  GetUserTokenRequest,
  HttpMethod,
  JoinRoomRequest,
  ListConditions,
  ListQuery,
  PaginatedParticipantResponse,
  ParticipantPermissions,
  ParticipantResponse,
  PermissionChanged,
  RemoveParticipantRequest,
  RoomServiceDetailResponse,
  UpdateParticipantRequest,
} from '../types';

export class RoomServiceClient {
  private serviceToken: string = '';
  private apiHost: string;

  constructor(apiHost: string, serviceToken: string) {
    this.serviceToken = serviceToken;
    this.apiHost = apiHost.replace(/\/$/, '');
  }

  static async create(apiHost: string, privateKeyPem: string): Promise<RoomServiceClient> {
    const serviceToken = await signRoomServiceToken(privateKeyPem);
    return new RoomServiceClient(apiHost, serviceToken);
  }

  private async call<T>(method: HttpMethod, endpoint: string, body?: unknown): Promise<T> {
    const options: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${this.serviceToken}`,
        'Content-Type': 'application/json',
      },
    };
    if (body !== undefined) {
      options.body = JSON.stringify(body);
    }
    const response = await fetch(`${this.apiHost}${endpoint}`, options);
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }
    const text = await response.text();
    if (!text) return null as T;
    return JSON.parse(text) as T;
  }

  async getServiceToken(issuer: string): Promise<GetTokenResponse> {
    const req: GetServiceTokenRequest = { issuer };
    return this.call<GetTokenResponse>('POST', '/meeting/get-service-token', req);
  }

  async getUserToken(sub: string, permissions: ParticipantPermissions): Promise<GetTokenResponse> {
    const req: GetUserTokenRequest = { sub, permissions };
    return this.call<GetTokenResponse>('POST', '/meeting/get-user-token', req);
  }

  async createRoom(
    roomName: string,
    options?: { parentId?: string; roomType?: string },
  ): Promise<CreateRoomResponse> {
    return this.call<CreateRoomResponse>('POST', '/meeting/rooms', {
      room_name: roomName,
      parent_id: options?.parentId,
      room_type: options?.roomType,
    });
  }

  async listRooms(
    listQuery: ListQuery,
    conditions?: ListConditions,
  ): Promise<CreateRoomResponse[]> {
    return this.call<CreateRoomResponse[]>('POST', '/meeting/rooms/list', {
      list_query: listQuery,
      conditions,
    });
  }

  async getRoom(roomId: string): Promise<RoomServiceDetailResponse> {
    return this.call<RoomServiceDetailResponse>('GET', `/meeting/rooms/${roomId}`);
  }

  async joinRoom(request: JoinRoomRequest): Promise<ParticipantResponse> {
    return this.call<ParticipantResponse>('POST', '/meeting/rooms/join', request);
  }

  async createBreakoutRooms(request: BreakoutRequest): Promise<BreakoutRoomResponse | null> {
    return this.call<BreakoutRoomResponse | null>('POST', '/meeting/rooms/breakout', request);
  }

  async closeBreakoutRooms(mainRoomId: string): Promise<void> {
    await this.call<null>('PUT', `/meeting/rooms/${mainRoomId}/breakout/close`);
  }

  /**
   * End a meeting room
   * @param roomId - Room ID to end
   * @param reason - Optional reason for ending the meeting
   */
  async endRoom(roomId: string, reason?: string): Promise<EndRoomResponse> {
    const request: EndRoomRequest = {
      room_id: roomId,
    };

    if (reason) {
      request.reason = reason;
    }

    return this.call<EndRoomResponse>('PUT', '/meeting/rooms/end', request);
  }

  async sendCustomEvent(request: CustomEventRequest): Promise<void> {
    await this.call<null>('POST', '/meeting/rooms/custom-event', request);
  }

  async listParticipants(
    roomId: string,
    listQuery: ListQuery,
  ): Promise<PaginatedParticipantResponse> {
    return this.call<PaginatedParticipantResponse>('POST', '/meeting/participants/list', {
      room_id: roomId,
      list_query: listQuery,
    });
  }

  async updateParticipant(
    roomId: string,
    streamId: string,
    permissionChanged: PermissionChanged,
  ): Promise<UpdateParticipantRequest> {
    const req: UpdateParticipantRequest = {
      room_id: roomId,
      stream_id: streamId,
      permission_changed: permissionChanged,
    };
    return this.call<UpdateParticipantRequest>('PUT', '/meeting/participants', req);
  }

  /**
   * Remove a participant from a room
   * @param roomId - Room ID
   * @param streamId - Stream ID of the participant to remove
   * @param reason - Optional reason for removal
   */
  async removeParticipant(roomId: string, streamId: string, reason?: string): Promise<void> {
    const request: RemoveParticipantRequest = {
      room_id: roomId,
      stream_id: streamId,
    };

    if (reason) {
      request.reason = reason;
    }

    await this.call<null>('DELETE', '/meeting/participants/remove', request);
  }
}
