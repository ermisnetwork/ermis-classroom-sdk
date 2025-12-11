/**
 * Connection status constants
 */
export const ConnectionStatus = {
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  RECONNECTING: 'reconnecting',
  FAILED: 'failed',
} as const;

export type ConnectionStatusType = (typeof ConnectionStatus)[keyof typeof ConnectionStatus];
