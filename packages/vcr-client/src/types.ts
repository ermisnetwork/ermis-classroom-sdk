/**
 * VCR SDK Types
 * Based on VCR API Documentation v1.0.1
 * Updated to match VCR API Backend Schemas
 */

// ============================================================================
// Common Types
// ============================================================================

export type RegistrantRole = 'admin' | 'staff' | 'teacher' | 'student' | 'parent';

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
  earlyJoinMinutes?: number;
  recordingEnabled?: boolean;
  chatEnabled?: boolean;
  screenShareEnabled?: boolean;
  allowBreakoutRooms?: boolean;
  micDefaultState?: boolean;
  cameraDefaultState?: boolean;
  // Permission defaults
  blockAllStudentCamera?: boolean;
  blockAllStudentMic?: boolean;
  blockAllStudentScreenShare?: boolean;
  blockAllStudentChat?: boolean;
  requirePermissionForCamera?: boolean;
  requirePermissionForMic?: boolean;
  requirePermissionForScreenShare?: boolean;
}

export interface CreateEventParams {
  title: string;
  description?: string;
  startTime: string; // ISO 8601 format
  endTime: string; // ISO 8601 format
  isPublic?: boolean;
  location?: string;
  tags?: string[];
  settings?: EventSettings;
  rewardIds?: string[]; // IDs of rewards to apply
}

export interface UpdateEventParams {
  title?: string;
  description?: string;
  startTime?: string;
  endTime?: string;
  isPublic?: boolean;
  location?: string;
  tags?: string[];
  settings?: EventSettings;
  rewardIds?: string[];
}

export interface Event {
  _id: string;
  title: string;
  description?: string;
  startTime: string; // ISO 8601 (Date)
  endTime: string; // ISO 8601 (Date)
  maxScore: number;
  isPublic: boolean;
  location?: string;
  tags?: string[];
  settings?: EventSettings;
  joinLink?: string;
  qrCode?: string;
  ermisRoomId?: string;
  ermisRoomCode?: string;
  ermisRoomName?: string;
  ermisRoomStatus?: string;
  ermisChatChannelId?: string;
  organizerId: string;
  createdByApiKey?: string;
  rewards?: string[] | any[]; // Depends on population
  createdAt?: string;
  updatedAt?: string;
}

export interface ListEventsParams extends PaginationParams {
  // Additional filters can be added here if needed
}

export interface ParticipantStats {
  total: number;
  present: number;
  absent: number;
  late: number;
  excused: number;
  byRole?: Record<RegistrantRole, number>;
}

// ============================================================================
// Registrant Types
// ============================================================================

export interface CreateRegistrantParams {
  firstName: string;
  lastName: string;
  email?: string;
  authId: string; // ID học viên từ hệ thống của bạn
  role: RegistrantRole;
}

export interface UpdateRegistrantParams {
  firstName?: string;
  lastName?: string;
  email?: string;
  authId?: string;
  role?: RegistrantRole;
  status?: 'active' | 'cancelled';
}

export interface Registrant {
  _id: string;
  eventId: string;
  firstName: string;
  lastName: string;
  email?: string;
  authId: string;
  role: RegistrantRole;
  joinCode: string;
  status: 'active' | 'cancelled';
  type: 'user' | 'external';

  personalJoinLink?: string;
  personalQRCode?: string;

  registrationNote?: string;
  approvalNote?: string;
  linkedUserId?: string;
  externalAppId?: string;
  externalRegistrantId?: string;

  approvedBy?: string;
  approvedAt?: string;
  rejectedAt?: string;

  attendanceStatus?: 'present' | 'absent' | 'late' | 'excused';

  chatBlocked?: boolean;
  chatBlockedBy?: string;
  chatBlockedAt?: string;
  chatBlockReason?: string;
  feedback?: string;

  // Ban fields
  isBanned?: boolean;
  bannedAt?: string; // ISO 8601 (Date)
  bannedBy?: string; // User ID who banned
  banReason?: string;

  createdAt?: string;
  updatedAt?: string;
}

export interface ListRegistrantsParams extends PaginationParams {
  role?: RegistrantRole;
  status?: 'active' | 'cancelled';
  type?: 'user' | 'external';
}

export interface BulkCreateRegistrantsParams {
  registrants: CreateRegistrantParams[];
}

export interface BulkCreateRegistrantsResult {
  created: number;
  failed: number;
  errors: string[];
  createdRegistrants: Registrant[];
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
  isActive?: boolean;
}

export interface Reward {
  _id: string;
  name: string;
  description?: string;
  image: string; // URL to the reward image
  isActive: boolean;
  createdBy: string;
  createdByApiKey?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ListRewardsParams extends PaginationParams {
  // Additional filters can be added here if needed
}

// ============================================================================
// Rating Types
// ============================================================================

export interface CreateRatingParams {
  callQuality: number;
  classQuality: number;
  teacher: number;
  otherThoughts?: string;
}

export interface Rating {
  _id: string;
  eventId: string;
  registrantId: string;
  registrantAuthId: string;
  callQuality: number;
  classQuality: number;
  classQualityRating?: number; // legacy/alias if needed
  teacher: number;
  otherThoughts?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RatingList {
  averageCallQuality: number;
  averageClassQuality: number;
  averageTeacher: number;
  totalRatings: number;
  ratings: Rating[];
}

// ============================================================================
// Event Document Types
// ============================================================================

export interface EventDocument {
  _id: string;
  eventId: string;
  title: string;
  description?: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  s3Key: string;
  isActive: boolean;
  displayOrder: number;
  uploadedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface UploadDocumentOptions {
  /** File object (browser) or Buffer (Node.js) */
  file: File | Blob;
  /** Document title (required) */
  title: string;
  /** Document description (optional) */
  description?: string;
  /** Active status (optional, default: true) */
  isActive?: boolean;
  /** Display order (optional) */
  displayOrder?: number;
}

export interface UpdateDocumentParams {
  /** New title (optional) */
  title?: string;
  /** New description (optional) */
  description?: string;
  /** Active status (optional) */
  isActive?: boolean;
  /** Display order (optional) */
  displayOrder?: number;
}

export interface ListDocumentsOptions {
  /** Include inactive documents (default: false) */
  includeInactive?: boolean;
}

export interface DocumentListResponse {
  documents: EventDocument[];
  total: number;
}

export interface DocumentReorderItem {
  documentId: string;
  displayOrder: number;
}

export interface ProgressEvent {
  loaded: number;
  total: number;
}

