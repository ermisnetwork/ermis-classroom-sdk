/**
 * VCR SDK Types
 * Based on VCR API Documentation v1.0.1
 */

// ============================================================================
// Common Types
// ============================================================================

export type RegistrantRole = 'student' | 'teacher' | 'admin';

export type SortOrder = 'asc' | 'desc';

// ============================================================================
// Pagination & Response Types
// ============================================================================

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: PaginationMeta;
  success: boolean;
  message?: string;
}

export interface ApiResponse<T> {
  data: T;
  success: boolean;
  message?: string;
}

export interface PaginationParams {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: SortOrder;
}


// ============================================================================
// Event Types
// ============================================================================

export interface EventSettings {
  maxParticipants?: number;
  waitingRoomEnabled?: boolean;
  recordingEnabled?: boolean;
  chatEnabled?: boolean;
  screenShareEnabled?: boolean;
  requirePermissionForMic?: boolean;
  requirePermissionForCamera?: boolean;
}

export interface CreateEventParams {
  title: string;
  description?: string;
  startTime: string; // ISO 8601 format
  endTime: string; // ISO 8601 format
  maxScore: number;
  isPublic?: boolean;
  tags?: string[];
  settings?: EventSettings;
  rewardIds?: string[]; // IDs of rewards to apply
}

export interface UpdateEventParams {
  title?: string;
  description?: string;
  startTime?: string;
  endTime?: string;
  maxScore?: number;
  isPublic?: boolean;
  tags?: string[];
  settings?: EventSettings;
  rewardIds?: string[];
}

export interface Event {
  _id: string;
  title: string;
  description?: string;
  startTime: string;
  endTime: string;
  maxScore: number;
  isPublic: boolean;
  tags?: string[];
  settings?: EventSettings;
  joinLink: string;
  ermisRoomCode: string;
  createdByApiKey: string; // ID of the API Key that created this event
  rewardIds?: string[];
  createdAt?: string;
  updatedAt?: string;
}

// ============================================================================
// Registrant Types
// ============================================================================

export interface CreateRegistrantParams {
  firstName: string;
  lastName: string;
  email: string;
  authId: string; // ID học viên từ hệ thống của bạn
  role: RegistrantRole;
}

export interface UpdateRegistrantParams {
  firstName?: string;
  lastName?: string;
  email?: string;
  authId?: string;
  role?: RegistrantRole;
}

export interface Registrant {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
  authId: string;
  role: RegistrantRole;
  personalJoinLink: string; // Link tham gia riêng với token
  createdAt?: string;
  updatedAt?: string;
}

export interface ListRegistrantsParams extends PaginationParams {
  role?: RegistrantRole;
}

// ============================================================================
// Reward Types
// ============================================================================

export interface CreateRewardParams {
  file: File; // Image file (Required)
  name: string;
  description?: string;
}

export interface UpdateRewardParams {
  name?: string;
  description?: string;
  file?: File; // Optional: new image file
}

export interface Reward {
  _id: string;
  name: string;
  description?: string;
  image: string; // URL to the reward image
  createdByApiKey: string; // ID of the API Key that created this reward
  createdAt?: string;
  updatedAt?: string;
}

// ============================================================================
// Rating Types (Read Only)
// ============================================================================

export interface Rating {
  rating: number; // 1-5 stars typically
  comment?: string;
  createdAt: string;
}

export interface RatingList {
  averageRating: number;
  totalRatings: number;
  ratings: Rating[];
}

