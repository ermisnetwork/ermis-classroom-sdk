/**
 * Permissions API
 * Manages student permissions in the classroom (quản lý quyền học sinh)
 */

import type { VCRHTTPClient } from '../client';
import type {
  BlockPermissionParams,
  UnblockPermissionParams,
  UpdateRoomSettingsParams,
  PermissionBlockData,
  PermissionUnblockData,
  PermissionHistoryResponse,
  ApiResponse,
} from '../types';

export class PermissionsResource {
  constructor(private client: VCRHTTPClient) {}

  /**
   * Block a student's permission
   * Chặn quyền của học sinh (camera, mic, screen share, chat, drawing)
   * @param eventId Event ID
   * @param params Block permission parameters
   * @returns Permission block data
   */
  async blockPermission(
    eventId: string,
    params: BlockPermissionParams
  ): Promise<PermissionBlockData> {
    const response = await this.client.post<ApiResponse<PermissionBlockData>>(
      `/events/${eventId}/permissions/block`,
      params
    );
    return response.data;
  }

  /**
   * Unblock a student's permission
   * Bỏ chặn quyền đã bị block trước đó
   * @param eventId Event ID
   * @param params Unblock permission parameters
   * @returns Permission unblock data
   */
  async unblockPermission(
    eventId: string,
    params: UnblockPermissionParams
  ): Promise<PermissionUnblockData> {
    const response = await this.client.post<ApiResponse<PermissionUnblockData>>(
      `/events/${eventId}/permissions/unblock`,
      params
    );
    return response.data;
  }

  /**
   * Update room settings (permissions for entire class)
   * Cập nhật cài đặt quyền cho toàn bộ lớp học
   * @param eventId Event ID
   * @param params Room settings parameters
   * @returns Updated event settings
   */
  async updateRoomSettings(
    eventId: string,
    params: UpdateRoomSettingsParams
  ): Promise<void> {
    await this.client.patch(`/events/${eventId}/permissions/room-settings`, params);
  }

  /**
   * Get permission history for an event
   * Lấy lịch sử quyền của event
   * @param eventId Event ID
   * @returns Permission history
   */
  async getHistory(eventId: string): Promise<PermissionHistoryResponse> {
    return this.client.get<PermissionHistoryResponse>(
      `/events/${eventId}/permissions/history`
    );
  }
}
