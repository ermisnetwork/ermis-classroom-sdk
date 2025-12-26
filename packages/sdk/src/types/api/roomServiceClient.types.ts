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
/**
 * demo object:
 * ban mic: {
 *  can_publish_sources: [["mic_48k", false]],
 * }
 * ban camera: {
 *  can_publish_sources: [["video_360p", false], ["video_720p", false]],
 * }
 * cho phép camera và mic: {
 *  can_publish_sources: [["video_360p", true], ["video_720p", true], ["mic_48k", true]],
 * }
 * ban mic + camera: {
 *  can_publish_sources: [["video_360p", false], ["video_720p", false], ["mic_48k", false]],
 * }
 */
export interface PermissionChanged {
  can_subscribe?: boolean | null;// có thể xem hay không
  can_publish?: boolean | null;// có thể bắn data (mic, camera, event)
  can_publish_data?: boolean | null; // có thể bắn data (mic or camera)
  can_publish_sources?: Array<[ChannelName, boolean]> | null; // mic: channelName: mic_48k, camera: channelName: video_360p/video_720p, screen_share: channelName: screen_share_720p/screen_share_1080p/screen_share_audio
  hidden?: boolean | null;// bố mày chưa dùng
  can_update_metadata?: boolean | null;// bố mày chưa dùng
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

