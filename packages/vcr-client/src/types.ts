/**
 * VCR SDK Types
 * Based on VCR API Documentation v1.0.1
 * Updated to match VCR API Backend Schemas (2026-02-27)
 */

// ============================================================================
// Common Types
// ============================================================================

export type RegistrantRole = 'admin' | 'teacher' | 'teaching_assistant' | 'student';

export type AttendanceStatus = 'present' | 'absent' | 'late' | 'excused';

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
    settings: EventSettings;
    rewardIds?: string[]; // IDs of rewards to apply
}

export interface UpdateEventParams {
    title?: string;
    description?: string;
    startTime?: string;
    endTime?: string;
    isPublic?: boolean;
    settings?: EventSettings;
    rewardIds?: string[];
}

export interface BreakoutRoom {
    id: string;
    name: string;
    participants: string[];
    isActive: boolean;
}

export interface BreakoutRoomsConfig {
    enabled: boolean;
    autoAssign: boolean;
    maxRooms: number;
    participantsPerRoom: number;
    rooms: BreakoutRoom[];
}

export interface EventStream {
    registrantId: string;
    streamId: string;
    streamRoomId: string;
    shortCode: string;
}

export interface Event {
    _id: string;
    title: string;
    description?: string;
    startTime: string; // ISO 8601 (Date)
    endTime: string; // ISO 8601 (Date)
    isPublic: boolean;
    publicCode?: string;
    settings?: EventSettings;
    qrCode?: string;
    breakoutRooms?: BreakoutRoomsConfig;
    ermisRoomId?: string;
    ermisRoomCode?: string;
    ermisRoomName?: string;
    ermisRoomStatus?: string;
    ermisChatChannelId?: string;
    activeWhiteboardSessionId?: string;
    pinnedParticipantAuthId?: string;
    organizerId: string;
    rewards?: string[] | any[]; // Depends on population
    streams?: EventStream[];
    createdAt?: string;
    updatedAt?: string;
}

export interface ListEventsParams extends PaginationParams {
    organizerId?: string;
    templateId?: string;
    startDateFrom?: string; // ISO 8601
    startDateTo?: string; // ISO 8601
}

export interface ParticipantStats {
    registered: number;
    approved: number;
    attended: number;
}

// ============================================================================
// Registrant Types
// ============================================================================

/** Blocking state for a single permission type */
export interface PermissionBlockState {
    blocked: boolean;
    blockedAt: string | null;
}

/** Structured event settings for a registrant (per-participant permissions) */
export interface RegistrantEventSettings {
    chat: PermissionBlockState;
    mic: PermissionBlockState;
    camera: PermissionBlockState;
    share: PermissionBlockState;
    drawing: PermissionBlockState;
}

/** Reward given to a registrant */
export interface RegistrantReward {
    rewardId: string;
    givenBy: string;
    givenAt: string; // ISO 8601
}

export interface CreateRegistrantParams {
    fullName: string;
    email?: string;
    authId: string; // ID học viên từ hệ thống của bạn
    role: RegistrantRole;
}

export interface UpdateRegistrantParams {
    fullName?: string;
    email?: string;
    authId?: string;
    role?: RegistrantRole;
    status?: 'active' | 'cancelled';
}

export interface Registrant {
    _id: string;
    eventId: string;
    fullName: string;
    email?: string;
    authId: string;
    role: RegistrantRole;
    joinCode: string;
    status: 'active' | 'cancelled';

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

    attendanceStatus?: AttendanceStatus;

    /** Structured per-participant permission settings */
    eventSettings?: RegistrantEventSettings;

    /** Rewards given to this participant */
    rewards?: RegistrantReward[];

    feedback?: string;

    // Ban fields
    isBanned?: boolean;
    bannedAt?: string; // ISO 8601 (Date)
    bannedBy?: string; // User ID who banned
    banReason?: string;

    // First join tracking
    isFirstJoin?: boolean;
    firstJoinedAt?: string; // ISO 8601

    // Kick fields
    kickedUntil?: string; // ISO 8601 - temp kick timeout
    lastKickedAt?: string; // ISO 8601
    lastKickedBy?: string;
    lastKickReason?: string;

    createdAt?: string;
    updatedAt?: string;
}

export interface ListRegistrantsParams extends PaginationParams {
    role?: RegistrantRole;
    status?: 'active' | 'cancelled';
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
    createdAt?: string;
    updatedAt?: string;
}

export interface ListRewardsParams extends PaginationParams {
    isActive?: boolean;
}

// ============================================================================
// Rating Types
// ============================================================================

export interface CreateRatingParams {
    callQuality: number;
    classQuality: number;
    teacher?: number; // Optional in backend
    otherThoughts?: string;
}

export interface Rating {
    _id: string;
    eventId: string;
    registrantId: string;
    registrantAuthId: string;
    callQuality: number;
    classQuality: number;
    teacher?: number;
    otherThoughts?: string;
    createdAt: string;
    updatedAt: string;
}

export interface RatingSummary {
    avgCallQuality: number;
    avgClassQuality: number;
    avgTeacher: number;
    totalRatings: number;
}

export interface RatingList {
    summary: RatingSummary;
    ratings: Rating[];
}

// ============================================================================
// Event Document Types
// ============================================================================

/**
 * Document type categories
 */
export enum DocumentType {
    PDF = 'pdf',
    DOC = 'doc',
    DOCX = 'docx',
    XLS = 'xls',
    XLSX = 'xlsx',
    PPT = 'ppt',
    PPTX = 'pptx',
    IMAGE = 'image',
    VIDEO = 'video',
    AUDIO = 'audio',
    OTHER = 'other'
}

/**
 * Event Document response object
 */
export interface EventDocument {
    /** Unique document ID */
    _id: string;

    /** Event ID that this document belongs to */
    eventId: string;

    /** Document title/name */
    title: string;

    /** Document description (optional) */
    description?: string;

    /** Original file name */
    originalFileName: string;

    /** File size in bytes */
    fileSize: number;

    /** MIME type of the file */
    mimeType: string;

    /** Document type category */
    documentType: DocumentType;

    /** Whether the document is active/visible */
    isActive: boolean;

    /** Temporary signed download URL (valid for 24 hours) */
    downloadUrl?: string;

    /** Created at timestamp */
    createdAt: string;

    /** Updated at timestamp */
    updatedAt: string;
}

/**
 * Upload document request
 */
export interface UploadDocumentOptions {
    /** Document title (required) */
    title: string;

    /** Document description */
    description?: string;

    /** Whether the document is active/visible (default: true) */
    isActive?: boolean;

    /** File to upload (File, Blob, or Buffer) */
    file: File | Blob;
}

/**
 * Update document request
 */
export interface UpdateDocumentParams {
    /** New document title */
    title?: string;

    /** New document description */
    description?: string;

    /** Active/visible status */
    isActive?: boolean;
}

/**
 * Query parameters for listing documents
 */
export interface ListDocumentsOptions {
    /** Page number (1-indexed, default: 1) */
    page?: number;

    /** Number of items per page (default: 10) */
    limit?: number;

    /** Include inactive documents (default: false) */
    includeInactive?: boolean;
}

/**
 * Document list response with pagination
 */
export interface DocumentListResponse {
    /** Success message */
    message: string;

    /** Array of documents */
    data: EventDocument[];

    /** Pagination metadata */
    meta: {
        /** Total count of documents */
        total: number;

        /** Current page number (1-indexed) */
        page: number;

        /** Number of items per page */
        limit: number;

        /** Total number of pages */
        totalPages: number;

        /** Whether there is a next page */
        hasNextPage: boolean;

        /** Whether there is a previous page */
        hasPrevPage: boolean;
    };
}

export interface ProgressEvent {
    loaded: number;
    total: number;
}
