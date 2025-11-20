# VCR SDK - Virtual Classroom SDK

A comprehensive TypeScript SDK for the Virtual Classroom API with full TypeScript support and API key authentication.

## Installation

```bash
npm install @ermisnetwork/vcr-client
# or
pnpm add @ermisnetwork/vcr-client
# or
yarn add @ermisnetwork/vcr-client
```

## Quick Start

### Using API Key Authentication (Server-to-Server)

```typescript
import { createVCRClient } from '@ermisnetwork/vcr-client';

const sdk = createVCRClient({
  baseUrl: 'http://localhost:3000/api',
  apiKey: 'your-api-key-here',
});

// Now you can use the SDK
const events = await sdk.events.list();
console.log(events);
```

### Using Bearer Token Authentication (User Authentication)

```typescript
import { createVCRClient } from '@ermisnetwork/vcr-client';

const sdk = createVCRClient({
  baseUrl: 'http://localhost:3000/api',
});

// Login to get access token
const authResponse = await sdk.auth.login({
  email: 'user@example.com',
  password: 'password123',
});

// Set the access token
sdk.setAccessToken(authResponse.accessToken);

// Now you can make authenticated requests
const profile = await sdk.users.getProfile();
console.log(profile);
```

## API Reference

### Authentication

```typescript
// Register a new user
const user = await sdk.auth.register({
  email: 'user@example.com',
  password: 'password123',
  firstName: 'John',
  lastName: 'Doe',
});

// Login
const authResponse = await sdk.auth.login({
  email: 'user@example.com',
  password: 'password123',
});

// Refresh tokens
const newTokens = await sdk.auth.refreshTokens({
  refreshToken: authResponse.refreshToken,
});

// Logout
await sdk.auth.logout();
```

### API Keys Management

```typescript
// Create a new API key
const apiKey = await sdk.apiKeys.create({
  name: 'External Integration',
  permissions: {
    events: [], // Empty array means all events
    actions: ['create', 'read', 'update', 'delete'],
  },
  allowedOrigins: ['https://example.com'],
  expiresAt: '2025-12-31T23:59:59Z',
  rateLimit: {
    requestsPerMinute: 100,
    requestsPerHour: 1000,
  },
});

// IMPORTANT: Save the plainSecret - it's only shown once!
console.log('API Key:', apiKey.plainSecret);

// List API keys
const apiKeys = await sdk.apiKeys.list({
  page: 1,
  limit: 10,
  isActive: true,
});

// Get API key by ID
const key = await sdk.apiKeys.get('api-key-id');

// Update API key
await sdk.apiKeys.update('api-key-id', {
  name: 'Updated Name',
  isActive: false,
});

// Regenerate API key secret
const newSecret = await sdk.apiKeys.regenerateSecret('api-key-id');

// Get usage statistics
const stats = await sdk.apiKeys.getUsageStats('api-key-id');

// Deactivate API key
await sdk.apiKeys.deactivate('api-key-id');
```

### Users

```typescript
// Get all users
const users = await sdk.users.list({
  page: 1,
  limit: 10,
  roles: ['student', 'teacher'],
  search: 'john',
});

// Get current user profile
const profile = await sdk.users.getProfile();

// Update current user profile
await sdk.users.updateProfile({
  firstName: 'Jane',
  lastName: 'Smith',
});

// Get user by ID
const user = await sdk.users.get('user-id');

// Update user
await sdk.users.update('user-id', {
  firstName: 'Updated',
  isActive: true,
});

// Update user role
await sdk.users.updateRole('user-id', {
  role: 'teacher',
});

// Delete user
await sdk.users.delete('user-id');
```

### Events

```typescript
// Create an event
const event = await sdk.events.create({
  title: 'Final Exam - Mathematics',
  description: 'Final examination for Mathematics course',
  templateId: 'template-id',
  startTime: '2024-12-01T09:00:00Z',
  endTime: '2024-12-01T11:00:00Z',
  maxScore: 100,
  settings: {
    maxParticipants: 100,
    waitingRoomEnabled: true,
    recordingEnabled: true,
    chatEnabled: true,
  },
  registrationSettings: {
    allowSelfRegistration: true,
    requireApproval: false,
    maxParticipants: 100,
  },
  tags: ['exam', 'mathematics'],
});

// List events
const events = await sdk.events.list({
  page: 1,
  limit: 10,
  organizerId: 'organizer-id',
  startDateFrom: '2024-12-01T00:00:00Z',
  tags: ['exam'],
});

// Get event by ID
const eventDetails = await sdk.events.get('event-id');

// Update event
await sdk.events.update('event-id', {
  title: 'Updated Title',
  settings: {
    maxParticipants: 150,
  },
});

// Delete event
await sdk.events.delete('event-id');

// Get participant statistics
const stats = await sdk.events.getParticipantStats('event-id');
```

### Event Registrants

```typescript
// Create registrant
const registrant = await sdk.events.createRegistrant('event-id', {
  firstName: 'John',
  lastName: 'Doe',
  email: 'john@example.com',
  authId: 'student_12345',
  role: 'student',
});

// List registrants
const registrants = await sdk.events.getRegistrants('event-id', {
  page: 1,
  limit: 10,
  status: 'active',
});

// Update registrant
await sdk.events.updateRegistrant('event-id', 'registrant-id', {
  status: 'cancelled',
});

// Approve registrant
await sdk.events.approveRegistrant('event-id', 'registrant-id');

// Reject registrant
await sdk.events.rejectRegistrant('event-id', 'registrant-id');

// Create mock registrants for testing
await sdk.events.createMockRegistrants('event-id', {
  count: 50,
  role: 'student',
});

// Join event with code
const joinResponse = await sdk.events.joinWithCode({
  joinCode: 'ABC123XYZ',
});
```

### Event Templates

```typescript
// Create template
const template = await sdk.templates.create({
  name: 'JSU Template for Final Exam',
  description: 'Template for Judgement Session Unit final examinations',
  type: 'JSU',
  settings: {
    maxParticipants: 100,
    waitingRoomEnabled: true,
    examLockEnabled: true,
  },
});

// List templates
const templates = await sdk.templates.list({
  page: 1,
  limit: 10,
});

// Get template
const templateDetails = await sdk.templates.get('template-id');

// Update template
await sdk.templates.update('template-id', {
  name: 'Updated Template Name',
});

// Delete template
await sdk.templates.delete('template-id');
```

### Scores

```typescript
// Create score
const score = await sdk.scores.create({
  eventId: 'event-id',
  participantId: 'participant-id',
  score: 85,
  grade: 'B',
  feedback: 'Good work!',
});

// Bulk create scores
await sdk.scores.bulkCreate({
  eventId: 'event-id',
  scores: [
    { participantId: 'p1', score: 90, grade: 'A' },
    { participantId: 'p2', score: 85, grade: 'B' },
  ],
});

// List scores
const scores = await sdk.scores.list({
  eventId: 'event-id',
  page: 1,
  limit: 10,
});

// Update score
await sdk.scores.update('score-id', {
  score: 90,
  grade: 'A',
  feedback: 'Excellent!',
});

// Publish scores
await sdk.scores.publish({
  eventId: 'event-id',
  sendNotification: true,
});

// Request score review
await sdk.scores.requestReview('score-id', {
  reason: 'I believe there was an error in grading',
  details: 'Question 3 should be correct',
});

// Process review (admin/teacher)
await sdk.scores.processReview('score-id', {
  decision: 'approved',
  newScore: 95,
  response: 'After reviewing, score has been updated',
});
```

### Event Logs

```typescript
// Get event logs
const logs = await sdk.eventLogs.getEventLogs('event-id', {
  page: 1,
  limit: 10,
  actions: ['participant_joined', 'participant_left'],
  level: 'info',
});

// Get event log statistics
const stats = await sdk.eventLogs.getEventLogStats('event-id', {
  periodDays: 30,
  groupBy: 'day',
});

// Get user logs
const userLogs = await sdk.eventLogs.getUserLogs('user-id', {
  page: 1,
  limit: 10,
});

// Export event logs
const exportData = await sdk.eventLogs.exportEventLogs({
  eventId: 'event-id',
  format: 'csv',
  fromDate: '2024-01-01T00:00:00Z',
  toDate: '2024-12-31T23:59:59Z',
});
```

## TypeScript Support

The SDK is written in TypeScript and provides full type definitions for all API methods and responses.

```typescript
import type {
  CreateEventDto,
  EventResponseDto,
  UserRole,
  ScoreGrade,
} from '@ermisnetwork/vcr-client';

// All types are exported and can be used in your application
const eventData: CreateEventDto = {
  title: 'My Event',
  templateId: 'template-id',
  startTime: '2024-12-01T09:00:00Z',
  endTime: '2024-12-01T11:00:00Z',
  maxScore: 100,
};
```

## Error Handling

```typescript
import { VCRError } from '@ermisnetwork/vcr-client';

try {
  const event = await sdk.events.get('invalid-id');
} catch (error) {
  if (error instanceof VCRError) {
    console.error('Status:', error.statusCode);
    console.error('Message:', error.message);
    console.error('Data:', error.data);
  }
}
```

## License

MIT

