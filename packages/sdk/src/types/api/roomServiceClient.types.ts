import { ParticipantPermissions, ChannelName } from "../media/publisher.types";
import { RoomData, ParticipantData, SubRoomData } from "./apiClient.types";

export type ParticipantStatus = "connected" | "disconnected" | "idle" | "left";

export interface ParticipantResponse extends ParticipantData {
  is_hand_raised: boolean;
  has_mic: boolean;
  has_camera: boolean;
  is_mic_on: boolean;
  is_camera_on: boolean;
  is_pinned_for_everyone: boolean;
  status: ParticipantStatus;
  permissions: ParticipantPermissions;
  display_name?: string | null;
  left_at?: string | null;
  room_code?: string | null;
  sub_room_id?: string | null;
}

export interface RoomServiceSubRoomResponse {
  room: RoomData;
  participants: ParticipantResponse[];
}

export interface RoomServiceDetailResponse {
  room: RoomData;
  participants: ParticipantResponse[];
  sub_rooms?: RoomServiceSubRoomResponse[] | null;
}

export interface BreakoutParticipantReq {
  user_id: string;
  stream_id: string;
}

export interface BreakoutSubRoomReq {
  room_name: string;
  participants: BreakoutParticipantReq[];
}

export interface BreakoutRequest {
  main_room_id: string;
  rooms: BreakoutSubRoomReq[];
}

export interface BreakoutRoomResponse {
  rooms: RoomServiceSubRoomResponse[];
}

export type CustomTarget =
  | { type: "room" }
  | { type: "group"; ids: string[] };

export interface CustomEventPayload {
  sender_stream_id: string;
  target: CustomTarget;
  value: unknown;
}

export interface CustomEventRequest {
  room_id: string;
  event: CustomEventPayload;
}

export interface PaginatedParticipantResponse {
  data: ParticipantResponse[];
  page: number;
  per_page: number;
  total: number;
}

export interface PermissionChanged {
  can_subscribe?: boolean | null;
  can_publish?: boolean | null;
  can_publish_data?: boolean | null;
  can_publish_sources?: Array<[ChannelName, boolean]> | null;
  hidden?: boolean | null;
  can_update_metadata?: boolean | null;
}

export interface UpdateParticipantRequest {
  room_id: string;
  stream_id: string;
  permission_changed: PermissionChanged;
}

export interface GetServiceTokenRequest {
  issuer: string;
}

export interface GetUserTokenRequest {
  sub: string;
  permissions: ParticipantPermissions;
}

export interface GetTokenResponse {
  access_token: string;
}

