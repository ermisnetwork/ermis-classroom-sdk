/**
 * Users API
 */

import type { VCRClient } from '../client';
import type {
  UpdateUserDto,
  UpdateUserRoleDto,
  ListUsersParams,
  PaginatedResponse,
  ApiResponse,
} from '../types';

export class UsersAPI {
  constructor(private client: VCRClient) {}

  /**
   * Get all users with pagination
   */
  async list(params?: ListUsersParams): Promise<PaginatedResponse<any>> {
    return this.client.get<PaginatedResponse<any>>('/users', params);
  }

  /**
   * Get current user profile
   */
  async getProfile(): Promise<ApiResponse<any>> {
    return this.client.get<ApiResponse<any>>('/users/profile');
  }

  /**
   * Update current user profile
   */
  async updateProfile(data: UpdateUserDto): Promise<ApiResponse<any>> {
    return this.client.patch<ApiResponse<any>>('/users/profile', data);
  }

  /**
   * Get user by ID
   */
  async get(id: string): Promise<ApiResponse<any>> {
    return this.client.get<ApiResponse<any>>(`/users/${id}`);
  }

  /**
   * Update user by ID
   */
  async update(id: string, data: UpdateUserDto): Promise<ApiResponse<any>> {
    return this.client.patch<ApiResponse<any>>(`/users/${id}`, data);
  }

  /**
   * Delete user by ID
   */
  async delete(id: string): Promise<ApiResponse<any>> {
    return this.client.delete<ApiResponse<any>>(`/users/${id}`);
  }

  /**
   * Update user role by ID
   */
  async updateRole(id: string, data: UpdateUserRoleDto): Promise<ApiResponse<any>> {
    return this.client.patch<ApiResponse<any>>(`/users/${id}/roles`, data);
  }
}

