/**
 * Event Logs API
 */

import type { VCRClient } from '../client';
import type {
  ListEventLogsParams,
  EventLogStatsParams,
  ExportEventLogsParams,
  PaginatedResponse,
} from '../types';

export class EventLogsAPI {
  constructor(private client: VCRClient) {}

  /**
   * Get event logs with filtering
   */
  async getEventLogs(eventId: string, params?: ListEventLogsParams): Promise<PaginatedResponse<any>> {
    return this.client.get<PaginatedResponse<any>>(`/event-logs/events/${eventId}`, params);
  }

  /**
   * Get event log statistics
   */
  async getEventLogStats(eventId: string, params?: EventLogStatsParams): Promise<any> {
    return this.client.get(`/event-logs/events/${eventId}/stats`, params);
  }

  /**
   * Get logs for specific user
   */
  async getUserLogs(userId: string, params?: ListEventLogsParams): Promise<PaginatedResponse<any>> {
    return this.client.get<PaginatedResponse<any>>(`/event-logs/users/${userId}`, params);
  }

  /**
   * Get real-time logs
   */
  async getRealtimeLogs(eventId: string, lastTimestamp: string): Promise<any> {
    return this.client.get(`/event-logs/events/${eventId}/realtime`, { lastTimestamp });
  }

  /**
   * Export event logs
   */
  async exportEventLogs(params?: ExportEventLogsParams): Promise<any> {
    return this.client.post('/event-logs/export', undefined, params);
  }

  /**
   * Cleanup old logs
   */
  async cleanupOldLogs(retentionDays: number): Promise<any> {
    return this.client.post('/event-logs/cleanup', undefined, { retentionDays });
  }
}

