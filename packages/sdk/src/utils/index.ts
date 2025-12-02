export * from './browserDetection';
export * from './signParticipantToken';

export const formatMessage = (message: string): string => {
  return `[SDK] ${message}`;
};
export const isValidApiKey = (apiKey: string): boolean => {
  return apiKey.length > 0;
};
