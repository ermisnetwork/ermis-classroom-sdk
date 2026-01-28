/**
 * ApiClient Types
 * Type definitions for ApiClient class
 */

import { SubRoomDefinition } from "../core/room.types";

/**
 * ApiClient configuration
 */
export interface ApiClientConfig {
  /** Server host */
  host?: string;
  /** API base URL */
  apiUrl?: string;
}

/**
 * Room creation response
 */
export interface CreateRoomResponse {
  /** Room ID */
  id: string;
  /** Room name */
  room_name: string;
  /** Room code for joining */
  room_code: string;
  /** Room type */
  room_type: string;
  /** Owner user ID */
  user_id: string;
  /** Creation timestamp */
  created_at?: string;
  /** Whether room is active */
  is_active?: boolean;
}

/**
 * List query parameters
 */
export interface ListQuery {
  /** Page number */
  page: number;
  /** Items per page */
  per_page: number;
  /** Sort field */
  sort_by: string;
  /** Sort order */
  sort_order: 'asc' | 'desc';
}

/**
 * List conditions
 */
export interface ListConditions {
  /** Filter by active status */
  is_active?: boolean;
  /** Filter by room type */
  room_type?: string;
  /** Additional filters */
  [key: string]: any;
}

/**
 * List rooms request
 */
export interface ListRoomsRequest {
  /** Query parameters */
  list_query: ListQuery;
  /** Filter conditions */
  conditions: ListConditions;
}

/**
 * List rooms response
 */
export interface ListRoomsResponse {
  /** Room data array */
  data: RoomData[];
  /** Total count */
  total?: number;
  /** Current page */
  page?: number;
  /** Per page count */
  per_page?: number;
}

/**
 * Room data from API
 */
export interface RoomData {
  /** Room ID */
  id: string;
  /** Room name */
  room_name: string;
  /** Room code */
  room_code: string;
  /** Room type */
  room_type: string;
  /** Owner user ID */
  user_id: string;
  /** Created timestamp */
  created_at?: string;
  /** Updated timestamp */
  updated_at?: string;
  /** Active status */
  is_active?: boolean;
}

/**
 * Room details response
 */
export interface RoomDetailsResponse {
  /** Room information */
  room: RoomData;
  /** Participants list */
  participants: ParticipantData[];
  /** Sub rooms list */
  sub_rooms: SubRoomData[];
}

/**
 * Participant data from API
 */
export interface ParticipantData {
  /** Participant ID */
  id: string;
  /** User ID */
  user_id: string;
  /** Stream ID */
  stream_id: string;
  /** Room ID */
  room_id: string;
  /** Role */
  role: string;
  /** Name */
  name?: string;
  /** Joined timestamp */
  joined_at?: string;
  /** Screen sharing status */
  is_screen_sharing?: boolean;
}

/**
 * Sub room data from API
 */
export interface SubRoomData {
  /** Sub room info */
  room: {
    /** Room ID */
    id: string;
    /** Room name */
    room_name: string;
    /** Room code */
    room_code?: string;
    /** Room type */
    room_type: string;
    /** Active status */
    is_active: boolean;
  };
  /** Participants in sub room */
  participants: ParticipantData[];
}

/**
 * Join room request
 */
export interface JoinRoomRequest {
  /** Room code */
  room_code: string;
  /** App name */
  app_name?: string;
  /** Parent room ID (for sub rooms) */
  parent_room_id?: string;
  /** Sub room ID */
  sub_room_id?: string;
  /** Replace existing session */
  replace?: boolean;
}

/**
 * Join room response
 */
export interface JoinRoomResponse {
  /** Membership ID */
  id: string;
  /** Room ID */
  room_id: string;
  /** Stream ID */
  stream_id: string;
  /** User ID */
  user_id: string;
  /** Role */
  role?: string;
  /** Joined timestamp */
  joined_at?: string;
}

/**
 * Connect room request
 */
export interface ConnectRoomRequest {
  /** Room code */
  room_code?: string;
}

/**
 * Connect room response
 */
export interface ConnectRoomResponse {
  /** Whether user is already in room */
  is_in_room: boolean;
}

/**
 * Create sub room request
 */
export interface CreateSubRoomRequest {
  /** Main room ID */
  main_room_id: string;
  /** List of rooms to create */
  rooms: SubRoomDefinition[];
}

/**
 * Sub room participant assignment
 */
export interface SubRoomParticipant {
  /** User ID */
  user_id: string;
  /** Stream ID */
  stream_id: string;
}

/**
 * Create sub room response
 */
export interface CreateSubRoomResponse {
  /** Created rooms */
  rooms: SubRoomData[];
}

/**
 * Join sub room request
 */
export interface JoinSubRoomRequest {
  /** App name */
  app_name?: string;
  /** Parent room ID */
  parent_room_id: string;
  /** Sub room ID */
  sub_room_id: string;
  /** Room code */
  room_code: string;
}

/**
 * Leave sub room request
 */
export interface LeaveSubRoomRequest {
  /** Parent room ID */
  parent_room_id: string;
  /** Sub room ID */
  sub_room_id: string;
}

/**
 * Room update data
 */
export interface RoomUpdateData {
  /** New room name */
  room_name?: string;
  /** New active status */
  is_active?: boolean;
  /** Additional update fields */
  [key: string]: any;
}

/**
 * Update participant response
 */
export interface UpdateParticipantResponse {
  /** Success status */
  success: boolean;
  /** Updated participant data */
  participant?: ParticipantData;
}

/**
 * List participants request
 */
export interface ListParticipantsRequest {
  /** Room ID */
  room_id: string;
  /** Query parameters */
  list_query?: ListQuery;
}

/**
 * List participants response
 */
export interface ListParticipantsResponse {
  /** Participants array */
  data: ParticipantData[];
  /** Total count */
  total?: number;
  /** Current page */
  page?: number;
  /** Per page count */
  per_page?: number;
}

/**
 * Remove participant request
 */
export interface RemoveParticipantRequest {
  /** Room ID */
  room_id: string;
  /** Stream ID of the participant to remove */
  stream_id: string;
  /** Optional reason for removal */
  reason?: string;
}

/**
 * Remove participant response
 * API returns 200 OK with no body
 */
export type RemoveParticipantResponse = void;

/**
 * Custom event response
 */
export interface CustomEventResponse {
  /** Success status */
  success: boolean;
  /** Message */
  message?: string;
}

/**
 * End room request
 */
export interface EndRoomRequest {
  /** Room ID to end */
  room_id: string;
  /** Reason for ending (optional) */
  reason?: string;
}

/**
 * End room response
 */
export interface EndRoomResponse {
  /** Success status */
  success: boolean;
  /** Message */
  message?: string;
}

/**
 * Health check response
 */
export interface HealthCheckResponse {
  /** Service status */
  status: 'healthy' | 'unhealthy' | 'degraded';
  /** Timestamp */
  timestamp?: string;
  /** Version info */
  version?: string;
  /** Additional details */
  details?: Record<string, any>;
}

/**
 * HTTP method types
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * API request options
 */
export interface ApiRequestOptions {
  /** HTTP method */
  method: HttpMethod;
  /** Request headers */
  headers: Record<string, string>;
  /** Request body (JSON) */
  body?: string;
}
