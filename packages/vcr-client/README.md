# VCR SDK - Virtual Classroom SDK

A TypeScript SDK for the Virtual Classroom (VCR) API with full type support and API Key authentication.

> **Note:** This SDK provides access to 4 resources only: Events, Registrants, Rewards, and Ratings (read-only). All operations follow strict ownership rules - you can only modify resources created by your API Key.

## Installation

```bash
npm install @ermisnetwork/vcr-client
# or
pnpm add @ermisnetwork/vcr-client
# or
yarn add @ermisnetwork/vcr-client
```

## Quick Start

### Basic Usage

```typescript
import { createVCRClient } from '@ermisnetwork/vcr-client';

const client = createVCRClient({
  apiKey: 'ak_1234567890abcdef.a1b2c3d4e5f6789...',
  baseUrl: 'https://api.vcr.example.com', // Optional, defaults to production
});

// Create an event
const event = await client.events.create({
  title: 'Mathematics 101 - Lecture 5',
  description: 'Introduction to Calculus',
  startTime: '2026-01-15T09:00:00Z',
  endTime: '2026-01-15T11:00:00Z',
  maxScore: 100,
  isPublic: false,
  tags: ['math', 'calculus'],
  settings: {
    maxParticipants: 50,
    recordingEnabled: true,
    chatEnabled: true,
    screenShareEnabled: false,
    requirePermissionForMic: true,
    requirePermissionForCamera: true,
  },
});

console.log('Event created:', event.joinLink);
console.log('Room code:', event.ermisRoomCode);
```

## Configuration

### API Key Format

API Keys follow the format: `ak_<keyId>.<secret>`

Example: `ak_1234567890abcdef.a1b2c3d4e5f6789...`

### Authentication Methods

The SDK supports two authentication methods:

**Method 1: Custom Header (Recommended)**
```typescript
const client = createVCRClient({
  apiKey: 'ak_xxx.yyy',
  baseUrl: 'https://api.vcr.example.com',
  // Uses x-api-key header by default
});
```

**Method 2: Authorization Header**
```typescript
const client = createVCRClient({
  apiKey: 'ak_xxx.yyy',
  baseUrl: 'https://api.vcr.example.com',
  useAuthorizationHeader: true, // Uses Authorization: Bearer header
});
```

### Configuration Options

```typescript
interface VCRClientConfig {
  apiKey: string; // Required: Your API Key
  baseUrl?: string; // Optional: Defaults to production URL
  timeout?: number; // Optional: Request timeout in ms (default: 30000)
  headers?: Record<string, string>; // Optional: Additional headers
  useAuthorizationHeader?: boolean; // Optional: Use Authorization header instead of x-api-key
  language?: 'vi' | 'en'; // Optional: Language for API responses (default: 'vi')
}
```

### Multi-Language Support

The SDK supports **2 languages**: Vietnamese (`vi`) and English (`en`). The default language is **Vietnamese**.

All API responses include a `message` field that is automatically translated based on the selected language.

#### Setting Language on Initialization

```typescript
// Vietnamese (default)
const client = createVCRClient({
  apiKey: 'ak_xxx.yyy',
  language: 'vi', // or omit for default
});

// English
const client = createVCRClient({
  apiKey: 'ak_xxx.yyy',
  language: 'en',
});
```

#### Changing Language Dynamically

```typescript
const client = createVCRClient({
  apiKey: 'ak_xxx.yyy',
  language: 'vi',
});

// Get events in Vietnamese
const events = await client.events.list();
console.log(events.message); // "Lấy danh sách sự kiện thành công"

// Switch to English
client.setLanguage('en');

// Get events in English
const eventsEn = await client.events.list();
console.log(eventsEn.message); // "Events retrieved successfully"
```

#### Language Examples

```typescript
// Ban registrant - Vietnamese message
client.setLanguage('vi');
const banned = await client.registrants.ban('event-id', 'registrant-id', 'Lý do');
console.log(banned.message); // "Đã cấm người tham gia khỏi sự kiện"

// Ban registrant - English message
client.setLanguage('en');
const bannedEn = await client.registrants.ban('event-id', 'registrant-id', 'Reason');
console.log(bannedEn.message); // "Registrant banned from event"
```

> **Note:** The `lang` parameter is automatically added to all API requests. You don't need to manually add it to URLs.

## API Reference

### Events

Manage virtual classroom events (lớp học/sự kiện).

#### Create Event

```typescript
const event = await client.events.create({
  title: 'Mathematics 101 - Lecture 5',
  description: 'Introduction to Calculus',
  startTime: '2026-01-15T09:00:00Z',
  endTime: '2026-01-15T11:00:00Z',
  isPublic: false,
  location: 'Room A1',
  tags: ['math', 'calculus'],
  settings: {
    maxParticipants: 50,
    allowBreakoutRooms: true,
    recordingEnabled: true,
    chatEnabled: true,
    screenShareEnabled: false,
    blockAllStudentMic: false,
    blockAllStudentCamera: false,
    requirePermissionForMic: true,
    requirePermissionForCamera: true,
    requirePermissionForScreenShare: true,
  },
  rewardIds: ['507f...'], // Optional: IDs of rewards to apply
});

// Response includes:
// - _id: Event ID
// - joinLink: Public join link
// - ermisRoomCode: Room code for joining
// - ermisRoomStatus: Current room status
// - ermisChatChannelId: Chat channel ID
// - createdByApiKey: ID of the API Key that created this event
```

#### Get Event

```typescript
const event = await client.events.get('event-id');
```

#### Update Event

```typescript
// ⚠️ Only events created by your API Key can be updated
const updatedEvent = await client.events.update('event-id', {
  title: 'Updated Title',
  startTime: '2026-01-15T10:00:00Z',
  settings: {
    maxParticipants: 100,
  },
});
```

#### Delete Event

```typescript
// ⚠️ Only events created by your API Key can be deleted
await client.events.delete('event-id');
```


### Registrants

Manage event participants (học viên/người tham dự).

#### Create Registrant

```typescript
const registrant = await client.registrants.create('event-id', {
  firstName: 'Nguyen',
  lastName: 'Van A',
  email: 'ana@example.com',
  authId: 'student_internal_id_123', // ID học viên từ hệ thống của bạn
  role: 'student', // 'student' | 'teacher' | 'admin' | 'staff' | 'parent'
});

// Response includes:
// - _id: Registrant ID
// - joinCode: Unique join code for this registrant
// - personalJoinLink: Link tham gia riêng với token
// - status: 'active' | 'cancelled'
// - type: 'user' | 'external'
// - authId: Your internal student ID
```

#### List Registrants

```typescript
const registrants = await client.registrants.list('event-id', {
  page: 1,
  limit: 10,
  search: 'nguyen', // Search by name or email
  role: 'student', // Optional filter by role
  status: 'active', // Optional filter by status
  type: 'user', // Optional filter by type
});
```

#### Update Registrant

```typescript
// ⚠️ Only registrants created by your API Key can be updated
const updated = await client.registrants.update('event-id', 'registrant-id', {
  firstName: 'Updated Name',
  email: 'newemail@example.com',
  status: 'active',
});
```

#### Delete Registrant

```typescript
// ⚠️ Only registrants created by your API Key can be deleted
await client.registrants.delete('event-id', 'registrant-id');
```

#### Ban Registrant

Ban a registrant from an event. This prevents them from joining the event, even with a valid join code. API keys can bypass this restriction when joining.

**Important Notes:**
- This API **automatically** updates the database status (`isBanned = true`) **AND** kicks the user from the video room if they are currently online
- The system will automatically call the kick service when banning, so you **don't need** to call `kick()` separately
- If the kick fails (e.g., user is not online), the ban operation still succeeds because the database ban is completed
- Backend automatically looks up `authId` and `streamId` from `registrantId`, so you only need to provide `registrantId`
- You need to get `registrantId` from the registrants list API first

```typescript
// Step 1: Get registrantId from the registrants list
const registrants = await client.registrants.list('event-id');
const targetRegistrant = registrants.data.find(r => r.authId === 'student_12345');

if (targetRegistrant) {
  // Step 2: Ban the registrant (automatically kicks if online)
  const result = await client.registrants.ban(
    'event-id',
    targetRegistrant._id, // registrantId from the list
    'Vi phạm quy chế thi'
  );

  // Response:
  // {
  //   success: true,
  //   message: "Registrant banned from event" // or "Đã cấm người tham gia khỏi sự kiện" (vi)
  // }
}
```

> **Note:** Only Admin and Teacher can ban registrants. Banned registrants cannot join the event unless the join request uses an API key. The system automatically performs both ban and kick operations.

#### Kick Registrant (Temporary)

Kick a registrant from the event's video room temporarily. This disconnects the user from the current session but does NOT prevent them from rejoining.

**Important Notes:**
- This API **ONLY** disconnects the user from the current session
- The user can join again immediately after being kicked (unless they are also banned)
- To permanently prevent rejoining, use `ban()` instead (which automatically kicks)
- Backend automatically looks up `authId` and `streamId` from `registrantId`

```typescript
// Get registrantId from the registrants list first
const registrants = await client.registrants.list('event-id');
const targetRegistrant = registrants.data.find(r => r.authId === 'student_12345');

if (targetRegistrant) {
  // Temporary kick (user can rejoin)
  await client.registrants.kick(
    'event-id',
    targetRegistrant._id, // registrantId
    'Gây mất trật tự'
  );
}
```

> **Note:** Requires Bearer Token (Teacher/Admin/AO) or API Key. API returns 204 No Content on success.

#### Unban Registrant

Unban a registrant from an event, allowing them to join again.

```typescript
// Get registrantId from the registrants list first
const registrants = await client.registrants.list('event-id');
const targetRegistrant = registrants.data.find(r => r.authId === 'student_12345');

if (targetRegistrant) {
  const result = await client.registrants.unban(
    'event-id',
    targetRegistrant._id // registrantId
  );

  // Response:
  // {
  //   success: true,
  //   message: "Registrant unbanned from event" // or "Đã bỏ cấm người tham gia khỏi sự kiện" (vi)
  // }
}
```

> **Note:** Only Admin and Teacher can unban registrants. After unbanning, the user can join the event using their join code or personal join link.

#### Bulk Create Registrants

Create up to **100 registrants** in a single request. The API supports **partial success**:
- Some registrants may fail (e.g. duplicate `authId`), others still create successfully.

```typescript
import type { BulkCreateRegistrantsParams } from '@ermisnetwork/vcr-client';

const payload: BulkCreateRegistrantsParams = {
  registrants: [
    {
      firstName: 'Nguyen',
      lastName: 'Van A',
      email: 'studentA@example.com',
      authId: 'student_001',
      role: 'student',
    },
    {
      firstName: 'Tran',
      lastName: 'Thi B',
      email: 'studentB@example.com',
      authId: 'student_002',
      role: 'student',
    },
    // ...
  ],
};

const result = await client.registrants.bulkCreate('event-id', payload);

console.log('Created:', result.created);
console.log('Failed:', result.failed);
console.log('Errors:', result.errors);
console.log('Created registrants:', result.createdRegistrants);
```

> **SDK validation:** The SDK will throw an error if:
> - `registrants` is empty
> - `registrants` has more than 100 items

### Rewards

Manage event rewards (phần thưởng).

#### Create Reward

```typescript
// Create a File object from your file input or file system
const file = new File([fileData], 'reward.png', { type: 'image/png' });

const reward = await client.rewards.create({
  file: file, // Required: Image file
  name: 'Gold Star',
  description: 'Awarded for excellent performance',
});

// Response includes:
// - _id: Reward ID
// - image: URL to the reward image
// - createdByApiKey: ID of the API Key that created this reward
```

#### Get Reward

```typescript
const reward = await client.rewards.get('reward-id');
```

#### Update Reward

```typescript
// ⚠️ Only rewards created by your API Key can be updated
const file = new File([fileData], 'new-reward.png', { type: 'image/png' });

const updated = await client.rewards.update('reward-id', {
  name: 'Updated Reward Name',
  description: 'New description',
  file: file, // Optional: new image file
});
```

#### Delete Reward

```typescript
// ⚠️ Only rewards created by your API Key can be deleted
await client.rewards.delete('reward-id');
```

### Ratings

View event ratings (đánh giá) - **Read Only**.

```typescript
// Get event ratings
const ratings = await client.ratings.list('event-id');

// Response includes:
// - averageCallQuality: Average network/call quality
// - averageClassQuality: Average class quality
// - averageTeacher: Average teacher rating
// - totalRatings: Total number of ratings
// - ratings: Array of rating objects with:
//   - callQuality: Rating for call quality (1-5)
//   - classQuality: Rating for class quality (1-5)
//   - teacher: Rating for teacher (1-5)
//   - otherThoughts: Optional free-text feedback
//   - createdAt: Timestamp

console.log(`Average call quality: ${ratings.averageCallQuality}`);
console.log(`Average class quality: ${ratings.averageClassQuality}`);
console.log(`Average teacher: ${ratings.averageTeacher}`);
console.log(`Total ratings: ${ratings.totalRatings}`);
ratings.ratings.forEach((r) => {
  console.log(
    `Call: ${r.callQuality}, Class: ${r.classQuality}, Teacher: ${r.teacher}, Thoughts: ${
      r.otherThoughts || 'No comment'
    }`,
  );
});
```

> **Note:** API Key chỉ có quyền xem ratings, không có quyền tạo hay sửa đánh giá.

## Ownership & Permissions

### Ownership Rules

The API follows **Strict Ownership** rules:

- ✅ **CREATE**: You can create new Events, Registrants, and Rewards
- ✅ **READ**: You can view all Events, Registrants, Rewards, and Ratings (even those created by others)
- ✅ **UPDATE/DELETE**: You can only modify resources created by your API Key
- ❌ **FORBIDDEN**: Attempting to modify resources created by others will result in a `403 Forbidden` error

### Example: Ownership Violation

```typescript
try {
  // Trying to update an event created by another API Key
  await client.events.update('other-api-key-event-id', {
    title: 'Hacked Title',
  });
} catch (error) {
  if (error instanceof PermissionError) {
    console.error('Cannot modify resources created by other API Keys');
    // Error message: "API Key can only modify events it created"
  }
}
```

## Error Handling

The SDK provides specific error classes for different HTTP status codes:

```typescript
import {
  VCRError,
  AuthenticationError,
  PermissionError,
  NotFoundError,
  RateLimitError,
  ServerError,
} from '@ermisnetwork/vcr-client';

try {
  const event = await client.events.get('invalid-id');
} catch (error) {
  if (error instanceof AuthenticationError) {
    // 401: API Key không hợp lệ hoặc thiếu
    console.error('Authentication failed:', error.message);
  } else if (error instanceof PermissionError) {
    // 403: Thao tác resource không phải của mình hoặc truy cập resource bị cấm
    console.error('Permission denied:', error.message);
  } else if (error instanceof NotFoundError) {
    // 404: Resource không tồn tại
    console.error('Not found:', error.message);
  } else if (error instanceof RateLimitError) {
    // 429: Vượt quá rate limit
    console.error('Rate limit exceeded:', error.message);
    // Consider implementing retry with exponential backoff
  } else if (error instanceof ServerError) {
    // 5xx: Lỗi server VCR
    console.error('Server error:', error.message);
  } else if (error instanceof VCRError) {
    // Other errors
    console.error('Error:', error.statusCode, error.message);
    console.error('Data:', error.data);
  }
}
```

### Error Response Format

```typescript
{
  statusCode: 403,
  message: "API Key can only modify events it created",
  error: "Forbidden",
  data: { /* Additional error details */ }
}
```

## TypeScript Support

The SDK is written in TypeScript and provides full type definitions:

```typescript
import type {
  CreateEventParams,
  UpdateEventParams,
  Event,
  CreateRegistrantParams,
  Registrant,
  CreateRewardParams,
  Reward,
  RatingList,
  Rating,
  CreateRatingParams,
} from '@ermisnetwork/vcr-client';

// Type-safe event creation
const eventData: CreateEventParams = {
  title: 'My Event',
  startTime: '2026-01-15T09:00:00Z',
  endTime: '2026-01-15T11:00:00Z',
  settings: {
    maxParticipants: 50,
    allowBreakoutRooms: true,
  },
};

const event: Event = await client.events.create(eventData);

// Type-safe rating creation payload
const ratingData: CreateRatingParams = {
  callQuality: 5,
  classQuality: 4,
  teacher: 5,
  otherThoughts: 'Great class!',
};
```

## Kick & Ban Workflows

### Understanding Kick vs Ban

| Feature | Action | Purpose | Effect on User |
| :--- | :--- | :--- | :--- |
| **Kick** | Disconnects Stream/Socket | Remove user from room **immediately** (temporary) | User is disconnected from video room. Can rejoin immediately if not banned. |
| **Ban** | Sets `isBanned = true` in DB + **Auto Kick** | **Prevent** user from joining event + **Remove** from room (permanent) | User cannot call `/join` API to enter the class anymore. Automatically kicked if currently online. |

### Getting Registrant ID

All Kick, Ban, and Unban APIs require `registrantId` (the `_id` field from the registrants collection). You need to get this from the registrants list API first:

```typescript
// Get list of registrants for an event
const registrants = await client.registrants.list('event-id', {
  page: 1,
  limit: 100,
  // Optional filters
  role: 'student',
  status: 'active',
});

// Find registrant by authId (your internal user ID)
const targetRegistrant = registrants.data.find(r => r.authId === 'student_12345');

if (targetRegistrant) {
  const registrantId = targetRegistrant._id; // Use this for ban/kick/unban
  console.log('Registrant ID:', registrantId);
  console.log('Registrant info:', {
    _id: targetRegistrant._id,        // registrantId - use this for API calls
    authId: targetRegistrant.authId,  // Your internal user ID
    firstName: targetRegistrant.firstName,
    lastName: targetRegistrant.lastName,
    isBanned: targetRegistrant.isBanned,
  });
}
```

### Best Practices

#### Scenario 1: Temporary Kick (Warning)
Use when you want to warn a student but allow them to rejoin:

```typescript
// Step 1: Get registrantId from the registrants list
const registrants = await client.registrants.list('event-id');
const targetRegistrant = registrants.data.find(r => r.authId === 'student_12345');

if (targetRegistrant) {
  // Step 2: Kick temporarily - user can rejoin
  await client.registrants.kick('event-id', targetRegistrant._id, 'Gây mất trật tự');
}
```

#### Scenario 2: Permanent Ban (Automatically Kicks)
Use when you want to permanently remove a student. The ban API automatically kicks the user if they are online:

```typescript
// Step 1: Get registrantId from the registrants list
const registrants = await client.registrants.list('event-id');
const targetRegistrant = registrants.data.find(r => r.authId === 'student_12345');

if (targetRegistrant) {
  // Step 2: Ban automatically kicks if user is online - no need to call kick separately
  await client.registrants.ban('event-id', targetRegistrant._id, 'Vi phạm quy chế thi');
}
```

#### Scenario 3: Unban a User
Allow a previously banned user to rejoin:

```typescript
// Step 1: Get registrantId from the registrants list
const registrants = await client.registrants.list('event-id');
const targetRegistrant = registrants.data.find(r => r.authId === 'student_12345');

if (targetRegistrant) {
  // Step 2: Unban the registrant
  await client.registrants.unban('event-id', targetRegistrant._id);
}
```

### Handling Kick Events in Client Applications

When a user is kicked, the Room SDK will emit a `participantRemovedByHost` event. Handle this in your application:

```typescript
// In your Room SDK integration
room.on('participantRemovedByHost', (event) => {
  if (event.isLocal) {
    // Current user was kicked
    alert(`Bạn đã bị mời ra khỏi phòng học. Lý do: ${event.reason}`);
    // Redirect to home page
    window.location.href = '/';
  } else {
    // Another participant was kicked
    console.log(`Participant ${event.participant.userId} was removed: ${event.reason}`);
  }
});
```

### Handling Ban Errors

When a banned user tries to join, the API will return a `403 Forbidden` error:

```typescript
try {
  await client.registrants.join('event-id', { joinCode: 'ABC123' });
} catch (error) {
  if (error instanceof PermissionError) {
    // Check if it's a ban error
    if (error.message.includes('banned')) {
      alert(`Bạn đã bị cấm tham gia sự kiện này. Lý do: ${error.data?.reason || 'Không rõ'}`);
    }
  }
}
```

## Best Practices

### 1. Ownership Caching

Consider caching IDs of resources you create to track what you can modify:

```typescript
const createdEvents: string[] = [];

const event = await client.events.create({ /* ... */ });
createdEvents.push(event._id);

// Later, check before updating
if (createdEvents.includes(eventId)) {
  await client.events.update(eventId, { /* ... */ });
} else {
  console.warn('Cannot update: event not created by this API Key');
}
```

### 2. Error Handling with Retries

Implement retry logic for rate limits and server errors:

```typescript
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof RateLimitError || error instanceof ServerError) {
        if (i === maxRetries - 1) throw error;
        await new Promise((resolve) =>
          setTimeout(resolve, Math.pow(2, i) * 1000)
        ); // Exponential backoff
        continue;
      }
      throw error;
    }
  }
  throw new Error('Max retries exceeded');
}

// Usage
const event = await withRetry(() =>
  client.events.get('event-id')
);
```

### 3. Input Validation

Validate data before sending requests:

```typescript
function validateEventData(data: CreateEventParams): void {
  if (new Date(data.startTime) >= new Date(data.endTime)) {
    throw new Error('startTime must be before endTime');
  }
}

const eventData: CreateEventParams = { /* ... */ };
validateEventData(eventData);
const event = await client.events.create(eventData);
```

### 4. Secure API Key Storage

Never log or expose your API Key:

```typescript
// ❌ BAD: Logging API Key
console.log('API Key:', client.getConfig().apiKey);

// ✅ GOOD: Check if API Key is set
const config = client.getConfig();
console.log('Has API Key:', config.hasApiKey);
```

## Resources & Scope

### ✅ Allowed Resources

The SDK provides access to these 4 resources only:

1. **Events** - Create, read, update, delete events
2. **Registrants** - Manage event participants
3. **Rewards** - Manage event rewards
4. **Ratings** - Read-only access to event ratings

### ⛔ Restricted Resources

API Key **does not** have access to:

- Users & Accounts
- System Settings
- Submissions
- Whiteboard Data
- Uploads (outside of Rewards)
- Templates
- Scores
- Event Logs

Attempting to access these resources will result in a `403 Forbidden` error.

## Examples

### Complete Example: Create Event with Registrants

```typescript
import { createVCRClient } from '@ermisnetwork/vcr-client';

const client = createVCRClient({
  apiKey: process.env.VCR_API_KEY!,
  baseUrl: 'https://api.vcr.example.com',
});

async function createClassWithStudents() {
  try {
    // 1. Create event
    const event = await client.events.create({
      title: 'Mathematics 101 - Lecture 5',
      description: 'Introduction to Calculus',
      startTime: '2026-01-15T09:00:00Z',
      endTime: '2026-01-15T11:00:00Z',
      maxScore: 100,
      settings: {
        maxParticipants: 50,
        recordingEnabled: true,
        chatEnabled: true,
      },
    });

    console.log('Event created:', event._id);
    console.log('Join link:', event.joinLink);

    // 2. Add registrants
    const students = [
      { firstName: 'Nguyen', lastName: 'Van A', email: 'a@example.com', authId: 'student_001' },
      { firstName: 'Tran', lastName: 'Thi B', email: 'b@example.com', authId: 'student_002' },
    ];

    for (const student of students) {
      const registrant = await client.registrants.create(event._id, {
        ...student,
        role: 'student',
      });
      console.log(
        `Added ${student.firstName}: joinCode=${registrant.joinCode}, link=${registrant.personalJoinLink}`,
      );
    }

    // 3. Get ratings (if any)
    const ratings = await client.ratings.list(event._id);
    console.log(
      `Ratings - Call: ${ratings.averageCallQuality}, Class: ${ratings.averageClassQuality}, Teacher: ${ratings.averageTeacher}`,
    );

  } catch (error) {
    if (error instanceof PermissionError) {
      console.error('Permission denied:', error.message);
    } else if (error instanceof NotFoundError) {
      console.error('Resource not found:', error.message);
    } else {
      console.error('Error:', error);
    }
  }
}

createClassWithStudents();
```

## License

MIT
