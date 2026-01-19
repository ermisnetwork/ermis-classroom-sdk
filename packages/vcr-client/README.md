# VCR SDK - Virtual Classroom SDK

A TypeScript SDK for the Virtual Classroom (VCR) API with full type support and API Key authentication.

> **Note:** This SDK provides access to 5 resources: Events, Registrants, Rewards, Ratings (read-only), and Permissions. All operations follow strict ownership rules - you can only modify resources created by your API Key.

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
}
```

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

### Permissions

Manage student permissions in the classroom (quản lý quyền học sinh).

#### Block Permission

Block a student's permission (camera, mic, screen share, chat, drawing).

```typescript
const result = await client.permissions.blockPermission('event-id', {
  participantAuthId: 'student_123',
  permissionType: 'camera',
  reason: 'Vi phạm quy định', // Optional
});

// Response includes:
// - participantAuthId: Student ID
// - permissionType: Type of permission blocked
// - blockedBy: ID of the user who blocked
// - blockedAt: Timestamp when blocked
// - reason: Reason for blocking (optional)
```

#### Unblock Permission

Unblock a previously blocked permission.

```typescript
const result = await client.permissions.unblockPermission('event-id', {
  participantAuthId: 'student_123',
  permissionType: 'camera',
  reason: 'Đã cảnh cáo', // Optional
});

// Response includes:
// - participantAuthId: Student ID
// - permissionType: Type of permission unblocked
// - unblockedBy: ID of the user who unblocked
// - unblockedAt: Timestamp when unblocked
// - reason: Reason for unblocking (optional)
```

#### Update Room Settings

Update permission settings for the entire class.

```typescript
// Tắt chat cho toàn lớp
await client.permissions.updateRoomSettings('event-id', {
  blockAllChat: true,
});

// Bật lại chat cho toàn lớp
await client.permissions.updateRoomSettings('event-id', {
  blockAllChat: false,
});

// Cập nhật nhiều cài đặt cùng lúc
await client.permissions.updateRoomSettings('event-id', {
  blockAllCameras: true,
  blockAllMics: false,
  blockAllScreenShares: true,
  blockAllChat: false,
  requirePermissionForCamera: true,
  requirePermissionForMic: true,
  requirePermissionForScreenShare: true,
});
```

#### Get Permission History

Get permission history for an event.

```typescript
const history = await client.permissions.getHistory('event-id');

// Response includes:
// - data: Array of permission history items
// - success: Boolean indicating success
// - message: Optional message

// Each history item includes:
// - _id: History item ID
// - eventId: Event ID
// - participantAuthId: Student ID
// - permissionType: Type of permission
// - action: 'block' | 'unblock'
// - blockedBy/unblockedBy: User ID who performed the action
// - blockedAt/unblockedAt: Timestamp
// - reason: Reason for the action (optional)
// - createdAt: Creation timestamp
// - updatedAt: Update timestamp

// Filter permissions for a specific student
const studentPermissions = history.data.filter(
  (item) => item.participantAuthId === 'student_123'
);
```

#### Permission Types

| Type | Mô Tả | Ví Dụ |
|------|-------|-------|
| `camera` | Quyền bật camera | Block camera học sinh |
| `mic` | Quyền bật microphone | Block mic học sinh |
| `screenShare` | Quyền chia sẻ màn hình | Block screen share |
| `chat` | Quyền chat trong lớp | **Tắt/bật chat** |
| `draw` | Quyền vẽ trên whiteboard | Block vẽ |

#### Use Cases

**Case 1: Tắt Chat Cho 1 Học Sinh Cụ Thể**

```typescript
// Tắt chat
await client.permissions.blockPermission('event-id', {
  participantAuthId: 'student_123',
  permissionType: 'chat',
  reason: 'Spam',
});

// Sau 5 phút, bật lại
setTimeout(async () => {
  await client.permissions.unblockPermission('event-id', {
    participantAuthId: 'student_123',
    permissionType: 'chat',
  });
}, 5 * 60 * 1000);
```

**Case 2: Tắt Chat Cho Toàn Lớp**

```typescript
// Tắt chat toàn lớp
await client.permissions.updateRoomSettings('event-id', {
  blockAllChat: true,
});
```

**Case 3: Ban Tất Cả Quyền Của 1 Học Sinh**

```typescript
const permissions: PermissionType[] = ['camera', 'mic', 'screenShare', 'chat', 'draw'];

for (const permission of permissions) {
  await client.permissions.blockPermission('event-id', {
    participantAuthId: 'student_123',
    permissionType: permission,
    reason: 'Vi phạm nghiêm trọng',
  });
}
```

**Case 4: Kiểm Tra Trạng Thái Quyền**

```typescript
// Lấy lịch sử quyền
const history = await client.permissions.getHistory('event-id');

// Lọc quyền của học sinh cụ thể
const studentPermissions = history.data.filter(
  (item) => item.participantAuthId === 'student_123'
);

// Kiểm tra quyền nào đang bị block
const blockedPermissions = studentPermissions
  .filter((item) => item.action === 'block')
  .map((item) => item.permissionType);
```

> **Note:** 
> - Tất cả API permissions yêu cầu API Key với quyền Admin/Teacher
> - Khi block/unblock, frontend sẽ nhận WebSocket event để cập nhật UI
> - Trạng thái block/unblock được lưu vào database
> - Tham số `reason` là optional nhưng nên cung cấp để audit log

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
  PermissionType,
  BlockPermissionParams,
  UnblockPermissionParams,
  UpdateRoomSettingsParams,
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

The SDK provides access to these 5 resources:

1. **Events** - Create, read, update, delete events
2. **Registrants** - Manage event participants
3. **Rewards** - Manage event rewards
4. **Ratings** - Read-only access to event ratings
5. **Permissions** - Manage student permissions in the classroom

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

### Example: Managing Student Permissions

```typescript
import { createVCRClient } from '@ermisnetwork/vcr-client';

const client = createVCRClient({
  apiKey: process.env.VCR_API_KEY!,
  baseUrl: 'https://api.vcr.example.com',
});

async function managePermissions() {
  try {
    const eventId = 'event_123';
    const studentAuthId = 'student_123';

    // 1. Block chat for a specific student
    await client.permissions.blockPermission(eventId, {
      participantAuthId: studentAuthId,
      permissionType: 'chat',
      reason: 'Spam messages',
    });
    console.log('Chat blocked for student');

    // 2. After 5 minutes, unblock chat
    setTimeout(async () => {
      await client.permissions.unblockPermission(eventId, {
        participantAuthId: studentAuthId,
        permissionType: 'chat',
        reason: 'Đã cảnh cáo',
      });
      console.log('Chat unblocked for student');
    }, 5 * 60 * 1000);

    // 3. Block all chat for entire class
    await client.permissions.updateRoomSettings(eventId, {
      blockAllChat: true,
    });
    console.log('Chat blocked for entire class');

    // 4. Get permission history
    const history = await client.permissions.getHistory(eventId);
    const studentHistory = history.data.filter(
      (item) => item.participantAuthId === studentAuthId
    );
    console.log('Student permission history:', studentHistory);

    // 5. Block all permissions for a student
    const permissions: PermissionType[] = ['camera', 'mic', 'screenShare', 'chat', 'draw'];
    for (const permission of permissions) {
      await client.permissions.blockPermission(eventId, {
        participantAuthId: studentAuthId,
        permissionType: permission,
        reason: 'Vi phạm nghiêm trọng',
      });
    }
    console.log('All permissions blocked for student');

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

managePermissions();
```

## License

MIT
