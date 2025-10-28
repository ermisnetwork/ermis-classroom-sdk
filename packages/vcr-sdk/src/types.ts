/**
 * VCR SDK Types
 * Generated from OpenAPI specification
 */

// ============================================================================
// Common Types
// ============================================================================

export type UserRole =
  | 'super_admin'
  | 'admin'
  | 'academic_officer'
  | 'teacher'
  | 'teaching_assistant'
  | 'student'
  | 'guardian';

export type SortOrder = 'asc' | 'desc';

export type EventTemplateType = 'JSU' | 'JRQ' | 'workshop' | 'seminar' | 'exam' | 'conference' | 'defense';

export type TemplateStatus = 'active' | 'inactive';

export type RegistrantRole = 'admin' | 'staff' | 'teacher' | 'student' | 'parent';

export type RegistrantStatus = 'active' | 'cancelled';

export type AttendanceStatus = 'present' | 'absent' | 'late' | 'excused';

export type ScoreGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export type ScoreStatus = 'draft' | 'published' | 'under_review';

export type ReviewDecision = 'pending' | 'approved' | 'rejected';

export type ExportFormat = 'csv' | 'json' | 'xlsx';

export type EventLogAction =
  | 'event_created'
  | 'event_updated'
  | 'event_started'
  | 'event_ended'
  | 'event_cancelled'
  | 'participant_joined'
  | 'participant_left'
  | 'participant_reconnected'
  | 'registration_created'
  | 'registration_approved'
  | 'registration_rejected'
  | 'breakout_room_created'
  | 'breakout_room_deleted'
  | 'participant_moved_to_breakout'
  | 'participant_returned_from_breakout'
  | 'attendance_recorded'
  | 'attendance_updated'
  | 'violation_detected'
  | 'violation_reported'
  | 'violation_updated'
  | 'exam_lock_activated'
  | 'exam_lock_violated'
  | 'score_assigned'
  | 'score_updated'
  | 'score_published'
  | 'score_review_requested'
  | 'score_review_processed'
  | 'settings_updated'
  | 'chat_enabled'
  | 'chat_disabled'
  | 'recording_started'
  | 'recording_stopped';

export type EventLogCategory =
  | 'event_lifecycle'
  | 'participant_activity'
  | 'registration'
  | 'attendance'
  | 'scoring'
  | 'security'
  | 'system'
  | 'integration';

export type EventLogLevel = 'info' | 'warn' | 'error' | 'debug';

export type CustomFieldType = 'text' | 'email' | 'select' | 'textarea';

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
  message: string;
}

export interface ApiResponse<T> {
  data: T;
  success: boolean;
  message: string;
}

export interface PaginationParams {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: SortOrder;
}

// ============================================================================
// Authentication Types
// ============================================================================

export interface RegisterDto {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

export interface LoginDto {
  email: string;
  password: string;
}

export interface RefreshTokenDto {
  refreshToken: string;
}

export interface AuthResponseDto {
  accessToken: string;
  refreshToken: string;
  user: object;
}

// ============================================================================
// API Key Types
// ============================================================================

export interface ApiKeyPermissionsDto {
  events: string[];
  actions: string[];
}

export interface ApiKeyRateLimitDto {
  requestsPerMinute: number;
  requestsPerHour: number;
}

export interface CreateApiKeyDto {
  name: string;
  permissions: ApiKeyPermissionsDto;
  allowedOrigins?: string[];
  expiresAt?: string;
  rateLimit?: ApiKeyRateLimitDto;
}

export interface UpdateApiKeyDto {
  name?: string;
  permissions?: ApiKeyPermissionsDto;
  allowedOrigins?: string[];
  expiresAt?: string;
  rateLimit?: ApiKeyRateLimitDto;
  isActive?: boolean;
}

export interface ApiKeyResponseDto {
  id: string;
  name: string;
  keyId: string;
  permissions: ApiKeyPermissionsDto;
  allowedOrigins?: string[];
  expiresAt?: string;
  rateLimit?: ApiKeyRateLimitDto;
  isActive: boolean;
  lastUsedAt?: string;
  usage?: object;
  createdAt: string;
  updatedAt: string;
}

export interface CreateApiKeyResponseDto {
  apiKey: ApiKeyResponseDto;
  plainSecret: string;
}

export interface ListApiKeysParams extends PaginationParams {
  isActive?: boolean;
}

// ============================================================================
// User Types
// ============================================================================

export interface UpdateUserDto {
  firstName?: string;
  lastName?: string;
  role?: UserRole;
  isActive?: boolean;
}

export interface UpdateUserRoleDto {
  role: UserRole;
}

export interface ListUsersParams extends PaginationParams {
  roles?: UserRole[];
}

// ============================================================================
// Event Types
// ============================================================================

export interface EventSettingsDto {
  maxParticipants?: number;
  password?: string;
  waitingRoomEnabled?: boolean;
  examLockEnabled?: boolean;
  recordingEnabled?: boolean;
  chatEnabled?: boolean;
  screenShareEnabled?: boolean;
  allowBreakoutRooms?: boolean;
  micDefaultState?: boolean;
  cameraDefaultState?: boolean;
}

export interface CustomField {
  name: string;
  label: string;
  required: boolean;
  type: CustomFieldType;
  options?: string[];
}

export interface RegistrationSettingsDto {
  allowSelfRegistration?: boolean;
  requireApproval?: boolean;
  maxParticipants?: number;
  registrationDeadline?: string;
  allowExternalRegistrants?: boolean;
  customFields?: CustomField[];
}

export interface CreateEventDto {
  title: string;
  description?: string;
  templateId?: string;
  startTime: string;
  endTime?: string;
  settings?: EventSettingsDto;
  registrationSettings?: RegistrationSettingsDto;
  isPublic?: boolean;
  location?: string;
  tags?: string[];
  maxScore?: number;
}

export interface UpdateEventDto {
  title?: string;
  description?: string;
  templateId?: string;
  startTime?: string;
  endTime?: string;
  settings?: EventSettingsDto;
  registrationSettings?: RegistrationSettingsDto;
  isPublic?: boolean;
  location?: string;
  tags?: string[];
  maxScore?: number;
}

export interface EventResponseDto {
  _id: string;
  title: string;
  description?: string;
  templateId: string;
  startTime: string;
  endTime: string;
  organizerId: string;
  settings: EventSettingsDto;
  invitedEmails?: string[];
  registrationSettings?: RegistrationSettingsDto;
  joinLink: string;
  qrCode?: string;
  isPublic: boolean;
  location?: string;
  tags?: string[];
  maxScore: number;
  createdAt: string;
  updatedAt: string;
}

export interface ListEventsParams extends PaginationParams {
  organizerId?: string;
  templateId?: string;
  startDateFrom?: string;
  startDateTo?: string;
  tags?: string[];
}

// ============================================================================
// Registrant Types
// ============================================================================

export interface CreateRegistrantDto {
  firstName: string;
  lastName: string;
  email?: string;
  authId: string;
  role: RegistrantRole;
}

export interface UpdateRegistrantDto {
  firstName?: string;
  lastName?: string;
  email?: string;
  authId?: string;
  role?: RegistrantRole;
  status?: RegistrantStatus;
}

export interface JoinWithCodeDto {
  joinCode: string;
}

export interface MockRegistrantsDto {
  count: number;
  role?: RegistrantRole;
}

export interface ListRegistrantsParams extends PaginationParams {
  status?: RegistrantStatus;
  role?: RegistrantRole;
}

// ============================================================================
// Breakout Room Types
// ============================================================================

export interface CreateAutoBreakoutRoomsDto {
  numberOfRooms: number;
}

export interface GetBreakoutRoomTokenDto {
  roomName: string;
}

export interface BreakoutRoomTokenResponseDto {
  livekitToken: string;
  livekitUrl: string;
  roomName: string;
}

// ============================================================================
// Attendance Types
// ============================================================================

export interface UpdateAttendanceStatusDto {
  attendanceStatus: AttendanceStatus;
}

// ============================================================================
// Participant Types
// ============================================================================

export interface UpdateParticipantPermissionsDto {
  participantAuthId: string;
  canPublishMic?: boolean;
  canPublishCamera?: boolean;
  canPublishScreenShare?: boolean;
}

export interface PinParticipantDto {
  participantAuthId: string;
}

// ============================================================================
// Event Material Types
// ============================================================================

export interface EventMaterialResponseDto {
  id: string;
  eventId: string;
  title: string;
  description?: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  uploaderName: string;
  uploadedAt: string;
  fileUrl?: string;
}

// ============================================================================
// Event Submission Types
// ============================================================================

export interface EventSubmissionResponseDto {
  id: string;
  eventId: string;
  title: string;
  description?: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  submitterName: string;
  submitterRole: string;
  submittedAt: string;
  fileUrl?: string;
}

// ============================================================================
// Event Template Types
// ============================================================================

export interface CreateEventTemplateDto {
  name: string;
  description?: string;
  type: EventTemplateType;
  settings?: EventSettingsDto;
  status?: TemplateStatus;
}

export interface UpdateEventTemplateDto {
  name?: string;
  description?: string;
  type?: EventTemplateType;
  settings?: EventSettingsDto;
  status?: TemplateStatus;
}

export interface EventTemplateResponseDto {
  _id: string;
  name: string;
  description?: string;
  type: EventTemplateType;
  settings?: EventSettingsDto;
  status: TemplateStatus;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// Score Types
// ============================================================================

export interface CreateScoreDto {
  eventId: string;
  participantId: string;
  score: number;
  grade?: ScoreGrade;
  feedback?: string;
}

export interface BulkScoreItemDto {
  participantId: string;
  score: number;
  grade?: ScoreGrade;
  feedback?: string;
}

export interface BulkCreateScoresDto {
  eventId: string;
  scores: BulkScoreItemDto[];
}

export interface UpdateScoreDto {
  score?: number;
  grade?: ScoreGrade;
  feedback?: string;
  status?: ScoreStatus;
}

export interface PublishScoresDto {
  eventId: string;
  scoreIds?: string[];
  sendNotification?: boolean;
}

export interface ReviewScoreDto {
  reason: string;
  details?: string;
}

export interface ProcessReviewDto {
  decision: ReviewDecision;
  newScore?: number;
  response: string;
}

export interface ScoreResponseDto {
  _id: string;
  eventId: string;
  participantId: string;
  score: number;
  grade?: ScoreGrade;
  feedback?: string;
  status: ScoreStatus;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// Event Log Types
// ============================================================================

export interface ListEventLogsParams extends PaginationParams {
  eventId?: string;
  actorId?: string;
  targetId?: string;
  action?: EventLogAction;
  actions?: EventLogAction[];
  category?: EventLogCategory;
  level?: EventLogLevel;
  fromDate?: string;
  toDate?: string;
  ipAddress?: string;
  sessionId?: string;
  includeMetadata?: boolean;
}

export interface EventLogStatsParams {
  periodDays?: number;
  groupBy?: 'hour' | 'day' | 'week' | 'month';
}

export interface ExportEventLogsParams {
  eventId?: string;
  format?: ExportFormat;
  fromDate?: string;
  toDate?: string;
  includeMetadata?: boolean;
  actions?: EventLogAction[];
}

