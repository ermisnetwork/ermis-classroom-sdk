/**
 * ApiClient Types
 * Type definitions for ApiClient class
 */

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
 * Token response from authentication
 */
export interface TokenResponse {
  /** Access token */
  access_token: string;
  /** Token type */
  token_type?: string;
  /** Expiration time in seconds */
  expires_in?: number;
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
 * Create sub room request
 */
export interface CreateSubRoomRequest {
  /** Main room ID */
  main_room_id: string;
  /** List of rooms to create */
  rooms: SubRoomDefinition[];
}

/**
 * Sub room definition
 */
export interface SubRoomDefinition {
  /** Room name */
  room_name: string;
  /** Participants to assign */
  participants: SubRoomParticipant[];
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
