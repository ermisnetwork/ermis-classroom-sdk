/**
 * Event Documents API
 * Manages documents attached to events.
 * Supports: Upload, List, Get, Update, Delete, Reorder, and Download
 */

import type { VCRHTTPClient } from '../client';
import type {
    EventDocument,
    UploadDocumentOptions,
    UpdateDocumentParams,
    ListDocumentsOptions,
    DocumentListResponse,
    DocumentReorderItem,
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
        if (options.displayOrder !== undefined) {
            formData.append('displayOrder', String(options.displayOrder));
        }

        const response = await this.client.postFormData<ApiResponse<EventDocument>>(
            `/events/${eventId}/documents`,
            formData
        );
        return response.data;
    }

    /**
     * Get all documents for an event
     * @param eventId Event ID
     * @param options Query options (includeInactive)
     * @returns List of documents with total count
     * 
     * @example
     * ```typescript
     * // Get active documents only
     * const { documents, total } = await client.documents.list(eventId);
     * 
     * // Get all documents (including inactive)
     * const { documents, total } = await client.documents.list(eventId, {
     *   includeInactive: true
     * });
     * ```
     */
    async list(
        eventId: string,
        options?: ListDocumentsOptions
    ): Promise<DocumentListResponse> {
        const params: Record<string, any> = {};
        if (options?.includeInactive) {
            params.includeInactive = options.includeInactive;
        }

        const response = await this.client.get<ApiResponse<DocumentListResponse>>(
            `/events/${eventId}/documents`,
            Object.keys(params).length > 0 ? params : undefined
        );
        return response.data;
    }

    /**
     * Get a specific document by ID
     * @param eventId Event ID
     * @param documentId Document ID
     * @returns Document details
     * 
     * @example
     * ```typescript
     * const document = await client.documents.getById(eventId, documentId);
     * console.log(document.title);
     * ```
     */
    async getById(eventId: string, documentId: string): Promise<EventDocument> {
        const response = await this.client.get<ApiResponse<EventDocument>>(
            `/events/${eventId}/documents/${documentId}`
        );
        return response.data;
    }

    /**
     * Get a signed download URL for a document
     * @param eventId Event ID
     * @param documentId Document ID
     * @returns Signed download URL (expires in 1 hour)
     * 
     * @example
     * ```typescript
     * const downloadUrl = await client.documents.getDownloadUrl(eventId, documentId);
     * 
     * // Browser - open in new tab
     * window.open(downloadUrl, '_blank');
     * ```
     * 
     * @note URL expires in 1 hour. Generate new URL when needed.
     */
    async getDownloadUrl(eventId: string, documentId: string): Promise<string> {
        const response = await this.client.get<ApiResponse<{ url: string }>>(
            `/events/${eventId}/documents/${documentId}/download`
        );
        return response.data.url;
    }

    /**
     * Update document metadata
     * @param eventId Event ID
     * @param documentId Document ID
     * @param updates Fields to update
     * @returns Updated document
     * 
     * @example
     * ```typescript
     * const updated = await client.documents.update(eventId, documentId, {
     *   title: 'Updated Title',
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
     * Delete a document
     * @param eventId Event ID
     * @param documentId Document ID
     * @returns Deletion result with success status and message
     * 
     * @example
     * ```typescript
     * const result = await client.documents.delete(eventId, documentId);
     * console.log(result.message); // "Document deleted successfully"
     * ```
     */
    async delete(
        eventId: string,
        documentId: string
    ): Promise<{ success: boolean; message: string }> {
        const response = await this.client.delete<ApiResponse<{ message: string }>>(
            `/events/${eventId}/documents/${documentId}`
        );
        return {
            success: true,
            message: response.data?.message || 'Document deleted successfully',
        };
    }

    /**
     * Reorder multiple documents
     * @param eventId Event ID
     * @param orders Array of document IDs with their new display orders
     * @returns Reorder result with success status and message
     * 
     * @example
     * ```typescript
     * await client.documents.reorder(eventId, [
     *   { documentId: 'doc1', displayOrder: 1 },
     *   { documentId: 'doc2', displayOrder: 2 },
     *   { documentId: 'doc3', displayOrder: 3 }
     * ]);
     * ```
     */
    async reorder(
        eventId: string,
        orders: DocumentReorderItem[]
    ): Promise<{ success: boolean; message: string }> {
        const response = await this.client.patch<ApiResponse<{ message: string }>>(
            `/events/${eventId}/documents/reorder`,
            { orders }
        );
        return {
            success: true,
            message: response.data?.message || 'Documents reordered successfully',
        };
    }
}
