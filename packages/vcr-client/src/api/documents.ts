/**
 * Event Documents API
 * Manages documents attached to events.
 * Supports: Upload, List, Get, Update, Delete
 * 
 * @version 1.1.0
 * - Removed `reorder` endpoint and `order` field
 * - Signed download URL now included in `getById` response
 * - Removed separate `download` endpoint
 */

import type { VCRHTTPClient } from '../client';
import type {
    EventDocument,
    UploadDocumentOptions,
    UpdateDocumentParams,
    ListDocumentsOptions,
    DocumentListResponse,
    ApiResponse,
} from '../types';

export class DocumentsResource {
    constructor(private client: VCRHTTPClient) { }

    /**
     * Upload a document to an event
     * @param eventId Event ID
     * @param options Upload options including file, title, description
     * @param onProgress Optional progress callback for upload progress tracking
     * @returns Created document
     * 
     * @example
     * ```typescript
     * // Browser
     * const fileInput = document.querySelector('input[type="file"]');
     * const file = fileInput.files[0];
     * 
     * const document = await client.documents.upload(
     *   eventId,
     *   {
     *     file,
     *     title: 'Lecture Notes',
     *     description: 'Week 1 materials'
     *   },
     *   (progress) => {
     *     const percent = (progress.loaded / progress.total) * 100;
     *     console.log(`Upload progress: ${percent}%`);
     *   }
     * );
     * ```
     */
    async upload(
        eventId: string,
        options: UploadDocumentOptions,
        // Note: onProgress is currently not used as the underlying HTTP client
        // doesn't support progress tracking with native fetch.
        // This is kept for API compatibility and future implementation.
        _onProgress?: (progress: { loaded: number; total: number }) => void
    ): Promise<EventDocument> {
        const formData = new FormData();
        formData.append('file', options.file);
        formData.append('title', options.title);

        if (options.description !== undefined) {
            formData.append('description', options.description);
        }
        if (options.isActive !== undefined) {
            formData.append('isActive', String(options.isActive));
        }

        const response = await this.client.postFormData<ApiResponse<EventDocument>>(
            `/events/${eventId}/documents`,
            formData
        );
        return response.data;
    }

    /**
     * Get paginated list of documents for an event
     * @param eventId Event ID
     * @param options Query options (page, limit, includeInactive)
     * @returns Document list response with data, message, and meta
     * 
     * @example
     * ```typescript
     * // Get first page with 10 items
     * const response = await client.documents.list(eventId, {
     *   page: 1,
     *   limit: 10
     * });
     * 
     * console.log('Message:', response.message);
     * console.log('Documents:', response.data);
     * console.log('Total:', response.meta.total);
     * console.log('Total Pages:', response.meta.totalPages);
     * 
     * // Get all documents (including inactive)
     * const response = await client.documents.list(eventId, {
     *   page: 1,
     *   limit: 20,
     *   includeInactive: true
     * });
     * ```
     */
    async list(
        eventId: string,
        options?: ListDocumentsOptions
    ): Promise<DocumentListResponse> {
        const params: Record<string, any> = {};

        if (options?.page !== undefined) {
            params.page = options.page;
        }
        if (options?.limit !== undefined) {
            params.limit = options.limit;
        }
        if (options?.includeInactive !== undefined) {
            params.includeInactive = options.includeInactive;
        }

        const response = await this.client.get<DocumentListResponse>(
            `/events/${eventId}/documents`,
            Object.keys(params).length > 0 ? params : undefined
        );
        return response;
    }

    /**
     * Get a specific document by ID
     * Includes signed download URL (valid for 24 hours)
     * @param eventId Event ID
     * @param documentId Document ID
     * @returns Document details with downloadUrl
     * 
     * @example
     * ```typescript
     * const document = await client.documents.getById(eventId, documentId);
     * console.log('Title:', document.title);
     * console.log('Download URL:', document.downloadUrl);
     * 
     * // Open in new tab
     * window.open(document.downloadUrl, '_blank');
     * ```
     */
    async getById(eventId: string, documentId: string): Promise<EventDocument> {
        const response = await this.client.get<ApiResponse<EventDocument>>(
            `/events/${eventId}/documents/${documentId}`
        );
        return response.data;
    }

    /**
     * Update document metadata
     * @param eventId Event ID
     * @param documentId Document ID
     * @param updates Fields to update (title, description, isActive)
     * @returns Updated document
     * 
     * @example
     * ```typescript
     * // Update title and description
     * const updated = await client.documents.update(eventId, documentId, {
     *   title: 'Updated Title',
     *   description: 'Updated description with more details'
     * });
     * 
     * // Toggle visibility
     * await client.documents.update(eventId, documentId, {
     *   isActive: false
     * });
     * ```
     */
    async update(
        eventId: string,
        documentId: string,
        updates: UpdateDocumentParams
    ): Promise<EventDocument> {
        const response = await this.client.patch<ApiResponse<EventDocument>>(
            `/events/${eventId}/documents/${documentId}`,
            updates
        );
        return response.data;
    }

    /**
     * Permanently delete a document
     * @param eventId Event ID
     * @param documentId Document ID
     * 
     * @example
     * ```typescript
     * try {
     *   await client.documents.delete(eventId, documentId);
     *   console.log('Document deleted successfully');
     * } catch (error) {
     *   console.error('Failed to delete document:', error.message);
     * }
     * ```
     */
    async delete(
        eventId: string,
        documentId: string
    ): Promise<void> {
        await this.client.delete<ApiResponse<{ message: string }>>(
            `/events/${eventId}/documents/${documentId}`
        );
    }
}
